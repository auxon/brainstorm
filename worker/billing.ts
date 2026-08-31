import Stripe from "stripe";
import type { Context } from "hono";
import type { Hono } from "hono";
import { APP_PREFIX } from "./paths";
import { HttpError, type WalletUser } from "./types";
import { attachSessionCookie, ensureSessionUser, isGuestId, mintSessionForUser } from "./auth";
import { siteWalletStatus } from "./site-wallet";
import {
  ARCHIVE_AMOUNT_USD,
  ARCHIVE_INTERVAL,
  billingConfigured,
  integrationIdentifier,
  isArchiveActive,
  type BillingEnv,
} from "./billing-lib";

type App = Hono<{ Bindings: Env; Variables: { user: WalletUser | null } }>;
type Ctx = Context<{ Bindings: Env; Variables: { user: WalletUser | null } }>;

function stripeClient(env: BillingEnv): Stripe {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) throw new HttpError(503, "Billing is not configured");
  return new Stripe(key, {
    apiVersion: "2026-07-29.dahlia",
    httpClient: Stripe.createFetchHttpClient(),
  });
}

type UserRow = {
  id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_status: string | null;
};

async function loadBillingUser(db: D1Database, userId: string): Promise<UserRow | null> {
  return db
    .prepare(
      "SELECT id, stripe_customer_id, stripe_subscription_id, stripe_status FROM wallet_users WHERE id = ?",
    )
    .bind(userId)
    .first<UserRow>();
}

export async function userHasArchive(db: D1Database, userId: string): Promise<boolean> {
  const row = await loadBillingUser(db, userId);
  return isArchiveActive(row?.stripe_status);
}

export async function upsertSubscription(
  db: D1Database,
  input: {
    userId?: string | null;
    customerId?: string | null;
    subscriptionId?: string | null;
    status?: string | null;
  },
): Promise<void> {
  let userId = input.userId ?? null;
  if (!userId && input.customerId) {
    const row = await db
      .prepare("SELECT id FROM wallet_users WHERE stripe_customer_id = ?")
      .bind(input.customerId)
      .first<{ id: string }>();
    userId = row?.id ?? null;
  }
  if (!userId) return;
  await db
    .prepare(
      "UPDATE wallet_users SET stripe_customer_id = COALESCE(?, stripe_customer_id), stripe_subscription_id = COALESCE(?, stripe_subscription_id), stripe_status = COALESCE(?, stripe_status) WHERE id = ?",
    )
    .bind(input.customerId ?? null, input.subscriptionId ?? null, input.status ?? null, userId)
    .run();
}

/** Move Archive from a guest cookie onto a Yours identity after optional wallet link. */
export async function transferBilling(db: D1Database, fromUserId: string, toUserId: string): Promise<void> {
  if (fromUserId === toUserId) return;
  const from = await loadBillingUser(db, fromUserId);
  if (!from?.stripe_customer_id && !from?.stripe_status) return;
  await db
    .prepare(
      "UPDATE wallet_users SET stripe_customer_id = COALESCE(?, stripe_customer_id), stripe_subscription_id = COALESCE(?, stripe_subscription_id), stripe_status = COALESCE(?, stripe_status) WHERE id = ?",
    )
    .bind(from.stripe_customer_id, from.stripe_subscription_id, from.stripe_status, toUserId)
    .run();
  await db
    .prepare(
      "UPDATE wallet_users SET stripe_customer_id = NULL, stripe_subscription_id = NULL, stripe_status = NULL WHERE id = ?",
    )
    .bind(fromUserId)
    .run();
}

async function requireActor(c: Ctx): Promise<WalletUser> {
  const { user, mintedToken } = await ensureSessionUser(c.env.DB, c.get("user"));
  if (mintedToken) {
    c.set("user", user);
    attachSessionCookie((n, v) => c.header(n, v), c.req.raw, mintedToken);
  }
  return user;
}

function siteOrigin(request: Request): string {
  const url = new URL(request.url);
  if (url.hostname === "entangleit.com") return "https://entangleit.com";
  return url.origin;
}

