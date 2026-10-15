"""Bounded, caller-authorized expiration reads for the Docs dashboard."""

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from bifrost import UserError, context, tables, workflow

from modules.expiration import project_expirations

ASSETS = "docs-flexible-assets"
TYPES = "docs-flexible-asset-types"
PAGE_SIZE = 100


@workflow(
    name="docs_list_expirations",
    description="Read one bounded page of explicitly flagged asset expiration dates for an authorized organization.",
    category="Bifrost Docs",
)
async def docs_list_expirations(
    organization_id: str, within_days: int = 30, cursor: str = "",
) -> dict[str, Any]:
    """Scan 100 assets per call. A next_cursor means results are incomplete."""
    if not isinstance(organization_id, str) or not organization_id or len(organization_id) > 128:
        raise UserError("Select an organization to view expirations")
    caller_org = str(getattr(context, "org_id", None) or "")
    provider = bool(
        getattr(context, "is_platform_admin", False)
        or getattr(getattr(context, "organization", None), "is_provider", False)
    )
    if not provider and (not caller_org or organization_id != caller_org):
        raise UserError("You can view expirations only for your own organization")
    if type(within_days) is not int or not 1 <= within_days <= 365:
        raise UserError("within_days must be an integer between 1 and 365")
    if not isinstance(cursor, str):
        raise UserError("Invalid expiration cursor")
    if cursor:
        try:
            UUID(cursor)
        except ValueError as exc:
            raise UserError("Invalid expiration cursor") from exc

    page = await tables.query(
        ASSETS, where={"organization_id": organization_id}, scope=organization_id,
        limit=PAGE_SIZE, after_document_id=cursor, skip_count=True,
    )
    rows = list(page.documents)
    type_ids = sorted({
        row.data.get("flexible_asset_type_id") for row in rows
        if isinstance(row.data, dict)
        and row.data.get("organization_id") == organization_id
        and isinstance(row.data.get("flexible_asset_type_id"), str)
        and row.data.get("flexible_asset_type_id")
    })
    types: dict[str, dict[str, Any]] = {}
    if type_ids:
        type_page = await tables.query(
            TYPES, where={"organization_id": organization_id}, scope=organization_id,
            document_ids=type_ids, limit=PAGE_SIZE, skip_count=True,
        )
        types = {str(row.id): row.data for row in type_page.documents if isinstance(row.data, dict)}
    today = datetime.now(timezone.utc).date()
    items: list[dict[str, Any]] = []
    invalid_dates = 0
    for row in rows:
        asset = row.data if isinstance(row.data, dict) else {}
        projected, invalid = project_expirations(
            str(row.id), asset, types.get(asset.get("flexible_asset_type_id"), {}),
            organization_id=organization_id, today=today, within_days=within_days,
        )
        items.extend(projected)
        invalid_dates += invalid
    items.sort(key=lambda item: (item["expires_on"], item["asset_id"], item["field_key"]))
    return {
        "items": items, "scanned": len(rows), "invalid_dates": invalid_dates,
        "next_cursor": str(rows[-1].id) if len(rows) == PAGE_SIZE else None,
        "as_of": today.isoformat(), "within_days": within_days,
    }
