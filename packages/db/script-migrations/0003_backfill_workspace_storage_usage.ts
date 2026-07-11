import type { Sql } from 'postgres'
import type { ScriptMigration } from './types'

export const WORKSPACE_STORAGE_RECONCILIATION_BATCH_SIZE = 250

interface StorageReconciliationStore {
  prepare(): Promise<void>
  assertNoUnattributedWorkspaceFiles(): Promise<void>
  listWorkspaceIds(afterId: string, limit: number): Promise<string[]>
  reconcileWorkspaces(workspaceIds: string[]): Promise<void>
  listLegacyDocumentIds(afterId: string, limit: number): Promise<string[]>
  accumulateLegacyDocuments(documentIds: string[]): Promise<void>
  listOrganizationIds(afterId: string, limit: number): Promise<string[]>
  reconcileOrganizations(organizationIds: string[]): Promise<void>
  listUserIds(afterId: string, limit: number): Promise<string[]>
  reconcileUsers(userIds: string[]): Promise<void>
  finish(): Promise<void>
}

export interface WorkspaceStorageReconciliationResult {
  workspaces: number
  legacyDocuments: number
  organizations: number
  users: number
}

interface WorkspaceStorageReconciliationOptions {
  batchSize?: number
  reconcilePayers?: boolean
}

async function processKeysetPages(
  listIds: (afterId: string, limit: number) => Promise<string[]>,
  processIds: (ids: string[]) => Promise<void>,
  batchSize: number
): Promise<number> {
  let afterId = ''
  let processed = 0

  for (;;) {
    const ids = await listIds(afterId, batchSize)
    if (ids.length === 0) return processed
    await processIds(ids)
    processed += ids.length
    afterId = ids.at(-1) as string
  }
}

/**
 * Rebuilds workspace byte ledgers and payer aggregates from the authoritative
 * relational metadata without loading an unbounded result set.
 *
 * Logical stored bytes are represented by:
 * - active `workspace_files` rows in the durable `workspace` context. Chat and
 *   mothership attachments are transient conversation inputs and are unbilled.
 * - non-connector `document.file_size` rows attached to a workspace; connector
 *   documents were never charged by the application and knowledge-base
 *   ownership rows in `workspace_files` are bindings, not an additional copy.
 *
 * The operation is idempotent: workspace and payer values are assigned from
 * source metadata, while a session-local temporary table accumulates bounded
 * pages. Run it once during expand and again with storage mutations quiesced
 * after old application instances are drained. Full payer reconciliation fails
 * explicitly when legacy workspace-less metadata exists because its historical
 * user-vs-organization payer cannot be derived exactly from current rows.
 */
export async function reconcileWorkspaceStorageAccounting(
  store: StorageReconciliationStore,
  options: WorkspaceStorageReconciliationOptions = {}
): Promise<WorkspaceStorageReconciliationResult> {
  const { batchSize = WORKSPACE_STORAGE_RECONCILIATION_BATCH_SIZE, reconcilePayers = true } =
    options
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error('Workspace storage reconciliation batch size must be a positive integer')
  }

  await store.prepare()
  try {
    const workspaces = await processKeysetPages(
      (afterId, limit) => store.listWorkspaceIds(afterId, limit),
      (ids) => store.reconcileWorkspaces(ids),
      batchSize
    )
    if (!reconcilePayers) {
      return { workspaces, legacyDocuments: 0, organizations: 0, users: 0 }
    }
    await store.assertNoUnattributedWorkspaceFiles()
    const legacyDocuments = await processKeysetPages(
      (afterId, limit) => store.listLegacyDocumentIds(afterId, limit),
      (ids) => store.accumulateLegacyDocuments(ids),
      batchSize
    )
    const organizations = await processKeysetPages(
      (afterId, limit) => store.listOrganizationIds(afterId, limit),
      (ids) => store.reconcileOrganizations(ids),
      batchSize
    )
    const users = await processKeysetPages(
      (afterId, limit) => store.listUserIds(afterId, limit),
      (ids) => store.reconcileUsers(ids),
      batchSize
    )
    return { workspaces, legacyDocuments, organizations, users }
  } finally {
    await store.finish()
  }
}

