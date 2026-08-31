import Stripe from "stripe";
import type { Context } from "hono";
import type { Hono } from "hono";
import { APP_PREFIX } from "./paths";
import { HttpError, type WalletUser } from "./types";
import { attachSessionCookie, ensureSessionUser, isGuestId, mintSessionForUser } from "./auth";
import { siteWalletStatus } from "./site-wallet";
import { fulfillBoost, fulfillFeature } from "./commerce";
import { timingSafeEqualStr } from "./ids";
import {
  ARCHIVE_AMOUNT_USD,
  ARCHIVE_INTERVAL,
  BOOST_OPTIONS,
  FEATURE_AMOUNT_USD,
  FEATURE_DAYS,
  billingConfigured,
  checkoutKind,
  integrationIdentifier,
  isArchiveActive,
  stripePaymentsReady,
  stripeEnvLivemode,
  archiveLineItems,
  productionRequiresLiveStripe,
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

function assertLiveOnProduction(c: Ctx, env: BillingEnv): void {
  const livemode = stripeEnvLivemode(env);
  if (productionRequiresLiveStripe(new URL(c.req.url).hostname, livemode)) {
    throw new HttpError(503, "Production Checkout requires live Stripe keys");
  }
}

function siteOrigin(request: Request): string {
  const url = new URL(request.url);
  if (url.hostname === "entangleit.com") return "https://entangleit.com";
  return url.origin;
}

function presentedToken(request: Request): string | null {
  const url = new URL(request.url);
  return url.searchParams.get("k") || request.headers.get("x-token");
}

async function ensureCustomer(db: D1Database, stripe: Stripe, user: WalletUser): Promise<string> {
  const existing = await loadBillingUser(db, user.id);
  if (existing?.stripe_customer_id) return existing.stripe_customer_id;
  const customer = await stripe.customers.create({ metadata: { brainstormUserId: user.id } });
  await upsertSubscription(db, { userId: user.id, customerId: customer.id });
  return customer.id;
}

async function fulfillPaidCheckout(db: D1Database, checkout: Stripe.Checkout.Session): Promise<void> {
  const kind = checkoutKind({
    mode: checkout.mode,
    subscription: checkout.subscription,
    metadata: checkout.metadata,
  });
  const userId =
    (typeof checkout.client_reference_id === "string" && checkout.client_reference_id) ||
    (typeof checkout.metadata?.brainstormUserId === "string" && checkout.metadata.brainstormUserId) ||
    null;
  const customerId = typeof checkout.customer === "string" ? checkout.customer : checkout.customer?.id ?? null;
  const subscriptionId =
    typeof checkout.subscription === "string" ? checkout.subscription : checkout.subscription?.id ?? null;

  if (kind === "feature") {
    const slug = checkout.metadata?.slug;
    if (!slug) return;
    await fulfillFeature(db, { checkoutSessionId: checkout.id, slug, userId });
    if (customerId) await upsertSubscription(db, { userId, customerId });
    return;
  }
  if (kind === "boost") {
    const slug = checkout.metadata?.slug;
    const targetType = checkout.metadata?.targetType === "comment" ? "comment" : "idea";
    const targetId = checkout.metadata?.targetId;
    const usdCents = Number(checkout.metadata?.usdCents ?? 0);
    if (!slug || !targetId || !usdCents) return;
    await fulfillBoost(db, {
      checkoutSessionId: checkout.id,
      slug,
      userId,
      targetType,
      targetId,
      usdCents,
    });
    if (customerId) await upsertSubscription(db, { userId, customerId });
    return;
  }
  if (kind === "archive") {
    await upsertSubscription(db, {
      userId,
      customerId,
      subscriptionId,
      status: "active",
    });
  }
}

export function registerBillingRoutes(api: App): void {
  api.get("/billing/status", async (c) => {
    const env = c.env as BillingEnv;
    const configured = billingConfigured(env);
    const payments = stripePaymentsReady(env);
    const livemode = stripeEnvLivemode(env);
    const user = c.get("user");
    const row = user ? await loadBillingUser(c.env.DB, user.id) : null;
    const siteWallet = await siteWalletStatus(env);
    return c.json({
      configured,
      payments,
      livemode,
      publishableKey: configured || payments ? env.STRIPE_PUBLISHABLE_KEY ?? null : null,
      priceId: configured ? env.STRIPE_PRICE_ID ?? null : null,
      amountUsd: ARCHIVE_AMOUNT_USD,
      interval: ARCHIVE_INTERVAL,
      product: "Brainstorm Archive",
      featureUsd: FEATURE_AMOUNT_USD,
      featureDays: FEATURE_DAYS,
      boosts: BOOST_OPTIONS.map((b) => b.usd),
      status: row?.stripe_status ?? null,
      active: isArchiveActive(row?.stripe_status),
      hasCustomer: Boolean(row?.stripe_customer_id),
      siteWallet,
    });
  });

  api.post("/billing/checkout", async (c) => {
    const user = await requireActor(c);
    const env = c.env as BillingEnv;
    if (!billingConfigured(env)) {
      throw new HttpError(503, "Billing is not configured");
    }
    assertLiveOnProduction(c, env);
    const stripe = stripeClient(env);
    const existing = await loadBillingUser(c.env.DB, user.id);
    if (isArchiveActive(existing?.stripe_status)) {
      return c.json({ url: `${siteOrigin(c.req.raw)}${APP_PREFIX}/billing`, alreadyActive: true });
    }
    const customerId = await ensureCustomer(c.env.DB, stripe, user);
    const origin = siteOrigin(c.req.raw);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: user.id,
      line_items: archiveLineItems(env.STRIPE_PRICE_ID, stripeEnvLivemode(env)) as Stripe.Checkout.SessionCreateParams["line_items"],
      success_url: `${origin}${APP_PREFIX}/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}${APP_PREFIX}/billing?checkout=cancel`,
      allow_promotion_codes: true,
      metadata: { kind: "archive", brainstormUserId: user.id },
      subscription_data: { metadata: { brainstormUserId: user.id, kind: "archive" } },
      integration_identifier: integrationIdentifier("brainstorm_archive"),
    });
    if (!session.url) throw new HttpError(502, "Stripe did not return a checkout URL");
    return c.json({ url: session.url });
  });

  api.post("/billing/feature", async (c) => {
    const user = await requireActor(c);
    const env = c.env as BillingEnv;
    if (!stripePaymentsReady(env)) throw new HttpError(503, "Billing is not configured");
    assertLiveOnProduction(c, env);
    const body = (await c.req.json().catch(() => null)) as { slug?: string } | null;
    const slug = typeof body?.slug === "string" ? body.slug.trim() : "";
    if (!slug) throw new HttpError(400, "slug required");
    const sessionRow = await c.env.DB.prepare("SELECT * FROM sessions WHERE slug = ?")
      .bind(slug)
      .first<{ id: string; owner_user_id: string; edit_token: string }>();
    if (!sessionRow) throw new HttpError(404, "Session not found");
    const token = presentedToken(c.req.raw);
    const canEdit =
      user.id === sessionRow.owner_user_id || (token ? timingSafeEqualStr(token, sessionRow.edit_token) : false);
    if (!canEdit) throw new HttpError(403, "Edit access required to feature this board");
    const stripe = stripeClient(env);
    const customerId = await ensureCustomer(c.env.DB, stripe, user);
    const origin = siteOrigin(c.req.raw);
    const checkout = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      client_reference_id: user.id,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: FEATURE_AMOUNT_USD * 100,
            product_data: {
              name: `Featured board (${FEATURE_DAYS} days)`,
              description: `Pin ${slug} on /brainstorm/explore for ${FEATURE_DAYS} days`,
            },
          },
        },
      ],
      success_url: `${origin}${APP_PREFIX}/s/${slug}?feature=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}${APP_PREFIX}/s/${slug}?feature=cancel`,
      allow_promotion_codes: true,
      metadata: { kind: "feature", slug, brainstormUserId: user.id },
      integration_identifier: integrationIdentifier("brainstorm_feature"),
    });
    if (!checkout.url) throw new HttpError(502, "Stripe did not return a checkout URL");
    return c.json({ url: checkout.url });
  });

  api.post("/billing/boost", async (c) => {
    const user = await requireActor(c);
    const env = c.env as BillingEnv;
    if (!stripePaymentsReady(env)) throw new HttpError(503, "Billing is not configured");
    assertLiveOnProduction(c, env);
    const body = (await c.req.json().catch(() => null)) as {
      slug?: string;
      targetType?: string;
      targetId?: string;
      usd?: number;
    } | null;
    const slug = typeof body?.slug === "string" ? body.slug.trim() : "";
    const targetType = body?.targetType === "comment" ? "comment" : body?.targetType === "idea" ? "idea" : null;
    const targetId = typeof body?.targetId === "string" ? body.targetId : "";
    const usd = Number(body?.usd);
    if (!slug || !targetType || !targetId) throw new HttpError(400, "slug, targetType, and targetId required");
    if (!BOOST_OPTIONS.some((b) => b.usd === usd)) throw new HttpError(400, "Boost must be $1, $3, or $5");
    const sessionRow = await c.env.DB.prepare("SELECT id FROM sessions WHERE slug = ?").bind(slug).first();
    if (!sessionRow) throw new HttpError(404, "Session not found");
    const stripe = stripeClient(env);
    const customerId = await ensureCustomer(c.env.DB, stripe, user);
    const origin = siteOrigin(c.req.raw);
    const usdCents = usd * 100;
    const checkout = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      client_reference_id: user.id,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: usdCents,
            product_data: {
              name: `Boost idea $${usd}`,
              description: `USD boost on ${slug} (platform fee included)`,
            },
          },
        },
      ],
      success_url: `${origin}${APP_PREFIX}/s/${slug}?boost=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}${APP_PREFIX}/s/${slug}?boost=cancel`,
      allow_promotion_codes: true,
      metadata: {
        kind: "boost",
        slug,
        targetType,
        targetId,
        usdCents: String(usdCents),
        brainstormUserId: user.id,
      },
      integration_identifier: integrationIdentifier("brainstorm_boost"),
    });
    if (!checkout.url) throw new HttpError(502, "Stripe did not return a checkout URL");
    return c.json({ url: checkout.url });
  });

  api.post("/billing/claim", async (c) => {
    const env = c.env as BillingEnv;
    if (!stripePaymentsReady(env)) throw new HttpError(503, "Billing is not configured");
    const body = (await c.req.json().catch(() => null)) as { sessionId?: string } | null;
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
    if (!sessionId.startsWith("cs_")) throw new HttpError(400, "Missing Stripe Checkout session id");
    const stripe = stripeClient(env);
    const checkout = await stripe.checkout.sessions.retrieve(sessionId);
    if (checkout.status !== "complete") throw new HttpError(402, "Checkout is not complete yet");
    await fulfillPaidCheckout(c.env.DB, checkout);

    const userId =
      (typeof checkout.client_reference_id === "string" && checkout.client_reference_id) ||
      (typeof checkout.metadata?.brainstormUserId === "string" && checkout.metadata.brainstormUserId) ||
      null;
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
    const kind = checkoutKind({
      mode: checkout.mode,
      subscription: checkout.subscription,
      metadata: checkout.metadata,
    });
    return c.json({
      ok: true,
      kind,
      active: isArchiveActive(row?.stripe_status),
      status: row?.stripe_status ?? null,
    });
  });

  api.post("/billing/portal", async (c) => {
    const user = await requireActor(c);
    const row = await loadBillingUser(c.env.DB, user.id);
    if (!row?.stripe_customer_id) throw new HttpError(400, "No Stripe customer yet — subscribe first");
    assertLiveOnProduction(c, c.env as BillingEnv);
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
      await fulfillPaidCheckout(db, event.data.object);
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
