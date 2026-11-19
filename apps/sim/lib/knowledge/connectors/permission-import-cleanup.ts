import { db } from '@sim/db'
import {
  knowledgeConnectorPermissionImportGrant as grants,
  knowledgeConnectorPermissionImportIdentity as identities,
  knowledgeConnectorPermissionImport as imports,
  knowledgeConnector,
  knowledgeConnectorPermissionSnapshot as snapshots,
} from '@sim/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  continueOutboxHandler,
  deferOutboxHandler,
  enqueueOutboxEvent,
  type OutboxHandler,
} from '@/lib/core/outbox/service'
import type { DbOrTx } from '@/lib/db/types'
import { KNOWLEDGE_PERMISSION_IMPORT_CLEANUP_EVENT } from '@/lib/knowledge/connectors/outbox-events'

const ROW_BATCH_SIZE = 10_000
const MAX_BATCHES_PER_RUN = 100
const RUN_BUDGET_MS = 30_000

const cleanupPayloadSchema = z
  .object({
    version: z.literal(1),
    importId: z.string().min(1).max(256),
    connectorId: z.string().min(1).max(256),
  })
  .strict()

/** The import's creation or retirement and its cleanup intent must commit together. */
export async function enqueuePermissionImportCleanup(
  tx: DbOrTx,
  importId: string,
  connectorId: string,
  availableAt = new Date()
): Promise<void> {
  await enqueueOutboxEvent(
    tx,
    KNOWLEDGE_PERMISSION_IMPORT_CLEANUP_EVENT,
    cleanupPayloadSchema.parse({ version: 1, importId, connectorId }),
    { maxAttempts: 48, availableAt }
  )
}

/** The caller holds the canonical connector lock and has established that these rows may be removed. */
export async function drainPermissionImport(
  tx: DbOrTx,
  importId: string
): Promise<'progress' | 'complete'> {
  for (const table of [grants, identities]) {
    const [deleted] = await tx.execute<{ count: number }>(sql`
      with doomed as materialized (
        select ctid from ${table} where import_id = ${importId} limit ${ROW_BATCH_SIZE}
      ), removed as (
        delete from ${table} as target using doomed where target.ctid = doomed.ctid returning 1
      ) select count(*)::integer as count from removed`)
    if (deleted?.count) return 'progress'
  }
  await tx.delete(imports).where(eq(imports.id, importId))
  return 'complete'
}

/** Active generations survive expiry; abandoned and superseded imports drain across durable continuations. */
export const cleanupPermissionImport: OutboxHandler = async (rawPayload, context) => {
  const payload = cleanupPayloadSchema.parse(rawPayload)
  const deadline = Math.min(
    Date.now() + RUN_BUDGET_MS,
    context.deadlineAt ?? Number.POSITIVE_INFINITY
  )
  for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
    context.signal.throwIfAborted()
    const outcome = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`)
      await tx.execute(sql`SET LOCAL statement_timeout = '10s'`)
      const [source] = await tx
        .select({ id: knowledgeConnector.id })
        .from(knowledgeConnector)
        .where(eq(knowledgeConnector.id, payload.connectorId))
        .for('update')
        .limit(1)
      if (!source) return { status: 'complete' } as const
      const [record] = await tx
        .select({
          expiresAt: imports.expiresAt,
          completedRevision: imports.completedRevision,
          active: sql<boolean>`${snapshots.payload} ->> 'importId' = ${imports.id}`,
        })
        .from(imports)
        .leftJoin(snapshots, eq(snapshots.connectorId, imports.connectorId))
        .where(and(eq(imports.id, payload.importId), eq(imports.connectorId, source.id)))
        .limit(1)
      if (!record || record.active) return { status: 'complete' } as const
      if (record.completedRevision === null && record.expiresAt > new Date())
        return { status: 'unexpired', expiresAt: record.expiresAt } as const
      const status = await drainPermissionImport(tx, payload.importId)
      context.signal.throwIfAborted()
      return { status }
    })
    if (outcome.status === 'complete') return
    if (outcome.status === 'unexpired')
      return deferOutboxHandler(
        'Permission import has not expired',
        Math.max(1, outcome.expiresAt.getTime() - Date.now())
      )
    if (Date.now() >= deadline) break
  }
  return continueOutboxHandler('Permission import cleanup committed a bounded batch', 1_000)
}
