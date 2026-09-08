import type { ScriptMigration } from '@sim/db/script-migrations/types'
import { createLogger } from '@sim/logger'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import type { Fragment, Sql, TransactionSql } from 'postgres'

const logger = createLogger('LegacyKnowledgeBaseWorkspaces')
export const LEGACY_KB_WORKSPACE_BATCH_SIZE = 100
const MAX_BATCH_SIZE = 250
const MAX_BATCHES = 10_000
const MAX_NAME_ATTEMPTS = 8

type MigrationSql = Sql | TransactionSql
export type LegacyKnowledgeBaseMoveOutcome =
  | 'moved'
  | 'renamed'
  | 'already_scoped'
  | 'no_workspace'
  | 'file_conflict'

export interface LegacyKnowledgeBaseWorkspaceStore {
  listCandidateIds(afterId: string, limit: number): Promise<string[]>
  moveCandidate(id: string): Promise<LegacyKnowledgeBaseMoveOutcome>
}

interface BackfillOptions {
  batchSize?: number
  maxBatches?: number
}

export type LegacyKnowledgeBaseWorkspaceSummary = Record<LegacyKnowledgeBaseMoveOutcome, number>

/** Pages only ids; each KB, its name, and its storage accounting commit atomically. */
export async function backfillLegacyKnowledgeBaseWorkspaces(
  store: LegacyKnowledgeBaseWorkspaceStore,
  options: BackfillOptions = {}
): Promise<LegacyKnowledgeBaseWorkspaceSummary> {
  const batchSize = options.batchSize ?? LEGACY_KB_WORKSPACE_BATCH_SIZE
  const maxBatches = options.maxBatches ?? MAX_BATCHES
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new Error(`KB workspace backfill batch size must be between 1 and ${MAX_BATCH_SIZE}`)
  }
  if (!Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > MAX_BATCHES) {
    throw new Error(`KB workspace backfill batch limit must be between 1 and ${MAX_BATCHES}`)
  }
  const result: LegacyKnowledgeBaseWorkspaceSummary = {
    moved: 0,
    renamed: 0,
    already_scoped: 0,
    no_workspace: 0,
    file_conflict: 0,
  }
  let afterId = ''
  for (let batch = 0; batch <= maxBatches; batch++) {
    const ids = await store.listCandidateIds(afterId, batchSize)
    if (ids.length === 0) return result
    if (batch === maxBatches)
      throw new Error('KB workspace backfill batch limit reached; rerun to resume')
    if (ids.length > batchSize) throw new Error('KB workspace backfill returned an oversized page')
    const lastId = ids.at(-1)
    if (!lastId || lastId === afterId || new Set(ids).size !== ids.length) {
      throw new Error('KB workspace backfill returned a non-advancing page')
    }
    for (const id of ids) result[await store.moveCandidate(id)]++
    afterId = lastId
  }
  return result
}

/**
 * Frozen migration equivalent of getHighestPrioritySubscription: entitled Enterprise > Team >
 * Pro, organization before personal at the same tier. No application imports are available in
 * the migrations image. The final id order makes multiple equivalent subscriptions deterministic.
 */
function legacyPayerId(sql: MigrationSql, userId: string | Fragment): Fragment {
  return sql`coalesce((
    SELECT s.reference_id FROM subscription s
    WHERE s.status IN ('active', 'past_due')
      AND (s.plan = 'enterprise' OR s.plan ~ '^(team|pro)(_|$)')
      AND (s.reference_id = ${userId} OR EXISTS (
        SELECT 1 FROM member m JOIN organization o ON o.id = m.organization_id
        WHERE m.user_id = ${userId} AND o.id = s.reference_id
      ))
    ORDER BY CASE WHEN s.plan = 'enterprise' THEN 3 WHEN s.plan ~ '^team(_|$)' THEN 2 ELSE 1 END DESC,
      (s.reference_id <> ${userId}) DESC, s.reference_id, s.id
    LIMIT 1
  ), ${userId})`
}

