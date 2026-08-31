import { describe, expect, it } from "vitest";
import { archiveLineItems, checkoutKind, featureWindowMs, isArchiveActive, nftOriginFromTxid, productionRequiresLiveStripe, stripeKeyLivemode } from "../worker/billing-lib";
import { boostUsdToCents } from "../worker/commerce";
import { authorKind, authorKindLabel, heatIntensity, ideaHeat, SITE_AGENT_PUBKEY } from "../worker/identity";

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

describe("checkoutKind", () => {
  it("classifies Archive subscriptions", () => {
    expect(checkoutKind({ mode: "subscription", metadata: { kind: "archive" } })).toBe("archive");
    expect(checkoutKind({ mode: "subscription", metadata: {} })).toBe("archive");
    expect(checkoutKind({ subscription: "sub_123", metadata: null })).toBe("archive");
  });

  it("does not treat one-off payments as Archive", () => {
    expect(checkoutKind({ mode: "payment", metadata: { kind: "feature" } })).toBe("feature");
    expect(checkoutKind({ mode: "payment", metadata: { kind: "boost" } })).toBe("boost");
    expect(checkoutKind({ mode: "payment", metadata: {} })).toBe("ignore");
  });
});

describe("feature and boost math", () => {
  it("uses a 7-day featured window", () => {
    expect(featureWindowMs()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("maps $1 / $3 / $5 boosts to cents", () => {
    expect(boostUsdToCents(1)).toBe(100);
    expect(boostUsdToCents(3)).toBe(300);
    expect(boostUsdToCents(5)).toBe(500);
    expect(boostUsdToCents(2)).toBeNull();
  });
});

describe("identity and heat", () => {
  it("labels guests, the site agent, and humans", () => {
    expect(authorKind("g_abc")).toBe("guest");
    expect(authorKind(SITE_AGENT_PUBKEY)).toBe("agent");
    expect(authorKind("0224deadbeef")).toBe("human");
    expect(authorKindLabel("agent")).toBe("Agent");
  });

  it("weights USD boosts as 10 sats per cent", () => {
    expect(ideaHeat(0, 100)).toBe(1000);
    expect(ideaHeat(10, 500)).toBe(5010);
    expect(heatIntensity(5000)).toBe(1);
    expect(heatIntensity(0)).toBe(0);
  });
});

describe("stripe live vs test keys", () => {
  it("detects live and test prefixes including sandbox rkcs_test", () => {
    expect(stripeKeyLivemode("pk_live_abc")).toBe(true);
    expect(stripeKeyLivemode("rk_live_abc")).toBe(true);
    expect(stripeKeyLivemode("sk_test_abc")).toBe(false);
    expect(stripeKeyLivemode("rkcs_test_abc")).toBe(false);
    expect(stripeKeyLivemode(undefined)).toBeNull();
    expect(productionRequiresLiveStripe("entangleit.com", false)).toBe(true);
    expect(productionRequiresLiveStripe("entangleit.com", true)).toBe(false);
    expect(productionRequiresLiveStripe("localhost", false)).toBe(false);
    const liveItems = archiveLineItems("price_test_123", true);
    expect(liveItems[0]).toHaveProperty("price_data");
    const testItems = archiveLineItems("price_test_123", false);
    expect(testItems[0]).toEqual({ price: "price_test_123", quantity: 1 });
  });
});
