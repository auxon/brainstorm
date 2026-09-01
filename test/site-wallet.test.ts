import { describe, expect, it } from "vitest";
import { PrivateKey } from "@bsv/sdk";
import { isGuestId, GUEST_PREFIX } from "../worker/auth";
import {
  buildInscriptionLockingScript,
  buildMintTransaction,
  estimateMintSats,
  satsToBsv,
  siteWalletAddress,
  siteWalletConfigured,
  siteWalletFundingMessage,
} from "../worker/site-wallet";
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

describe("mint funding estimate", () => {
  it("uses the 200 sat fee floor for small snapshots", () => {
    expect(estimateMintSats(0)).toEqual({
      feeSats: 200,
      ordinalSats: 1,
      changeBufferSats: 1,
      neededSats: 202,
    });
    expect(estimateMintSats(1600)).toEqual({
      feeSats: 200,
      ordinalSats: 1,
      changeBufferSats: 1,
      neededSats: 202,
    });
  });

  it("scales fee with inscription size", () => {
    expect(estimateMintSats(3601).feeSats).toBe(250);
    expect(estimateMintSats(350_000)).toEqual({
      feeSats: 17_550,
      ordinalSats: 1,
      changeBufferSats: 1,
      neededSats: 17_552,
    });
  });

  it("tells the operator how many sats and BSV to send", () => {
    expect(satsToBsv(17_501)).toBe("0.00017501");
    expect(
      siteWalletFundingMessage({
        address: "13PXVeiAmSygGKFj79JCh59VEk2jLct4Xq",
        haveSats: 500,
        neededSats: 17_552,
        feeSats: 17_550,
      }),
    ).toBe(
      "Site wallet has 500 sats but this inscription needs 17,552 sats (17,550 sat network fee + 1 sat ordinal). " +
        "Send at least 17,052 more sats (0.00017052 BSV) to 13PXVeiAmSygGKFj79JCh59VEk2jLct4Xq.",
    );
  });
});

describe("mint transaction", () => {
  it("fees and signs without a full source transaction (the live 500)", async () => {
    const key = PrivateKey.fromRandom();
    const tx = await buildMintTransaction({
      key,
      markdown: "# StreamMaster Pro\n\n".repeat(80),
      contentType: "text/markdown",
      utxos: [
        {
          tx_hash: "28ea2dd15e2f55c00dab56867f96d75b12ac62e6bcd881f8c6e4e93e28ec0981",
          tx_pos: 0,
          value: 500,
        },
        {
          tx_hash: "908ab28289ec6b9c6035e5f76606d23211adbd32c102599b0b49df504fc865dc",
          tx_pos: 1,
          value: 5000,
        },
      ],
    });
    expect(tx.inputs.length).toBeGreaterThan(0);
    const hex = tx.toHex();
    expect(hex.length).toBeGreaterThan(200);
    expect(tx.id("hex")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("still reports the funding shortfall instead of throwing", async () => {
    const key = PrivateKey.fromRandom();
    await expect(
      buildMintTransaction({
        key,
        markdown: "# tiny",
        contentType: "text/markdown",
        utxos: [{ tx_hash: "aa".repeat(32), tx_pos: 0, value: 10 }],
      }),
    ).rejects.toMatchObject({ status: 503, name: "HttpError" });
  });
});

describe("archive still gates minting", () => {
  it("keeps canceled subscriptions inactive", () => {
    expect(isArchiveActive("canceled")).toBe(false);
    expect(isArchiveActive("active")).toBe(true);
  });
});
