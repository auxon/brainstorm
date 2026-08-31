import { describe, expect, it } from "vitest";
import { isArchiveActive, nftOriginFromTxid } from "../worker/billing-lib";

describe("isArchiveActive", () => {
  it("treats active and trialing as paid", () => {
    expect(isArchiveActive("active")).toBe(true);
    expect(isArchiveActive("trialing")).toBe(true);
    expect(isArchiveActive("past_due")).toBe(true);
    expect(isArchiveActive("canceled")).toBe(false);
    expect(isArchiveActive(null)).toBe(false);
  });
});

describe("nftOriginFromTxid", () => {
  it("uses 1Sat origin convention txid_0", () => {
    const txid = "A".repeat(64);
    expect(nftOriginFromTxid(txid)).toBe(`${"a".repeat(64)}_0`);
  });
});