/**
 * Read-only destination selection. Prefer enabled Knowledge blocks naming this KB; rank those
 * workspaces by the referring workflows' successful runs. Otherwise use successful runs across
 * all active workflows in the workspace, then recency, last selection, and stable creation/id order.
 * The creator must still hold explicit write/admin access; ownership alone never grants admission.
 */
export async function selectLegacyKnowledgeBaseWorkspace(
  sql: MigrationSql,
  knowledgeBaseId: string
) {
  const [destination] = await sql<Array<{ workspace_id: string; has_reference: boolean }>>`
    WITH kb AS MATERIALIZED (
      SELECT id, user_id FROM knowledge_base
      WHERE id = ${knowledgeBaseId} AND workspace_id IS NULL AND organization_id IS NULL
        AND deleted_at IS NULL AND NOT is_search_index
    ), candidates AS MATERIALIZED (
      SELECT w.id, w.created_at, s.last_active_workspace_id = w.id AS last_selected
      FROM kb
      JOIN permissions p ON p.user_id = kb.user_id AND p.entity_type = 'workspace'
        AND p.permission_type IN ('write', 'admin')
      JOIN workspace w ON w.id = p.entity_id AND w.archived_at IS NULL
      LEFT JOIN settings s ON s.user_id = kb.user_id
    ), activity AS (
      SELECT c.*, a.total_runs, a.last_run_at, a.referring_runs, a.referring_last_run_at, a.has_reference
      FROM candidates c CROSS JOIN kb
      CROSS JOIN LATERAL (
        SELECT coalesce(sum(f.run_count), 0) AS total_runs, max(f.last_run_at) AS last_run_at,
          coalesce(sum(f.run_count) FILTER (WHERE r.found), 0) AS referring_runs,
          max(f.last_run_at) FILTER (WHERE r.found) AS referring_last_run_at,
          coalesce(bool_or(r.found), false) AS has_reference
        FROM workflow f
        CROSS JOIN LATERAL (
          SELECT EXISTS (
            SELECT 1 FROM workflow_blocks b
            CROSS JOIN LATERAL (
              SELECT coalesce(nullif(CASE WHEN b.advanced_mode
                THEN b.sub_blocks #> '{manualKnowledgeBaseId,value}'
                ELSE b.sub_blocks #> '{knowledgeBaseSelector,value}' END, 'null'::jsonb),
                b.sub_blocks #> '{knowledgeBaseId,value}') AS value
            ) v
            WHERE b.workflow_id = f.id AND b.type = 'knowledge' AND b.enabled
              AND (v.value = to_jsonb(kb.id) OR v.value @> jsonb_build_array(kb.id))
          ) AS found
        ) r
        WHERE f.workspace_id = c.id AND f.archived_at IS NULL
      ) a
    )
    SELECT id AS workspace_id, has_reference FROM activity
    ORDER BY has_reference DESC, referring_runs DESC, referring_last_run_at DESC NULLS LAST,
      total_runs DESC, last_run_at DESC NULLS LAST, last_selected DESC NULLS LAST, created_at, id
    LIMIT 1
  `
  return destination ?? null
}

/**
 * Rebuild only the affected payer from workspace ledgers plus retained unscoped/organization KB
 * documents. Legacy counters can already omit orphan bytes, so subtracting those bytes blindly
 * would undercount unrelated storage. Archived but retained documents remain billable.
 */
