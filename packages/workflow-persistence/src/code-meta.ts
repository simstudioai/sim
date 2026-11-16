/**
 * Reads and writes `workflow.code_meta` (`WorkflowCodeMetaV1`): the bindings, declaration order
 * and comments a workflow's source form keeps beside its graph, keyed by block id. It lives on the
 * workflow row, not in the normalized state, so it never counts as a deploy change.
 *
 * Shared by apps/sim and apps/realtime, so every path that deletes blocks or variables can prune
 * their entries in the same transaction. Readers still tolerate stale ids.
 */

import { workflow } from '@sim/db'
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
export function readCodeMetaValue(workflowId: string, stored: unknown): WorkflowCodeMetaV1 | null {
  if (stored === null || stored === undefined) return null
  const parsed = parseCodeMeta(stored)
  if (parsed.meta) return parsed.meta
  logger.warn('Ignoring invalid workflow code_meta', {
    workflowId,
    codes: parsed.diagnostics.map((diagnostic) => diagnostic.code),
  })
  return null
}

/** The workflow's `code_meta`, or `null` when it has none or the stored value is invalid. */
export async function readWorkflowCodeMeta(
  executor: DbOrTx,
  workflowId: string
): Promise<WorkflowCodeMetaV1 | null> {
  const [row] = await executor
    .select({ codeMeta: workflow.codeMeta })
    .from(workflow)
    .where(eq(workflow.id, workflowId))
    .limit(1)
  return row ? readCodeMetaValue(workflowId, row.codeMeta) : null
}

/** Stores `meta`; an empty value is stored as `null`, so untouched workflows stay `null`. */
export async function writeWorkflowCodeMeta(
  executor: DbOrTx,
  workflowId: string,
  meta: WorkflowCodeMetaV1 | null
): Promise<void> {
  await executor
    .update(workflow)
    .set({ codeMeta: meta && !isEmptyCodeMeta(meta) ? meta : null })
    .where(eq(workflow.id, workflowId))
}

/**
 * Drops the entries of blocks and variables that no longer exist. Call it inside the transaction
 * that deletes them. A workflow without `code_meta` costs one primary-key read and no write.
 *
 * The write is a compare-and-set on the value just read: when another writer replaced
 * `code_meta` in between, its value wins and this prune is skipped (stale ids are harmless,
 * every reader filters by the stored graph).
 */
export async function pruneWorkflowCodeMeta(
  executor: DbOrTx,
  workflowId: string,
  live: { blocks?: (id: string) => boolean; variables?: (id: string) => boolean }
): Promise<void> {
  const [row] = await executor
    .select({ codeMeta: workflow.codeMeta })
    .from(workflow)
    .where(eq(workflow.id, workflowId))
    .limit(1)
  if (!row || row.codeMeta === null) return
  const meta = readCodeMetaValue(workflowId, row.codeMeta)
  if (!meta) return
  const pruned = pruneCodeMeta(meta, live)
  if (codeMetaEquals(pruned, meta)) return
  await executor
    .update(workflow)
    .set({ codeMeta: isEmptyCodeMeta(pruned) ? null : pruned })
    .where(
      and(
        eq(workflow.id, workflowId),
        sql`${workflow.codeMeta} = ${JSON.stringify(row.codeMeta)}::jsonb`
      )
    )
}
