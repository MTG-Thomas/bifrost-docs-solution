import { describe, expect, it } from "vitest";
import { normalizeAssetTypeFields, safeAssetTypeFields, serializeAssetTypeFields } from "./AssetTypeEditor";

describe("asset type schema helpers", () => {
  it("round-trips expiration flags and clears them when a date becomes text", () => {
    const source = [{ attributes: { "name-key": "renewal", kind: "date", name: "Renewal", is_expiration: true } }];
    const fields = normalizeAssetTypeFields(source);
    expect(fields[0].is_expiration).toBe(true);
    expect(serializeAssetTypeFields(fields)).toEqual(source);
    expect(serializeAssetTypeFields([{ ...fields[0], type: "text" }])[0]).toEqual({ attributes: expect.objectContaining({ kind: "text", is_expiration: false }) });
    expect(serializeAssetTypeFields([{ ...fields[0], is_expiration: false }])[0]).toEqual({ attributes: expect.objectContaining({ is_expiration: false }) });
  });
  it("round-trips imported protected and unsupported definitions without converting them", () => {
    const source = [
      { attributes: { name: "Host Name", kind: "text", required: true, options: null } },
      { name: "API token", type: "password", required: true },
      { name: "Environment", kind: "select", options: ["Production", "Development"] },
      { attributes: { "name-key": "labels", name: "Labels", kind: "Tag", custom: { color: "blue" } } },
      { attributes: { "name-key": "manual", name: "Manual", kind: "Upload", allowed_extensions: ["pdf"] } },
      { attributes: { "name-key": "computed", name: "Computed", kind: "Formula", expression: "a + b" } },
      { attributes: { "name-key": "protected", name: "Protected", kind: "TOTP", required: true } },
    ];
    const fields = normalizeAssetTypeFields(source);

    expect(fields).toEqual([
      expect.objectContaining({ key: "host_name", name: "Host Name", type: "text", required: true }),
      expect.objectContaining({ key: "api_token", type: "password" }),
      expect.objectContaining({ key: "environment", type: "select", options: ["Production", "Development"] }),
      expect.objectContaining({ key: "labels", type: "tag" }),
      expect.objectContaining({ key: "manual", type: "upload" }),
      expect.objectContaining({ key: "computed", type: "unknown", sourceType: "formula", readOnly: true }),
      expect.objectContaining({ key: "protected", type: "totp", readOnly: true }),
    ]);
    expect(safeAssetTypeFields(fields)).toEqual(source);
    expect(serializeAssetTypeFields(fields)).toEqual(source);
  });
});
