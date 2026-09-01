import type { Sql } from 'postgres'
import type { ScriptMigration } from './types'

export const FORK_KB_OWNERSHIP_REPAIR_BATCH_SIZE = 250
export const FORK_KB_OWNERSHIP_POST_DRAIN_ACK = 'old-apps-drained'

export interface ForkKnowledgeBaseOwnershipRepairResult {
  scanned: number
  inserted: number
  unresolved: number
}

interface ForkKnowledgeBaseOwnershipRepairBatchResult {
  inserted: number
  unresolved: number
}

export interface ForkKnowledgeBaseOwnershipRepairStore {
  listCandidateDocumentIds(afterId: string, limit: number): Promise<string[]>
  repairDocumentIds(
    documentIds: readonly string[]
  ): Promise<ForkKnowledgeBaseOwnershipRepairBatchResult>
}

interface ForkKnowledgeBaseOwnershipRepairOptions {
  batchSize?: number
}

/** Validates the explicit operator acknowledgement required by the post-cutover rerun. */
export function assertForkKnowledgeBaseOwnershipPostDrainAck(value: string | undefined): void {
  if (value !== FORK_KB_OWNERSHIP_POST_DRAIN_ACK) {
    throw new Error(
      `Set KB_FORK_OWNERSHIP_RECONCILE_ACK=${FORK_KB_OWNERSHIP_POST_DRAIN_ACK} only after old app instances are drained`
    )
  }
}

/** Fails the operator-run reconciliation when any conflicting binding still needs review. */
export function assertForkKnowledgeBaseOwnershipFullyReconciled(
  result: ForkKnowledgeBaseOwnershipRepairResult
): void {
  if (result.unresolved > 0) {
    throw new Error(
      `Fork knowledge-base ownership reconciliation left ${result.unresolved} conflicting document(s) unresolved`
    )
  }
}

/**
 * Repairs only the deterministic KB-file bindings written by workspace forks.
 * Candidate ids are keyset-paged and each page is committed before the next is
 * loaded, keeping application memory and database transaction size bounded.
 */
export async function reconcileForkKnowledgeBaseFileOwnership(
  store: ForkKnowledgeBaseOwnershipRepairStore,
  options: ForkKnowledgeBaseOwnershipRepairOptions = {}
): Promise<ForkKnowledgeBaseOwnershipRepairResult> {
  const batchSize = options.batchSize ?? FORK_KB_OWNERSHIP_REPAIR_BATCH_SIZE
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error('Fork KB ownership repair batch size must be a positive integer')
  }

  const result: ForkKnowledgeBaseOwnershipRepairResult = {
    scanned: 0,
    inserted: 0,
    unresolved: 0,
  }
  let afterId = ''

  for (;;) {
    const documentIds = await store.listCandidateDocumentIds(afterId, batchSize)
    if (documentIds.length === 0) return result
    if (documentIds.length > batchSize) {
      throw new Error('Fork KB ownership repair store returned an oversized page')
    }

    const lastId = documentIds.at(-1)
    if (!lastId || lastId <= afterId) {
      throw new Error('Fork KB ownership repair store returned a non-advancing page')
    }

    const batch = await store.repairDocumentIds(documentIds)
    result.scanned += documentIds.length
    result.inserted += batch.inserted
    result.unresolved += batch.unresolved
    afterId = lastId
  }
}

