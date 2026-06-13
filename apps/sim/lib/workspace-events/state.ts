import { db } from '@sim/db'
import { simTriggerState } from '@sim/db/schema'
import { and, eq, sql } from 'drizzle-orm'

/**
 * Reads the last firing time for a subscription scope. Cheap pre-check used
 * to skip rule SQL while a subscription is cooling down; the atomic claim in
 * {@link claimCooldown} remains the source of truth.
 */
export async function readLastFiredAt(
  workflowId: string,
  blockId: string,
  scopeKey: string
): Promise<Date | null> {
  const rows = await db
    .select({ lastFiredAt: simTriggerState.lastFiredAt })
    .from(simTriggerState)
    .where(
      and(
        eq(simTriggerState.workflowId, workflowId),
        eq(simTriggerState.blockId, blockId),
        eq(simTriggerState.scopeKey, scopeKey)
      )
    )
    .limit(1)

  return rows[0]?.lastFiredAt ?? null
}

/**
 * Atomically claims a cooldown slot for a subscription scope.
 *
 * Uses an upsert whose update only applies when the previous firing is
 * outside the cooldown window, so concurrent qualifying events can never
 * double-fire: exactly one caller gets a row back.
 *
 * State is keyed by (workflowId, blockId, scopeKey) rather than the webhook
 * row so cooldowns survive redeploys (webhook rows are recreated per
 * deployment version).
 */
export async function claimCooldown(
  workflowId: string,
  blockId: string,
  scopeKey: string,
  cooldownMs: number
): Promise<boolean> {
  const now = new Date()
  const threshold = new Date(now.getTime() - cooldownMs)

  const rows = await db
    .insert(simTriggerState)
    .values({
      workflowId,
      blockId,
      scopeKey,
      lastFiredAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [simTriggerState.workflowId, simTriggerState.blockId, simTriggerState.scopeKey],
      set: { lastFiredAt: now, updatedAt: now },
      setWhere: sql`${simTriggerState.lastFiredAt} IS NULL OR ${simTriggerState.lastFiredAt} < ${threshold}`,
    })
    .returning({ workflowId: simTriggerState.workflowId })

  return rows.length > 0
}

export function isWithinCooldown(lastFiredAt: Date | null, cooldownMs: number): boolean {
  if (!lastFiredAt) return false
  return Date.now() - lastFiredAt.getTime() < cooldownMs
}
