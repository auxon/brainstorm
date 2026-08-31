import { describe, expect, it } from "vitest";
import { PrivateKey } from "@bsv/sdk";
import { isGuestId, GUEST_PREFIX } from "../worker/auth";
import { buildInscriptionLockingScript, siteWalletConfigured, siteWalletAddress } from "../worker/site-wallet";
import { isArchiveActive, type BillingEnv } from "../worker/billing-lib";

describe("guest identity", () => {
  it("uses the g_ prefix", () => {
    expect(isGuestId(`${GUEST_PREFIX}abcdefghijklmnop`)).toBe(true);
    expect(isGuestId("03e08d985429778a653bf521b3f8cbbae7d8c5d3f33f4da84928ff61b21f9db03f")).toBe(false);
  });
});

describe("site wallet inscription script", () => {
  it("wraps content in a 1Sat ord envelope plus P2PKH", () => {
    const key = PrivateKey.fromRandom();
    const address = key.toAddress();
    const body = new TextEncoder().encode("# hello brainstorm");
    const script = buildInscriptionLockingScript(address, body, "text/markdown");
    const hex = script.toHex();
    expect(hex).toContain("6f7264");
    expect(hex.toLowerCase()).toContain(Buffer.from("text/markdown").toString("hex"));
  });

  it("does not treat an empty env as configured", () => {
    expect(siteWalletConfigured({} as BillingEnv)).toBe(false);
    expect(siteWalletAddress({} as BillingEnv)).toBeNull();
  });
});

describe("archive still gates minting", () => {
  it("keeps canceled subscriptions inactive", () => {
    expect(isArchiveActive("canceled")).toBe(false);
    expect(isArchiveActive("active")).toBe(true);
  });
});
