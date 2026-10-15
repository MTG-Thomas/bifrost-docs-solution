import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  scope: { organizationId: "a", viewerId: "user-a", viewerSettled: true, loading: false, error: "" },
  mutate: vi.fn(),
}));
vi.mock("bifrost", () => ({ useWorkflowMutation: () => ({ mutate: mocks.mutate }) }));
vi.mock("./layout/useDocsOrganizations", () => ({ useDocsOrganizations: () => mocks.scope }));
import { UpcomingExpirations } from "./UpcomingExpirations";

const item = { asset_id: "asset-a", asset_name: "Firewall", asset_type_id: "type-a", asset_type_name: "License", organization_id: "a", field_key: "renewal", field_name: "Renewal", expires_on: "2026-10-15", days_until: 1 };
const page = { items: [item], scanned: 1, invalid_dates: 0, next_cursor: null, as_of: "2026-10-14", within_days: 30 };
function mount() { return render(<MemoryRouter><UpcomingExpirations /></MemoryRouter>); }
beforeEach(() => {
  mocks.scope = { organizationId: "a", viewerId: "user-a", viewerSettled: true, loading: false, error: "" };
  mocks.mutate.mockReset().mockResolvedValue(page);
});
afterEach(cleanup);

describe("UpcomingExpirations", () => {
  it("loads scoped dates with an actionable asset link and window selection", async () => {
    mount();
    expect(await screen.findByRole("link", { name: "Firewall" })).toHaveAttribute("href", "/org/a/assets/type-a/asset-a");
    expect(screen.getByText("Expires in 1 day")).toBeVisible();
    expect(mocks.mutate).toHaveBeenCalledWith({ organization_id: "a", within_days: 30, cursor: "" });
    fireEvent.change(screen.getByLabelText("Due within"), { target: { value: "7" } });
    await waitFor(() => expect(mocks.mutate).toHaveBeenLastCalledWith({ organization_id: "a", within_days: 7, cursor: "" }));
  });
  it("does not execute with no selected organization or unsettled identity", () => {
    mocks.scope.organizationId = "";
    const view = mount();
    expect(screen.getByText("Select an organization to view its expiration dates.")).toBeVisible();
    expect(mocks.mutate).not.toHaveBeenCalled();
    mocks.scope.organizationId = "a";
    mocks.scope.viewerSettled = false;
    view.rerender(<MemoryRouter><UpcomingExpirations /></MemoryRouter>);
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it("does not label an incomplete empty page as no expirations", async () => {
    mocks.mutate.mockResolvedValueOnce({ ...page, items: [], scanned: 100, next_cursor: "cursor-a" }).mockResolvedValueOnce(page);
    mount();
    expect(await screen.findByText("No matching dates in the assets checked so far.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Check next 100 assets" }));
    expect(await screen.findByRole("link", { name: "Firewall" })).toBeVisible();
    expect(screen.getByText(/Checked 101 assets/)).toBeVisible();
    expect(mocks.mutate).toHaveBeenLastCalledWith({ organization_id: "a", within_days: 30, cursor: "cursor-a" });
  });
  it("shows errors with retry and date validation warnings", async () => {
    mocks.mutate.mockRejectedValueOnce(new Error("unavailable")).mockResolvedValueOnce({ ...page, invalid_dates: 2 });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Some dates need attention")).toBeVisible();
  });
  it("hides previous account data immediately and ignores its delayed result", async () => {
    let resolve!: (value: typeof page) => void;
    mocks.mutate.mockReturnValueOnce(new Promise(result => { resolve = result; }));
    const view = mount();
    mocks.scope = { ...mocks.scope, organizationId: "b", viewerId: "user-b" };
    mocks.mutate.mockResolvedValue({ ...page, items: [] });
    view.rerender(<MemoryRouter><UpcomingExpirations /></MemoryRouter>);
    await act(async () => { resolve(page); });
    expect(screen.queryByRole("link", { name: "Firewall" })).not.toBeInTheDocument();
    expect(await screen.findByText(/No matching expiration dates/)).toBeVisible();
  });
});