export function createPostgresStorageReconciliationStore(sql: Sql): StorageReconciliationStore {
  return {
    async prepare() {
      await sql`
        CREATE TEMPORARY TABLE IF NOT EXISTS workspace_storage_reconciliation_payer (
          payer_type text NOT NULL,
          payer_id text NOT NULL,
          storage_used_bytes bigint NOT NULL,
          PRIMARY KEY (payer_type, payer_id),
          CHECK (storage_used_bytes >= 0)
        ) ON COMMIT PRESERVE ROWS
      `
      await sql`TRUNCATE workspace_storage_reconciliation_payer`
    },

    async assertNoUnattributedWorkspaceFiles() {
      const rows = await sql<Array<{ id: string }>>`
        SELECT id
        FROM workspace_files
        WHERE workspace_id IS NULL
          AND context = 'workspace'
          AND deleted_at IS NULL
        ORDER BY id
        LIMIT 1
      `
      if (rows.length > 0) {
        throw new Error(
          `Cannot reconcile payer storage exactly: workspace file ${rows[0].id} has no workspace attribution`
        )
      }
    },

    async listWorkspaceIds(afterId, limit) {
      const rows = await sql<Array<{ id: string }>>`
        SELECT id
        FROM workspace
        WHERE id > ${afterId}
        ORDER BY id
        LIMIT ${limit}
      `
      return rows.map((row) => row.id)
    },

    async reconcileWorkspaces(workspaceIds) {
      if (workspaceIds.length === 0) return
      await sql.begin(async (tx) => {
        await tx`
          SELECT id
          FROM workspace
          WHERE id = ANY(${workspaceIds}::text[])
          ORDER BY id
          FOR UPDATE
        `

        const [invalid] = await tx<Array<{ invalid_count: number | string }>>`
          SELECT count(*) AS invalid_count
          FROM (
            SELECT size::bigint AS bytes
            FROM workspace_files
            WHERE workspace_id = ANY(${workspaceIds}::text[])
              AND context = 'workspace'
              AND deleted_at IS NULL
            UNION ALL
            SELECT d.file_size::bigint AS bytes
            FROM document d
            JOIN knowledge_base kb ON kb.id = d.knowledge_base_id
            WHERE kb.workspace_id = ANY(${workspaceIds}::text[])
              AND d.connector_id IS NULL
              AND d.deleted_at IS NULL
          ) source
          WHERE bytes < 0
        `
        if (Number(invalid?.invalid_count ?? 0) > 0) {
          throw new Error('Cannot reconcile workspace storage: negative source metadata size')
        }

        await tx`
          WITH file_totals AS (
            SELECT workspace_id, sum(size)::bigint AS bytes
            FROM workspace_files
            WHERE workspace_id = ANY(${workspaceIds}::text[])
              AND context = 'workspace'
              AND deleted_at IS NULL
            GROUP BY workspace_id
          ),
          document_totals AS (
            SELECT kb.workspace_id, sum(d.file_size)::bigint AS bytes
            FROM document d
            JOIN knowledge_base kb ON kb.id = d.knowledge_base_id
            WHERE kb.workspace_id = ANY(${workspaceIds}::text[])
              AND d.connector_id IS NULL
              AND d.deleted_at IS NULL
            GROUP BY kb.workspace_id
          )
          UPDATE workspace w
          SET storage_used_bytes =
            coalesce(file_totals.bytes, 0) + coalesce(document_totals.bytes, 0)
          FROM (
            SELECT unnest(${workspaceIds}::text[]) AS workspace_id
          ) batch
          LEFT JOIN file_totals ON file_totals.workspace_id = batch.workspace_id
          LEFT JOIN document_totals ON document_totals.workspace_id = batch.workspace_id
          WHERE w.id = batch.workspace_id
        `

        await tx`
          INSERT INTO workspace_storage_reconciliation_payer (
            payer_type,
            payer_id,
            storage_used_bytes
          )
          SELECT
            CASE WHEN organization_id IS NULL THEN 'user' ELSE 'organization' END,
            coalesce(organization_id, billed_account_user_id),
            sum(storage_used_bytes)::bigint
          FROM workspace
          WHERE id = ANY(${workspaceIds}::text[])
          GROUP BY
            CASE WHEN organization_id IS NULL THEN 'user' ELSE 'organization' END,
            coalesce(organization_id, billed_account_user_id)
          ON CONFLICT (payer_type, payer_id)
          DO UPDATE SET storage_used_bytes =
            workspace_storage_reconciliation_payer.storage_used_bytes
            + EXCLUDED.storage_used_bytes
        `
      })
    },

    async listLegacyDocumentIds(afterId, limit) {
      const rows = await sql<Array<{ id: string }>>`
        SELECT d.id
        FROM document d
        JOIN knowledge_base kb ON kb.id = d.knowledge_base_id
        WHERE d.id > ${afterId}
          AND d.connector_id IS NULL
          AND d.deleted_at IS NULL
          AND kb.workspace_id IS NULL
        ORDER BY d.id
        LIMIT ${limit}
      `
      return rows.map((row) => row.id)
    },

    async accumulateLegacyDocuments(documentIds) {
      if (documentIds.length === 0) return
      throw new Error(
        `Cannot reconcile payer storage exactly: legacy document ${documentIds[0]} has no workspace payer history`
      )
    },

    async listOrganizationIds(afterId, limit) {
      const rows = await sql<Array<{ id: string }>>`
        SELECT id
        FROM organization
        WHERE id > ${afterId}
        ORDER BY id
        LIMIT ${limit}
      `
      return rows.map((row) => row.id)
    },

    async reconcileOrganizations(organizationIds) {
      if (organizationIds.length === 0) return
      await sql.begin(async (tx) => {
        await tx`
          SELECT pg_advisory_xact_lock(
            hashtextextended('workspace-storage-payer:organization:' || payer_id, 0)
          )
          FROM unnest(${organizationIds}::text[]) AS payer_id
          ORDER BY payer_id
        `
        await tx`
          UPDATE organization o
          SET storage_used_bytes = coalesce(p.storage_used_bytes, 0)
          FROM (
            SELECT batch.id, totals.storage_used_bytes
            FROM unnest(${organizationIds}::text[]) AS batch(id)
            LEFT JOIN workspace_storage_reconciliation_payer totals
              ON totals.payer_type = 'organization'
              AND totals.payer_id = batch.id
          ) p
          WHERE o.id = p.id
        `
      })
    },

    async listUserIds(afterId, limit) {
      const rows = await sql<Array<{ id: string }>>`
        SELECT user_id AS id
        FROM user_stats
        WHERE user_id > ${afterId}
        ORDER BY user_id
        LIMIT ${limit}
      `
      return rows.map((row) => row.id)
    },

    async reconcileUsers(userIds) {
      if (userIds.length === 0) return
      await sql.begin(async (tx) => {
        await tx`
          SELECT pg_advisory_xact_lock(
            hashtextextended('workspace-storage-payer:user:' || payer_id, 0)
          )
          FROM unnest(${userIds}::text[]) AS payer_id
          ORDER BY payer_id
        `
        await tx`
          UPDATE user_stats us
          SET storage_used_bytes = coalesce(p.storage_used_bytes, 0)
          FROM (
            SELECT batch.id, totals.storage_used_bytes
            FROM unnest(${userIds}::text[]) AS batch(id)
            LEFT JOIN workspace_storage_reconciliation_payer totals
              ON totals.payer_type = 'user'
              AND totals.payer_id = batch.id
          ) p
          WHERE us.user_id = p.id
        `
      })
    },

    async finish() {
      await sql`DROP TABLE IF EXISTS workspace_storage_reconciliation_payer`
    },
  }
}

export const backfillWorkspaceStorageUsage: ScriptMigration = {
  name: '0003_backfill_workspace_storage_usage',
  async up(sql) {
    /**
     * Expand phase: populate only the additive workspace ledger. Payer
     * aggregates stay untouched while old application instances can still
     * update only those aggregates. Run the exported full reconciliation after
     * old instances are drained to assign exact payer totals.
     */
    await reconcileWorkspaceStorageAccounting(createPostgresStorageReconciliationStore(sql), {
      reconcilePayers: false,
    })
  },
}
