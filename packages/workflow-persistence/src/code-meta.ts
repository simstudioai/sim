/**
 * Reads and writes a workflow's code metadata (`WorkflowCodeMetaV1`): the bindings, declaration
 * order and comments its source form keeps beside the graph, keyed by block id. It lives in the
 * `workflow_code_meta` side table, not on the workflow row or in the normalized state, so it never
 * counts as a deploy change and no ordinary read of the workflow row loads it. A workflow has no
 * row until a source is applied, and an empty value deletes the row.
 *
 * Shared by apps/sim and apps/realtime, so every path that deletes blocks or variables can prune
 * their entries in the same transaction. Readers still tolerate stale ids.
 */

import { workflowCodeMeta } from '@sim/db'
import { createLogger } from '@sim/logger'
import {
  codeMetaEquals,
  isEmptyCodeMeta,
  parseCodeMeta,
  pruneCodeMeta,
  type WorkflowCodeMetaV1,
} from '@sim/workflow-code/code-meta'
import { and, eq, sql } from 'drizzle-orm'
import type { DbOrTx } from './types'

const logger = createLogger('WorkflowCodeMeta')

/**
 * Validates a stored value. An invalid value reads as `null` (and is logged), so one corrupt
 * entry degrades to derived bindings and order instead of failing a read.
 */
function readCodeMetaValue(workflowId: string, stored: unknown): WorkflowCodeMetaV1 | null {
  if (stored === null || stored === undefined) return null
  const parsed = parseCodeMeta(stored)
  if (parsed.meta) return parsed.meta
  logger.warn('Ignoring invalid workflow code_meta', {
    workflowId,
    codes: parsed.diagnostics.map((diagnostic) => diagnostic.code),
  })
  return null
}

/** The stored value as written, or `undefined` when the workflow has no row. */
async function readStoredCodeMeta(executor: DbOrTx, workflowId: string): Promise<unknown> {
  const [row] = await executor
    .select({ meta: workflowCodeMeta.meta })
    .from(workflowCodeMeta)
    .where(eq(workflowCodeMeta.workflowId, workflowId))
    .limit(1)
  return row?.meta
}

/** The workflow's code metadata, or `null` when it has none or the stored value is invalid. */
export async function readWorkflowCodeMeta(
  executor: DbOrTx,
  workflowId: string
): Promise<WorkflowCodeMetaV1 | null> {
  return readCodeMetaValue(workflowId, await readStoredCodeMeta(executor, workflowId))
}

/**
 * Stores `meta` for an existing workflow (the row references it). An empty value deletes the row,
 * so untouched workflows keep none.
 */
export async function writeWorkflowCodeMeta(
  executor: DbOrTx,
  workflowId: string,
  meta: WorkflowCodeMetaV1 | null
): Promise<void> {
  if (!meta || isEmptyCodeMeta(meta)) {
    await executor.delete(workflowCodeMeta).where(eq(workflowCodeMeta.workflowId, workflowId))
    return
  }
  const updatedAt = new Date()
  await executor
    .insert(workflowCodeMeta)
    .values({ workflowId, meta, updatedAt })
    .onConflictDoUpdate({ target: workflowCodeMeta.workflowId, set: { meta, updatedAt } })
}

/**
 * Drops the entries of blocks and variables that no longer exist. Call it inside the transaction
 * that deletes them. A workflow without code metadata costs one primary-key read and no write.
 *
 * The write is a compare-and-set on the value just read: when another writer replaced the value
 * in between, its value wins and this prune is skipped (stale ids are harmless, every reader
 * filters by the stored graph).
 */
export async function pruneWorkflowCodeMeta(
  executor: DbOrTx,
  workflowId: string,
  live: { blocks?: (id: string) => boolean; variables?: (id: string) => boolean }
): Promise<void> {
  const stored = await readStoredCodeMeta(executor, workflowId)
  if (stored === undefined) return
  const meta = readCodeMetaValue(workflowId, stored)
  if (!meta) return
  const pruned = pruneCodeMeta(meta, live)
  if (codeMetaEquals(pruned, meta)) return
  const unchanged = and(
    eq(workflowCodeMeta.workflowId, workflowId),
    sql`${workflowCodeMeta.meta} = ${JSON.stringify(stored)}::jsonb`
  )
  if (isEmptyCodeMeta(pruned)) {
    await executor.delete(workflowCodeMeta).where(unchanged)
    return
  }
  await executor
    .update(workflowCodeMeta)
    .set({ meta: pruned, updatedAt: new Date() })
    .where(unchanged)
}
