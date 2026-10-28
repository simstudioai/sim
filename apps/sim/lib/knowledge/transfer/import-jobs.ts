/**
 * The `knowledge_base_import` state machine: `running` → `completed` | `failed`
 * | `canceled`. Every write after creation is guarded on `running`, so a cancel
 * or the stale-job janitor always wins over a runner that is still finishing a
 * document: the runner's next write matches nothing, and it stops.
 */

import { db } from '@sim/db'
import { knowledgeBaseImport } from '@sim/db/schema'
import { truncate } from '@sim/utils/string'
import { and, eq, isNull } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'

/** Where an import's uploaded bundle is stored until the import settles. */
export const KNOWLEDGE_IMPORT_STORAGE_CONTEXT = 'knowledge-import'

export type KnowledgeImportRecord = typeof knowledgeBaseImport.$inferSelect

/** A document the import could not bring over, and why. */
export type KnowledgeImportFailure = KnowledgeImportRecord['failures'][number]

/** How many document failures an import keeps; the count beyond it is still exact. */
export const MAX_KNOWLEDGE_IMPORT_FAILURE_SAMPLES = 10
const MAX_ERROR_LENGTH = 2000

function whileRunning(importId: string) {
  return and(eq(knowledgeBaseImport.id, importId), eq(knowledgeBaseImport.status, 'running'))
}

/**
 * Records an import whose archive has finished uploading. Returns `null` when
 * the id is already recorded, so a repeated completion never dispatches twice.
 */
export async function insertKnowledgeImport(values: {
  id: string
  workspaceId: string
  userId: string
  sourceKey: string
}): Promise<KnowledgeImportRecord | null> {
  const [inserted] = await db
    .insert(knowledgeBaseImport)
    .values(values)
    .onConflictDoNothing({ target: knowledgeBaseImport.id })
    .returning()
  return inserted ?? null
}

export async function findKnowledgeImport(params: {
  importId: string
  assertedWorkspaceId?: string
}): Promise<KnowledgeImportRecord | null> {
  const [row] = await db
    .select()
    .from(knowledgeBaseImport)
    .where(
      and(
        eq(knowledgeBaseImport.id, params.importId),
        params.assertedWorkspaceId === undefined
          ? undefined
          : eq(knowledgeBaseImport.workspaceId, params.assertedWorkspaceId)
      )
    )
    .limit(1)
  return row ?? null
}

export async function getKnowledgeImport(params: {
  importId: string
  assertedWorkspaceId?: string
}): Promise<KnowledgeImportRecord> {
  const record = await findKnowledgeImport(params)
  if (!record) throw new OrchestrationError('not_found', 'Knowledge base import not found')
  return record
}

/**
 * Claims a running import for one worker. Returns `false` when another worker
 * already claimed it, or it settled, so a duplicate dispatch exits untouched.
 */
export async function claimKnowledgeImport(importId: string): Promise<boolean> {
  const now = new Date()
  const claimed = await db
    .update(knowledgeBaseImport)
    .set({ startedAt: now, updatedAt: now })
    .where(and(whileRunning(importId), isNull(knowledgeBaseImport.startedAt)))
    .returning({ id: knowledgeBaseImport.id })
  return claimed.length > 0
}

/**
 * Records the runner's progress, which doubles as its heartbeat. Returns
 * `false` once the import is no longer running, which tells the runner to stop.
 */
export async function updateRunningKnowledgeImport(
  importId: string,
  values: Partial<
    Pick<
      KnowledgeImportRecord,
      | 'knowledgeBaseId'
      | 'documentsTotal'
      | 'documentsImported'
      | 'documentsFailed'
      | 'vectorsReused'
      | 'failures'
    >
  >
): Promise<boolean> {
  const updated = await db
    .update(knowledgeBaseImport)
    .set({ ...values, updatedAt: new Date() })
    .where(whileRunning(importId))
    .returning({ id: knowledgeBaseImport.id })
  return updated.length > 0
}

/** Settles a running import. A no-op once it has already settled. */
export async function finishKnowledgeImport(
  importId: string,
  outcome: { status: 'completed' } | { status: 'failed'; error: string }
): Promise<void> {
  const now = new Date()
  await db
    .update(knowledgeBaseImport)
    .set({
      status: outcome.status,
      error: outcome.status === 'failed' ? truncate(outcome.error, MAX_ERROR_LENGTH) : null,
      completedAt: now,
      updatedAt: now,
    })
    .where(whileRunning(importId))
}

/**
 * Stops a running import. The runner sees the change at its next progress
 * write; the documents it already brought over stay in the base.
 */
export async function stopKnowledgeImport(
  record: KnowledgeImportRecord
): Promise<KnowledgeImportRecord> {
  if (record.status === 'canceled') return record
  if (record.status !== 'running') {
    throw new OrchestrationError('conflict', `Knowledge base import is ${record.status}`)
  }
  const now = new Date()
  const [canceled] = await db
    .update(knowledgeBaseImport)
    .set({ status: 'canceled', completedAt: now, updatedAt: now })
    .where(and(whileRunning(record.id), eq(knowledgeBaseImport.workspaceId, record.workspaceId)))
    .returning()
  if (canceled) return canceled
  const current = await getKnowledgeImport({
    importId: record.id,
    assertedWorkspaceId: record.workspaceId,
  })
  if (current.status === 'canceled') return current
  throw new OrchestrationError('conflict', `Knowledge base import is ${current.status}`)
}