export function registerBillingRoutes(api: App): void {
  api.get("/billing/status", async (c) => {
    const env = c.env as BillingEnv;
    const configured = billingConfigured(env);
    const user = c.get("user");
    const row = user ? await loadBillingUser(c.env.DB, user.id) : null;
    const siteWallet = await siteWalletStatus(env);
    return c.json({
      configured,
      publishableKey: configured ? env.STRIPE_PUBLISHABLE_KEY ?? null : null,
      priceId: configured ? env.STRIPE_PRICE_ID ?? null : null,
      amountUsd: ARCHIVE_AMOUNT_USD,
      interval: ARCHIVE_INTERVAL,
      product: "Brainstorm Archive",
      status: row?.stripe_status ?? null,
      active: isArchiveActive(row?.stripe_status),
      hasCustomer: Boolean(row?.stripe_customer_id),
      siteWallet,
    });
  });

  api.post("/billing/checkout", async (c) => {
    const user = await requireActor(c);
    const env = c.env as BillingEnv;
    if (!billingConfigured(env) || !env.STRIPE_PRICE_ID) {
      throw new HttpError(503, "Billing is not configured");
    }
    const stripe = stripeClient(env);
    const existing = await loadBillingUser(c.env.DB, user.id);
    if (isArchiveActive(existing?.stripe_status)) {
      return c.json({ url: `${siteOrigin(c.req.raw)}${APP_PREFIX}/billing`, alreadyActive: true });
    }

    let customerId = existing?.stripe_customer_id ?? null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        metadata: { brainstormUserId: user.id },
      });
      customerId = customer.id;
      await upsertSubscription(c.env.DB, { userId: user.id, customerId });
    }

    const origin = siteOrigin(c.req.raw);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: user.id,
      line_items: [{ price: env.STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${origin}${APP_PREFIX}/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}${APP_PREFIX}/billing?checkout=cancel`,
      allow_promotion_codes: true,
      metadata: { brainstormUserId: user.id },
      subscription_data: { metadata: { brainstormUserId: user.id } },
      integration_identifier: integrationIdentifier(),
    });
    if (!session.url) throw new HttpError(502, "Stripe did not return a checkout URL");
    return c.json({ url: session.url });
  });

  api.post("/billing/claim", async (c) => {
    const env = c.env as BillingEnv;
    if (!billingConfigured(env)) throw new HttpError(503, "Billing is not configured");
    const body = (await c.req.json().catch(() => null)) as { sessionId?: string } | null;
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
    if (!sessionId.startsWith("cs_")) throw new HttpError(400, "Missing Stripe Checkout session id");
    const stripe = stripeClient(env);
    const checkout = await stripe.checkout.sessions.retrieve(sessionId);
    if (checkout.status !== "complete") throw new HttpError(402, "Checkout is not complete yet");
    const userId =
      (typeof checkout.client_reference_id === "string" && checkout.client_reference_id) ||
      (typeof checkout.metadata?.brainstormUserId === "string" && checkout.metadata.brainstormUserId) ||
      null;
    const customerId = typeof checkout.customer === "string" ? checkout.customer : checkout.customer?.id ?? null;
    const subscriptionId =
      typeof checkout.subscription === "string" ? checkout.subscription : checkout.subscription?.id ?? null;
    await upsertSubscription(c.env.DB, {
      userId,
      customerId,
      subscriptionId,
      status: "active",
    });

    const current = c.get("user");
    if (!current && userId) {
      const minted = await mintSessionForUser(c.env.DB, {
        userId,
        displayName: isGuestId(userId) ? "Guest" : null,
      });
      attachSessionCookie((n, v) => c.header(n, v), c.req.raw, minted.token);
      c.set("user", minted.user);
    }
    const actorId = c.get("user")?.id ?? userId;
    const row = actorId ? await loadBillingUser(c.env.DB, actorId) : null;
    return c.json({
      ok: true,
      active: isArchiveActive(row?.stripe_status),
      status: row?.stripe_status ?? "active",
    });
  });

  api.post("/billing/portal", async (c) => {
    const user = await requireActor(c);
    const row = await loadBillingUser(c.env.DB, user.id);
    if (!row?.stripe_customer_id) throw new HttpError(400, "No Stripe customer yet — subscribe first");
    const stripe = stripeClient(c.env as BillingEnv);
    const origin = siteOrigin(c.req.raw);
    const portal = await stripe.billingPortal.sessions.create({
      customer: row.stripe_customer_id,
      return_url: `${origin}${APP_PREFIX}/billing`,
    });
    return c.json({ url: portal.url });
  });

  api.post("/billing/webhook", async (c) => {
    const env = c.env as BillingEnv;
    const secret = env.STRIPE_WEBHOOK_SECRET;
    if (!secret || !env.STRIPE_SECRET_KEY) throw new HttpError(503, "Billing is not configured");
    const signature = c.req.header("stripe-signature");
    if (!signature) throw new HttpError(400, "Missing stripe-signature");
    const payload = await c.req.text();
    const stripe = stripeClient(env);
    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(payload, signature, secret);
    } catch (err) {
      const message = err instanceof Error ? err.message : "invalid signature";
      throw new HttpError(400, `Webhook signature failed: ${message}`);
    }
    c.executionCtx.waitUntil(handleStripeEvent(c.env.DB, event));
    return c.json({ received: true });
  });
}

async function handleStripeEvent(db: D1Database, event: Stripe.Event): Promise<void> {
  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const userId =
        (typeof session.client_reference_id === "string" && session.client_reference_id) ||
        (typeof session.metadata?.brainstormUserId === "string" && session.metadata.brainstormUserId) ||
        null;
      const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
      const subscriptionId =
        typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;
      await upsertSubscription(db, {
        userId,
        customerId,
        subscriptionId,
        status: "active",
      });
      return;
    }

    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const sub = event.data.object;
      const userId = typeof sub.metadata?.brainstormUserId === "string" ? sub.metadata.brainstormUserId : null;
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;
      const status = event.type === "customer.subscription.deleted" ? "canceled" : sub.status;
      await upsertSubscription(db, { userId, customerId, subscriptionId: sub.id, status });
    }
  } catch (err) {
    console.error("[stripe-webhook]", event.type, err);
  }
}
