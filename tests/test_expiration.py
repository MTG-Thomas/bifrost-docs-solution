from datetime import date

from modules.expiration import project_expirations


def project(*, asset_changes=None, fields=None, traits=None, type_changes=None):
    return project_expirations(
        "asset-a", {"organization_id": "a", "name": "Firewall", "traits": traits or {"renewal": "2026-10-15"}, **(asset_changes or {})},
        {"organization_id": "a", "name": "License", "fields": fields if fields is not None else [{"key": "renewal", "type": "date", "is_expiration": True}], **(type_changes or {})},
        organization_id="a", today=date(2026, 10, 14), within_days=30,
    )


def test_dates_are_opt_in_and_projection_does_not_include_secrets():
    items, invalid = project(traits={"renewal": "2026-10-15", "password": "do-not-return"})
    assert items[0]["days_until"] == 1
    assert items[0]["expires_on"] == "2026-10-15"
    assert "do-not-return" not in str(items)
    assert invalid == 0
    for field in [{"key": "renewal", "type": "date"}, {"key": "renewal", "type": "password", "is_expiration": True}]:
        assert project(fields=[field]) == ([], 0)


def test_expired_today_and_window_boundaries():
    for value, expected in [("2026-10-13", -1), ("2026-10-14", 0), ("2026-11-13", 30)]:
        assert project(traits={"renewal": value})[0][0]["days_until"] == expected
    assert project(traits={"renewal": "2026-11-14"}) == ([], 0)


def test_invalid_and_missing_dates_and_source_field_aliases():
    for value in ["2026-02-30", "20261015", "2026-10-15T00:00:00Z", True, {}]:
        assert project(traits={"renewal": value}) == ([], 1)
    assert project(traits={"other": "2026-10-15"}) == ([], 0)
    assert project(fields=[{"attributes": {"name-key": "renewal", "kind": "date", "is_expiration": True}}])[0]


def test_foreign_disabled_and_archived_assets_and_inactive_types_are_excluded():
    for change in [{"organization_id": "b"}, {"archived": True}, {"is_enabled": False}]:
        assert project(asset_changes=change) == ([], 0)
    for change in [{"organization_id": "b"}, {"active": False}]:
        assert project(type_changes=change) == ([], 0)
