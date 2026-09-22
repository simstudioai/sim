import { db } from '@sim/db'
import { copilotServiceUsage } from '@sim/db/schema'
import { and, eq, isNotNull, isNull, lte, sql } from 'drizzle-orm'
import type { ServiceUsageReceipt } from '@/lib/mothership/generated/billing'

export async function saveServiceUsage(
  receipt: ServiceUsageReceipt,
  workerOrigin: string
): Promise<void> {
  await db
    .insert(copilotServiceUsage)
    .values({ ...receipt, workerOrigin, costUsd: receipt.costUsd.toFixed(8) })
    .onConflictDoNothing()
}

/** Each process gets a bounded batch; a dead claimant becomes eligible after five minutes. */
export async function claimServiceUsage(limit = 10) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(copilotServiceUsage)
      .where(
        and(
          isNotNull(copilotServiceUsage.costUsd),
          isNull(copilotServiceUsage.deliveredAt),
          lte(copilotServiceUsage.nextAttemptAt, new Date())
        )
      )
      .orderBy(copilotServiceUsage.nextAttemptAt)
      .limit(limit)
      .for('update', { skipLocked: true })
    for (const row of rows)
      await tx
        .update(copilotServiceUsage)
        .set({
          nextAttemptAt: new Date(Date.now() + 300_000),
          attempts: sql`${copilotServiceUsage.attempts} + 1`,
        })
        .where(eq(copilotServiceUsage.id, row.id))
    return rows
  })
}

export async function finishServiceUsage(id: string, error?: string): Promise<void> {
  await db
    .update(copilotServiceUsage)
    .set(error ? { lastError: error } : { deliveredAt: new Date(), lastError: null })
    .where(eq(copilotServiceUsage.id, id))
}

export async function beginServiceMeter(input: {
  id: string
  streamId: string
  toolCallId: string
  workerOrigin: string
}): Promise<void> {
  await db
    .insert(copilotServiceUsage)
    .values({ ...input, service: '_tool_execution', costUsd: null })
}

export async function serviceMeteringHealth() {
  const [health] = await db
    .select({
      pending: sql<number>`count(*) FILTER (WHERE delivered_at IS NULL AND cost_usd IS NOT NULL)::int`,
      unknown: sql<number>`count(*) FILTER (WHERE delivered_at IS NULL AND cost_usd IS NULL AND created_at < now() - interval '5 minutes')::int`,
      oldest: sql<Date | null>`min(created_at) FILTER (WHERE delivered_at IS NULL)`,
    })
    .from(copilotServiceUsage)
  return health
}
