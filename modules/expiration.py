"""Safe, date-only projections for explicitly flagged asset expiration fields."""

from datetime import date
from typing import Any


def project_expirations(
    asset_id: str, asset: dict[str, Any], asset_type: dict[str, Any],
    *, organization_id: str, today: date, within_days: int,
) -> tuple[list[dict[str, Any]], int]:
    """Return selected date fields only; never return traits or raw source data."""
    if (
        asset.get("organization_id") != organization_id
        or asset_type.get("organization_id") != organization_id
        or asset.get("archived") is True
        or asset.get("is_enabled") is False
        or asset_type.get("active") is False
    ):
        return [], 0
    fields = asset_type.get("fields")
    traits = asset.get("traits")
    if not isinstance(fields, list) or not isinstance(traits, dict):
        return [], 0
    items: list[dict[str, Any]] = []
    invalid = 0
    seen: set[str] = set()
    for raw in fields:
        if not isinstance(raw, dict):
            continue
        field = raw.get("attributes", raw)
        if not isinstance(field, dict):
            continue
        if field.get("type", field.get("kind")) != "date" or field.get("is_expiration") is not True:
            continue
        key = field.get("key", field.get("name-key", field.get("name_key")))
        if not isinstance(key, str) or not key or key in seen:
            continue
        seen.add(key)
        value = traits.get(key)
        if value is None or value == "":
            continue
        try:
            # Date fields are calendar dates, not instants in a browser timezone.
            if not isinstance(value, str) or len(value) != 10:
                raise ValueError("Expected an ISO calendar date")
            expires = date.fromisoformat(value)
        except ValueError:
            invalid += 1
            continue
        days = (expires - today).days
        if days > within_days:
            continue
        items.append({
            "asset_id": asset_id,
            "asset_name": str(asset.get("name") or "Unnamed asset"),
            "asset_type_name": str(asset_type.get("name") or "Asset"),
            "asset_type_id": str(asset.get("flexible_asset_type_id") or ""),
            "organization_id": organization_id,
            "field_key": key,
            "field_name": str(field.get("name") or key),
            "expires_on": expires.isoformat(),
            "days_until": days,
        })
    return items, invalid
