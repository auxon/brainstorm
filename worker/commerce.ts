/**
 * One-off Stripe SKUs that are not the Archive subscription:
 * featured boards ($29 / 7 days) and USD idea boosts ($1 / $3 / $5).
 */
import { newId } from "./ids";
import { HttpError } from "./types";
import { BOOST_OPTIONS, FEATURE_AMOUNT_USD, featureWindowMs } from "./billing-lib";

export async function paymentAlreadyRecorded(db: D1Database, checkoutSessionId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT checkout_session_id FROM stripe_payments WHERE checkout_session_id = ?")
    .bind(checkoutSessionId)
    .first();
  return Boolean(row);
}

async function recordPayment(
  db: D1Database,
  input: {
    checkoutSessionId: string;
    kind: "feature" | "boost";
    userId: string | null;
    sessionId: string | null;
    targetType?: string | null;
    targetId?: string | null;
    usdCents: number;
  },
): Promise<boolean> {
  try {
    await db
      .prepare(
        "INSERT INTO stripe_payments (checkout_session_id, kind, user_id, session_id, target_type, target_id, usd_cents, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        input.checkoutSessionId,
        input.kind,
        input.userId,
        input.sessionId,
        input.targetType ?? null,
        input.targetId ?? null,
        input.usdCents,
        Date.now(),
      )
      .run();
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/unique|constraint/i.test(message)) return false;
    throw err;
  }
}

export async function fulfillFeature(
  db: D1Database,
  input: { checkoutSessionId: string; slug: string; userId: string | null },
): Promise<void> {
  if (await paymentAlreadyRecorded(db, input.checkoutSessionId)) return;
  const session = await db
    .prepare("SELECT id, slug FROM sessions WHERE slug = ?")
    .bind(input.slug)
    .first<{ id: string; slug: string }>();
  if (!session) throw new HttpError(404, "Session not found");
  const inserted = await recordPayment(db, {
    checkoutSessionId: input.checkoutSessionId,
    kind: "feature",
    userId: input.userId,
    sessionId: session.id,
    usdCents: FEATURE_AMOUNT_USD * 100,
  });
  if (!inserted) return;
  const now = Date.now();
  const current = await db
    .prepare("SELECT ends_at FROM featured WHERE session_id = ? AND ends_at > ? ORDER BY ends_at DESC LIMIT 1")
    .bind(session.id, now)
    .first<{ ends_at: number }>();
  const startsAt = current && current.ends_at > now ? current.ends_at : now;
  await db
    .prepare(
      "INSERT INTO featured (id, session_id, paid_by, stripe_checkout_id, starts_at, ends_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      newId(),
      session.id,
      input.userId ?? "unknown",
      input.checkoutSessionId,
      startsAt,
      startsAt + featureWindowMs(),
      now,
    )
    .run();
  await db
    .prepare("UPDATE sessions SET visibility = 'public', updated_at = ? WHERE id = ?")
    .bind(now, session.id)
    .run();
}

export function boostUsdToCents(usd: number): number | null {
  const match = BOOST_OPTIONS.find((b) => b.usd === usd);
  return match ? match.usd * 100 : null;
}

export async function fulfillBoost(
  db: D1Database,
  input: {
    checkoutSessionId: string;
    slug: string;
    userId: string | null;
    targetType: "idea" | "comment";
    targetId: string;
    usdCents: number;
  },
): Promise<void> {
  if (await paymentAlreadyRecorded(db, input.checkoutSessionId)) return;
  if (!BOOST_OPTIONS.some((b) => b.usd * 100 === input.usdCents)) {
    throw new HttpError(400, "Invalid boost amount");
  }
  const session = await db
    .prepare("SELECT id FROM sessions WHERE slug = ?")
    .bind(input.slug)
    .first<{ id: string }>();
  if (!session) throw new HttpError(404, "Session not found");
  const table = input.targetType === "idea" ? "ideas" : "comments";
  const target = await db
    .prepare(`SELECT id FROM ${table} WHERE id = ? AND session_id = ?`)
    .bind(input.targetId, session.id)
    .first();
  if (!target) throw new HttpError(404, "Boost target not found");
  const inserted = await recordPayment(db, {
    checkoutSessionId: input.checkoutSessionId,
    kind: "boost",
    userId: input.userId,
    sessionId: session.id,
    targetType: input.targetType,
    targetId: input.targetId,
    usdCents: input.usdCents,
  });
  if (!inserted) return;

  const userId = input.userId ?? "stripe";
  const existing = await db
    .prepare("SELECT id FROM votes WHERE user_id = ? AND target_type = ? AND target_id = ?")
    .bind(userId, input.targetType, input.targetId)
    .first<{ id: string }>();
  if (existing) {
    await db
      .prepare("UPDATE votes SET usd_cents = usd_cents + ? WHERE id = ?")
      .bind(input.usdCents, existing.id)
      .run();
  } else {
    await db
      .prepare(
        "INSERT INTO votes (id, session_id, target_type, target_id, user_id, satoshis, usd_cents, txid, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)",
      )
      .bind(newId(), session.id, input.targetType, input.targetId, userId, input.usdCents, input.checkoutSessionId, Date.now())
      .run();
    await db.prepare(`UPDATE ${table} SET vote_count = vote_count + 1 WHERE id = ?`).bind(input.targetId).run();
  }
  await db.prepare(`UPDATE ${table} SET usd_cents = usd_cents + ? WHERE id = ?`).bind(input.usdCents, input.targetId).run();
  await db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").bind(Date.now(), session.id).run();
}

export async function activeFeaturedUntil(db: D1Database, sessionId: string): Promise<number | null> {
  const row = await db
    .prepare("SELECT MAX(ends_at) as ends_at FROM featured WHERE session_id = ? AND ends_at > ?")
    .bind(sessionId, Date.now())
    .first<{ ends_at: number | null }>();
  return row?.ends_at ?? null;
}