async function reconcilePayer(tx: TransactionSql, kind: 'user' | 'organization', id: string) {
  if (kind === 'user') {
    await tx`
      UPDATE user_stats SET storage_used_bytes =
        coalesce((SELECT sum(storage_used_bytes) FROM workspace
          WHERE organization_id IS NULL AND billed_account_user_id = ${id}), 0)
        + coalesce((SELECT sum(d.file_size::bigint) FROM knowledge_base k
          JOIN document d ON d.knowledge_base_id = k.id
          WHERE k.user_id = ${id} AND k.workspace_id IS NULL AND k.organization_id IS NULL
            AND d.connector_id IS NULL AND d.deleted_at IS NULL
            AND ${legacyPayerId(tx, id)} = ${id}), 0)
      WHERE user_id = ${id}
    `
  } else {
    await tx`
      UPDATE organization SET storage_used_bytes =
        coalesce((SELECT sum(storage_used_bytes) FROM workspace WHERE organization_id = ${id}), 0)
        + coalesce((SELECT sum(d.file_size::bigint) FROM knowledge_base k
          JOIN document d ON d.knowledge_base_id = k.id
          WHERE k.organization_id = ${id} AND d.connector_id IS NULL AND d.deleted_at IS NULL), 0)
        + coalesce((SELECT sum(d.file_size::bigint) FROM knowledge_base k
          JOIN document d ON d.knowledge_base_id = k.id
          WHERE k.workspace_id IS NULL AND k.organization_id IS NULL
            AND d.connector_id IS NULL AND d.deleted_at IS NULL
            AND EXISTS (SELECT 1 FROM member m WHERE m.user_id = k.user_id AND m.organization_id = ${id})
            AND ${legacyPayerId(tx, tx`k.user_id`)} = ${id}), 0)
      WHERE id = ${id}
    `
  }
}

/** Uses the same KB → workspace → user payer → organization payer lock order as live moves. */
async function moveKnowledgeBase(
  tx: TransactionSql,
  knowledgeBaseId: string
): Promise<LegacyKnowledgeBaseMoveOutcome> {
  const [kb] = await tx<Array<{ user_id: string }>>`
    SELECT user_id FROM knowledge_base
    WHERE id = ${knowledgeBaseId} AND workspace_id IS NULL AND organization_id IS NULL
      AND deleted_at IS NULL AND NOT is_search_index
    FOR UPDATE
  `
  if (!kb) return 'already_scoped'
  const destination = await selectLegacyKnowledgeBaseWorkspace(tx, knowledgeBaseId)
  if (!destination) return 'no_workspace'
  const [target] = await tx<
    Array<{ id: string; organization_id: string | null; billed_account_user_id: string }>
  >`
    SELECT w.id, w.organization_id, w.billed_account_user_id FROM workspace w
    WHERE w.id = ${destination.workspace_id} AND w.archived_at IS NULL
      AND EXISTS (SELECT 1 FROM permissions p WHERE p.user_id = ${kb.user_id}
        AND p.entity_type = 'workspace' AND p.entity_id = w.id AND p.permission_type IN ('write', 'admin'))
    FOR NO KEY UPDATE
  `
  if (!target) return 'no_workspace'
  const [conflict] = await tx<Array<{ found: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM document d JOIN workspace_files f ON f.key = d.storage_key
      WHERE d.knowledge_base_id = ${knowledgeBaseId} AND f.deleted_at IS NULL
        AND (f.context <> 'knowledge-base' OR f.workspace_id IS DISTINCT FROM ${target.id})
    ) AS found
  `
  if (conflict?.found) return 'file_conflict'

  const [source] = await tx<Array<{ id: string }>>`SELECT ${legacyPayerId(tx, kb.user_id)} AS id`
  const sourceKind = source.id === kb.user_id ? 'user' : 'organization'
  const targetKind = target.organization_id ? 'organization' : 'user'
  const targetPayerId = target.organization_id ?? target.billed_account_user_id
  const users = [
    ...new Set([
      ...(sourceKind === 'user' ? [source.id] : []),
      ...(targetKind === 'user' ? [targetPayerId] : []),
    ]),
  ].sort()
  const organizations = [
    ...new Set([
      ...(sourceKind === 'organization' ? [source.id] : []),
      ...(targetKind === 'organization' ? [targetPayerId] : []),
    ]),
  ].sort()
  for (const id of users) {
    await tx`INSERT INTO user_stats (id, user_id) VALUES (${generateId()}, ${id}) ON CONFLICT (user_id) DO NOTHING`
    await tx`SELECT user_id FROM user_stats WHERE user_id = ${id} FOR NO KEY UPDATE`
  }
  for (const id of organizations)
    await tx`SELECT id FROM organization WHERE id = ${id} FOR NO KEY UPDATE`

  const [invalid] = await tx<Array<{ found: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM document d JOIN knowledge_base k ON k.id = d.knowledge_base_id
      WHERE (k.id = ${knowledgeBaseId} OR k.workspace_id = ${target.id})
        AND d.connector_id IS NULL AND d.deleted_at IS NULL AND (d.file_size IS NULL OR d.file_size < 0)
      UNION ALL
      SELECT 1 FROM workspace_files f WHERE f.workspace_id = ${target.id}
        AND f.context = 'workspace' AND (f.size_bytes IS NULL OR f.size_bytes < 0)
    ) AS found
  `
  if (invalid?.found) throw new Error('KB workspace backfill found invalid canonical storage sizes')

  const [moved] = await tx<Array<{ renamed: boolean }>>`
    WITH candidate_names AS (
      SELECT k.name AS old_name, n.attempt,
        CASE WHEN n.attempt = 0 THEN k.name
          ELSE k.name || ' (recovered ' || k.id || CASE WHEN n.attempt = 1 THEN '' ELSE '-' || n.attempt::text END || ')'
        END AS name
      FROM knowledge_base k CROSS JOIN generate_series(0, ${MAX_NAME_ATTEMPTS}) n(attempt)
      WHERE k.id = ${knowledgeBaseId}
    ), chosen AS (
      SELECT name, old_name FROM candidate_names c
      WHERE NOT EXISTS (SELECT 1 FROM knowledge_base existing
        WHERE existing.workspace_id = ${target.id} AND existing.name = c.name AND existing.deleted_at IS NULL)
      ORDER BY attempt LIMIT 1
    )
    UPDATE knowledge_base k SET workspace_id = ${target.id}, folder_id = NULL, name = chosen.name, updated_at = now()
    FROM chosen WHERE k.id = ${knowledgeBaseId} AND k.workspace_id IS NULL AND k.organization_id IS NULL
      AND k.deleted_at IS NULL AND NOT k.is_search_index
    RETURNING k.name <> chosen.old_name AS renamed
  `
  if (!moved) throw new Error('KB workspace backfill could not allocate a unique name')
  await tx`
    UPDATE workspace SET storage_used_bytes =
      coalesce((SELECT sum(size_bytes) FROM workspace_files WHERE workspace_id = ${target.id} AND context = 'workspace'), 0)
      + coalesce((SELECT sum(d.file_size::bigint) FROM document d JOIN knowledge_base k ON k.id = d.knowledge_base_id
        WHERE k.workspace_id = ${target.id} AND d.connector_id IS NULL AND d.deleted_at IS NULL), 0)
    WHERE id = ${target.id}
  `
  for (const id of users) await reconcilePayer(tx, 'user', id)
  for (const id of organizations) await reconcilePayer(tx, 'organization', id)
  return moved.renamed ? 'renamed' : 'moved'
}

