import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from uuid import UUID

import pytest
import yaml

from functions import expirations


def setup(monkeypatch, *, provider=False, org="a", rows=None, type_org="a"):
    calls = []
    due = (datetime.now(timezone.utc).date() + timedelta(days=2)).isoformat()
    asset = SimpleNamespace(id=str(UUID(int=1)), data={"organization_id": "a", "name": "Firewall", "flexible_asset_type_id": "type-a", "traits": {"expiry": due, "secret": "not-returned"}})
    async def query(table, **kwargs):
        calls.append((table, kwargs))
        if table == expirations.ASSETS:
            return SimpleNamespace(documents=rows if rows is not None else [asset])
        return SimpleNamespace(documents=[SimpleNamespace(id="type-a", data={"organization_id": type_org, "fields": [{"key": "expiry", "type": "date", "is_expiration": True}]})])
    monkeypatch.setattr(expirations, "context", SimpleNamespace(org_id=org, is_platform_admin=False, organization=SimpleNamespace(is_provider=provider)))
    monkeypatch.setattr(expirations, "tables", SimpleNamespace(query=query))
    return calls


def test_customer_scope_and_safe_projection(monkeypatch):
    calls = setup(monkeypatch)
    result = asyncio.run(expirations.docs_list_expirations("a"))
    assert result["items"][0]["days_until"] == 2
    assert "not-returned" not in str(result)
    assert result["next_cursor"] is None
    assert result["scanned"] == 1
    assert calls[0] == (expirations.ASSETS, {"where": {"organization_id": "a"}, "scope": "a", "limit": 100, "after_document_id": "", "skip_count": True})
    assert calls[1][1]["document_ids"] == ["type-a"]


def test_foreign_customer_and_missing_identity_denied_before_reads(monkeypatch):
    for org in ["b", None]:
        calls = setup(monkeypatch, org=org)
        with pytest.raises(expirations.UserError, match="own organization"):
            asyncio.run(expirations.docs_list_expirations("a"))
        assert not calls


def test_provider_may_choose_target_but_foreign_schema_is_not_projected(monkeypatch):
    setup(monkeypatch, provider=True, org="provider", type_org="b")
    assert asyncio.run(expirations.docs_list_expirations("a"))["items"] == []


@pytest.mark.parametrize("params", [{"within_days": 0}, {"within_days": 366}, {"within_days": True}, {"cursor": "not-an-id"}, {"cursor": 5}, {"organization_id": ""}])
def test_invalid_inputs_rejected_before_reads(monkeypatch, params):
    calls = setup(monkeypatch)
    with pytest.raises(expirations.UserError):
        asyncio.run(expirations.docs_list_expirations(**{"organization_id": "a", **params}))
    assert not calls


def test_cursor_is_last_asset_not_last_match(monkeypatch):
    rows = [SimpleNamespace(id=str(UUID(int=i)), data={"organization_id": "a"}) for i in range(1, 101)]
    calls = setup(monkeypatch, rows=rows)
    result = asyncio.run(expirations.docs_list_expirations("a", cursor=str(UUID(int=1000))))
    assert result["items"] == []
    assert result["next_cursor"] == rows[-1].id
    assert len(calls) == 1
    assert calls[0][1]["after_document_id"] == str(UUID(int=1000))


def test_manifest_retains_reader_access_without_migration_privileges():
    entries = yaml.safe_load((Path(__file__).parents[1] / ".bifrost/workflows.yaml").read_text())["workflows"]
    entry = next(e for e in entries.values() if e["function_name"] == "docs_list_expirations")
    assert entry["access_level"] == "role_based"
    assert entry["role_names"] == ["Bifrost Docs Reader", "Bifrost Docs Editor", "Bifrost Docs Administrator"]
