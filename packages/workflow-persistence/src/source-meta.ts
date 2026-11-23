/**
 * Reads and writes a workflow's code metadata (`WorkflowSourceMetaV1`): the idents, declaration
 * order and comments its source form keeps beside the graph, keyed by block id. It lives in the
 * `workflow_source_meta` side table, not on the workflow row or in the normalized state, so it never
 * counts as a deploy change and no ordinary read of the workflow row loads it. A workflow has no
 * row until a source is applied, and an empty value deletes the row.
 *
 * Shared by apps/sim and apps/realtime, so every path that deletes blocks or variables can prune
 * their entries in the same transaction. Readers still tolerate stale ids.
 */

import { workflowSourceMeta } from '@sim/db'
import { createLogger } from '@sim/logger'
import {
  isEmptySourceMeta,
  parseSourceMeta,
  pruneSourceMeta,
  sourceMetaEquals,
  type WorkflowSourceMetaV1,
} from '@sim/workflow-code/source-meta'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { DbOrTx } from './types'

const logger = createLogger('WorkflowSourceMeta')

/**
 * Validates a stored value. An invalid value reads as `null` (and is logged), so one corrupt
 * entry degrades to derived idents and order instead of failing a read.
 */
function readSourceMetaValue(workflowId: string, stored: unknown): WorkflowSourceMetaV1 | null {
  if (stored === null || stored === undefined) return null
  const parsed = parseSourceMeta(stored)
  if (parsed.meta) return parsed.meta
  logger.warn('Ignoring invalid workflow source meta', {
    workflowId,
    codes: parsed.diagnostics.map((diagnostic) => diagnostic.code),
  })
  return null
}

/** The stored value as written, or `undefined` when the workflow has no row. */
async function readStoredSourceMeta(executor: DbOrTx, workflowId: string): Promise<unknown> {
  const [row] = await executor
    .select({ meta: workflowSourceMeta.meta })
    .from(workflowSourceMeta)
    .where(eq(workflowSourceMeta.workflowId, workflowId))
    .limit(1)
  return row?.meta
}

/** The workflow's code metadata, or `null` when it has none or the stored value is invalid. */
export async function readWorkflowSourceMeta(
  executor: DbOrTx,
  workflowId: string
): Promise<WorkflowSourceMetaV1 | null> {
  return readSourceMetaValue(workflowId, await readStoredSourceMeta(executor, workflowId))
}

/** {@link readWorkflowSourceMeta} for many workflows in one query, by workflow id. */
export async function readWorkflowSourceMetas(
  executor: DbOrTx,
  workflowIds: readonly string[]
): Promise<Map<string, WorkflowSourceMetaV1 | null>> {
  const metas = new Map<string, WorkflowSourceMetaV1 | null>()
  if (workflowIds.length === 0) return metas
  const rows = await executor
    .select({ workflowId: workflowSourceMeta.workflowId, meta: workflowSourceMeta.meta })
    .from(workflowSourceMeta)
    .where(inArray(workflowSourceMeta.workflowId, [...workflowIds]))
  for (const row of rows) metas.set(row.workflowId, readSourceMetaValue(row.workflowId, row.meta))
  return metas
}

/**
 * Stores `meta` for an existing workflow (the row references it). An empty value deletes the row,
 * so untouched workflows keep none.
 */
export async function writeWorkflowSourceMeta(
  executor: DbOrTx,
  workflowId: string,
  meta: WorkflowSourceMetaV1 | null
): Promise<void> {
  if (!meta || isEmptySourceMeta(meta)) {
    await executor.delete(workflowSourceMeta).where(eq(workflowSourceMeta.workflowId, workflowId))
    return
  }
  const updatedAt = new Date()
  await executor
    .insert(workflowSourceMeta)
    .values({ workflowId, meta, updatedAt })
    .onConflictDoUpdate({ target: workflowSourceMeta.workflowId, set: { meta, updatedAt } })
}

/**
 * Drops the entries of blocks and variables that no longer exist. Call it inside the transaction
 * that deletes them. A workflow without code metadata costs one primary-key read and no write.
 *
 * The write is a compare-and-set on the value just read: when another writer replaced the value
 * in between, its value wins and this prune is skipped (stale ids are harmless, every reader
 * filters by the stored graph).
 */
export async function pruneWorkflowSourceMeta(
  executor: DbOrTx,
  workflowId: string,
  live: { blocks?: (id: string) => boolean; variables?: (id: string) => boolean }
): Promise<void> {
  const stored = await readStoredSourceMeta(executor, workflowId)
  if (stored === undefined) return
  const meta = readSourceMetaValue(workflowId, stored)
  if (!meta) return
  const pruned = pruneSourceMeta(meta, live)
  if (sourceMetaEquals(pruned, meta)) return
  const unchanged = and(
    eq(workflowSourceMeta.workflowId, workflowId),
    sql`${workflowSourceMeta.meta} = ${JSON.stringify(stored)}::jsonb`
  )
  if (isEmptySourceMeta(pruned)) {
    await executor.delete(workflowSourceMeta).where(unchanged)
    return
  }
  await executor
    .update(workflowSourceMeta)
    .set({ meta: pruned, updatedAt: new Date() })
    .where(unchanged)
}