export function createPostgresLegacyKnowledgeBaseWorkspaceStore(
  sql: Sql
): LegacyKnowledgeBaseWorkspaceStore {
  return {
    async listCandidateIds(afterId, limit) {
      const rows = await sql<Array<{ id: string }>>`
        SELECT id FROM knowledge_base WHERE id > ${afterId}
          AND workspace_id IS NULL AND organization_id IS NULL AND deleted_at IS NULL AND NOT is_search_index
        ORDER BY id LIMIT ${limit}
      `
      return rows.map((row) => row.id)
    },
    async moveCandidate(id) {
      for (let attempt = 0; ; attempt++) {
        try {
          return await sql.begin((tx) => moveKnowledgeBase(tx, id))
        } catch (error) {
          if (getPostgresErrorCode(error) !== '23505' || attempt >= MAX_NAME_ATTEMPTS - 1)
            throw error
        }
      }
    },
  }
}

export const backfillLegacyKnowledgeBaseWorkspacesMigration: ScriptMigration = {
  name: '0013_backfill_legacy_knowledge_base_workspaces',
  async up(sql) {
    const result = await backfillLegacyKnowledgeBaseWorkspaces(
      createPostgresLegacyKnowledgeBaseWorkspaceStore(sql)
    )
    logger.info('Legacy KB workspace backfill completed', result)
    if (result.no_workspace || result.file_conflict) {
      logger.warn(
        'Some legacy KBs remain unassigned because their destination could not be established safely',
        result
      )
    }
  },
}