/** Creates the PostgreSQL implementation used by both deploy-time and post-drain repair. */
export function createPostgresForkKnowledgeBaseOwnershipRepairStore(
  sql: Sql
): ForkKnowledgeBaseOwnershipRepairStore {
  return {
    async listCandidateDocumentIds(afterId, limit) {
      const rows = await sql<Array<{ id: string }>>`
        SELECT d.id
        FROM document d
        INNER JOIN knowledge_base kb ON kb.id = d.knowledge_base_id
        WHERE d.id > ${afterId}
          AND d.id ~ '^fork_document_[0-9a-f]{40}$'
          AND d.storage_key = 'kb/fork-' || d.id
          AND d.user_excluded = false
          AND d.archived_at IS NULL
          AND d.deleted_at IS NULL
          AND kb.deleted_at IS NULL
          AND kb.workspace_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM workspace_files bound
            WHERE bound.key = d.storage_key
              AND bound.context = 'knowledge-base'
              AND bound.workspace_id = kb.workspace_id
              AND bound.deleted_at IS NULL
          )
        ORDER BY d.id
        LIMIT ${limit}
      `
      return rows.map((row) => row.id)
    },

    async repairDocumentIds(documentIds) {
      if (documentIds.length === 0) return { inserted: 0, unresolved: 0 }

      return sql.begin(async (tx) => {
        const inserted = await tx<Array<{ key: string }>>`
          INSERT INTO workspace_files (
            id,
            key,
            user_id,
            workspace_id,
            context,
            original_name,
            display_name,
            content_type,
            size_bytes
          )
          SELECT
            gen_random_uuid()::text,
            d.storage_key,
            coalesce(d.uploaded_by, kb.user_id),
            kb.workspace_id,
            'knowledge-base',
            d.filename,
            d.filename,
            d.mime_type,
            d.file_size
          FROM document d
          INNER JOIN knowledge_base kb ON kb.id = d.knowledge_base_id
          WHERE d.id = ANY(${documentIds}::text[])
            AND d.id ~ '^fork_document_[0-9a-f]{40}$'
            AND d.storage_key = 'kb/fork-' || d.id
            AND d.user_excluded = false
            AND d.archived_at IS NULL
            AND d.deleted_at IS NULL
            AND kb.deleted_at IS NULL
            AND kb.workspace_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1
              FROM document other_document
              INNER JOIN knowledge_base other_kb
                ON other_kb.id = other_document.knowledge_base_id
              WHERE other_document.storage_key = d.storage_key
                AND other_document.user_excluded = false
                AND other_document.archived_at IS NULL
                AND other_document.deleted_at IS NULL
                AND other_kb.deleted_at IS NULL
                AND other_kb.workspace_id IS DISTINCT FROM kb.workspace_id
            )
            AND NOT EXISTS (
              SELECT 1
              FROM workspace_files active_binding
              WHERE active_binding.key = d.storage_key
                AND active_binding.deleted_at IS NULL
            )
          ON CONFLICT DO NOTHING
          RETURNING key
        `

        const [remaining] = await tx<Array<{ count: number | string }>>`
          SELECT count(*) AS count
          FROM document d
          INNER JOIN knowledge_base kb ON kb.id = d.knowledge_base_id
          WHERE d.id = ANY(${documentIds}::text[])
            AND d.id ~ '^fork_document_[0-9a-f]{40}$'
            AND d.storage_key = 'kb/fork-' || d.id
            AND d.user_excluded = false
            AND d.archived_at IS NULL
            AND d.deleted_at IS NULL
            AND kb.deleted_at IS NULL
            AND kb.workspace_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1
              FROM workspace_files bound
              WHERE bound.key = d.storage_key
                AND bound.context = 'knowledge-base'
                AND bound.workspace_id = kb.workspace_id
                AND bound.deleted_at IS NULL
            )
        `

        return {
          inserted: inserted.length,
          unresolved: Number(remaining?.count ?? 0),
        }
      })
    },
  }
}

export const backfillForkKnowledgeBaseFileOwnership: ScriptMigration = {
  name: '0004_backfill_fork_kb_file_ownership',
  async up(sql) {
    const result = await reconcileForkKnowledgeBaseFileOwnership(
      createPostgresForkKnowledgeBaseOwnershipRepairStore(sql)
    )
    console.log(
      `fork KB ownership repair — scanned: ${result.scanned}, inserted: ${result.inserted}, unresolved: ${result.unresolved}`
    )
    if (result.unresolved > 0) {
      console.warn(
        `fork KB ownership repair left ${result.unresolved} conflicting document(s) denied; run the post-drain reconciliation and audit any remaining conflicts`
      )
    }
  },
}
