import { db } from '@sim/db'
import { copilotServiceUsage } from '@sim/db/schema'
import { and, eq, inArray, isNotNull, isNull, lt, lte, sql } from 'drizzle-orm'
import { TOOL_WATCHDOG_LONG_RUNNING_MS } from '@/lib/mothership/constants'
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

/** A closed row is final, so a tool that outlived its watchdog cannot rewrite its close. */
export async function finishServiceUsage(id: string, error?: string): Promise<void> {
  await db
    .update(copilotServiceUsage)
    .set(error ? { lastError: error } : { deliveredAt: new Date(), lastError: null })
    .where(and(eq(copilotServiceUsage.id, id), isNull(copilotServiceUsage.deliveredAt)))
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

/**
 * An open meter this old outlived the longest tool watchdog and its cleanup, so the process
 * that owned it ended mid-execution and nothing will close it.
 */
const ABANDONED_METER_AGE_MS = 2 * TOOL_WATCHDOG_LONG_RUNNING_MS

/**
 * Ends the tool meters that can no longer resolve and returns each one exactly once, so the
 * caller reports it once. Closing a meter only ends its audit record: known spend was saved
 * as separate receipts, and a meter is never delivered. A pricing failure keeps its error;
 * otherwise the row records that the tool never finished.
 */
export async function closeAbandonedServiceMeters(limit = 100) {
  const abandoned = db
    .select({ id: copilotServiceUsage.id })
    .from(copilotServiceUsage)
    .where(
      and(
        isNull(copilotServiceUsage.costUsd),
        isNull(copilotServiceUsage.deliveredAt),
        lt(copilotServiceUsage.createdAt, new Date(Date.now() - ABANDONED_METER_AGE_MS))
      )
    )
    .limit(limit)
    .for('update', { skipLocked: true })
  return db
    .update(copilotServiceUsage)
    .set({
      deliveredAt: new Date(),
      lastError: sql`coalesce(${copilotServiceUsage.lastError}, 'Tool execution never finished')`,
    })
    .where(inArray(copilotServiceUsage.id, abandoned))
    .returning({
      id: copilotServiceUsage.id,
      streamId: copilotServiceUsage.streamId,
      toolCallId: copilotServiceUsage.toolCallId,
      createdAt: copilotServiceUsage.createdAt,
      lastError: copilotServiceUsage.lastError,
    })
}
