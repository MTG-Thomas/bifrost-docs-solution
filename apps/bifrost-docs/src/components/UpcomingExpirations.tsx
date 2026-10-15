import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useWorkflowMutation } from "bifrost";
import { useDocsOrganizations } from "./layout/useDocsOrganizations";
import { BfAlert } from "./bifrost/BfAlert";
import { BfButton } from "./bifrost/BfButton";
import { BfSelect } from "./bifrost/BfField";

type Expiration = {
  asset_id: string; asset_name: string; asset_type_id: string; asset_type_name: string; organization_id: string;
  field_key: string; field_name: string; expires_on: string; days_until: number;
};
type Page = { items: Expiration[]; scanned: number; invalid_dates: number; next_cursor: string | null; as_of: string; within_days: number };
type Snapshot = { key: string; page: Page | null; loading: boolean; error: string; failedCursor: string };
const WORKFLOW = "functions/expirations.py::docs_list_expirations";

function timing(days: number) {
  return days < 0 ? `Expired ${-days} ${days === -1 ? "day" : "days"} ago` : days === 0 ? "Expires today" : `Expires in ${days} ${days === 1 ? "day" : "days"}`;
}

export function UpcomingExpirations() {
  const { organizationId, viewerId, viewerSettled, loading: scopeLoading, error: scopeError } = useDocsOrganizations();
  const [withinDays, setWithinDays] = useState(30);
  const workflow = useWorkflowMutation<Page>(WORKFLOW);
  const mutate = useRef(workflow.mutate);
  mutate.current = workflow.mutate;
  const key = `${viewerId ?? ""}:${organizationId}:${withinDays}:${viewerSettled}:${scopeLoading}:${scopeError}`;
  const activeKey = useRef(key);
  activeKey.current = key;
  const request = useRef(0);
  const [snapshot, setSnapshot] = useState<Snapshot>({ key: "", page: null, loading: false, error: "", failedCursor: "" });
  const current = snapshot.key === key ? snapshot : null;
  const ready = Boolean(organizationId && viewerId && viewerSettled && !scopeLoading && !scopeError);

  const load = useCallback(async (cursor = "") => {
    const expectedKey = key;
    const attempt = ++request.current;
    setSnapshot(previous => ({ key, page: cursor && previous.key === key ? previous.page : null, loading: true, error: "", failedCursor: cursor }));
    try {
      const page = await mutate.current({ organization_id: organizationId, within_days: withinDays, cursor });
      if (activeKey.current !== expectedKey || request.current !== attempt) return;
      if (page.next_cursor && page.next_cursor === cursor) throw new Error("The next asset page repeated. Refresh to restart.");
      setSnapshot(previous => {
        const prior = cursor && previous.key === key ? previous.page : null;
        const items = new Map([...(prior?.items ?? []), ...page.items].map(item => [`${item.asset_id}:${item.field_key}`, item]));
        return { key, loading: false, error: "", failedCursor: "", page: {
          ...page, items: [...items.values()].sort((a, b) => a.expires_on.localeCompare(b.expires_on) || a.asset_id.localeCompare(b.asset_id) || a.field_key.localeCompare(b.field_key)),
          scanned: (prior?.scanned ?? 0) + page.scanned,
          invalid_dates: (prior?.invalid_dates ?? 0) + page.invalid_dates,
        } };
      });
    } catch {
      if (activeKey.current === expectedKey && request.current === attempt) {
        setSnapshot(previous => ({ ...previous, loading: false, error: "Expiration dates could not load. Try again.", failedCursor: cursor }));
      }
    }
  }, [key, organizationId, withinDays]);

  useEffect(() => {
    if (ready) void load();
    return () => { request.current += 1; };
  }, [load, ready]);

  return <section aria-label="Upcoming expirations" className="grid gap-3">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h2 className="text-lg font-semibold">Upcoming expirations</h2><p className="text-sm text-muted-foreground">Expired assets and flagged dates due soon in the selected organization.</p></div>
      {ready && <div className="flex items-end gap-2"><BfSelect label="Due within" value={withinDays} options={[7, 14, 30, 90].map(days => ({ value: String(days), label: `${days} days` }))} onChange={event => setWithinDays(Number(event.target.value))} /><BfButton variant="secondary" disabled={current?.loading} onClick={() => void load()}>Refresh</BfButton></div>}
    </div>
    {!ready ? <p className="text-sm text-muted-foreground">{scopeError ? "Organization scope is unavailable. Retry using the organization selector." : scopeLoading || !viewerSettled ? "Loading organization scope…" : "Select an organization to view its expiration dates."}</p> : <>
      {current?.error && <BfAlert tone="danger" title="Could not load expirations">{current.error}<BfButton variant="secondary" onClick={() => void load(current.failedCursor)}>Retry</BfButton></BfAlert>}
      {(!current || current.loading) && <p role="status">Loading expiration dates…</p>}
      {current?.page && <>
        {current.page.items.length > 0 ? <ul className="divide-y divide-[var(--bf-line)]">{current.page.items.map(item => <li key={`${item.asset_id}:${item.field_key}`} className="flex flex-wrap items-center justify-between gap-2 py-3">
          <div><Link className="font-medium text-[var(--bf-primary)] underline underline-offset-3" to={`/org/${encodeURIComponent(item.organization_id)}/assets/${encodeURIComponent(item.asset_type_id)}/${encodeURIComponent(item.asset_id)}`}>{item.asset_name}</Link><p className="text-sm text-muted-foreground">{item.asset_type_name} · {item.field_name}</p></div>
          <div className="text-sm"><span className={item.days_until < 0 ? "text-destructive" : ""}>{timing(item.days_until)}</span><time className="ml-2 text-muted-foreground" dateTime={item.expires_on}>{item.expires_on}</time></div>
        </li>)}</ul> : <p className="text-sm text-muted-foreground">{current.page.next_cursor ? "No matching dates in the assets checked so far." : "No matching expiration dates. In Settings → Asset types, mark a Date field as an expiration date and set its value on an asset."}</p>}
        <p className="text-xs text-muted-foreground">Checked {current.page.scanned} assets as of {current.page.as_of} UTC.{current.page.next_cursor ? " Results are incomplete; check the next assets to find additional dates." : " Scan complete."}</p>
        {current.page.invalid_dates > 0 && <BfAlert tone="warning" title="Some dates need attention">{current.page.invalid_dates} flagged values are not valid YYYY-MM-DD dates and were excluded.</BfAlert>}
        {current.page.next_cursor && !current.error && <BfButton variant="secondary" disabled={current.loading} onClick={() => void load(current.page!.next_cursor!)}>Check next 100 assets</BfButton>}
      </>}
    </>}
  </section>;
}
