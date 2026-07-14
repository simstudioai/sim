import type { Sql } from 'postgres'
import type { ScriptMigration } from './types'

export const WORKSPACE_STORAGE_RECONCILIATION_BATCH_SIZE = 250

interface StorageReconciliationStore {
  listWorkspaceIds(afterId: string, limit: number): Promise<string[]>
  reconcileWorkspaces(workspaceIds: string[]): Promise<void>
  listOrganizationIds(afterId: string, limit: number): Promise<string[]>
  reconcileOrganization(organizationId: string): Promise<void>
  listUserIds(afterId: string, limit: number): Promise<string[]>
  reconcileUser(userId: string): Promise<void>
}

export interface WorkspaceStorageReconciliationResult {
  workspaces: number
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

async function processPayers(
  listIds: (afterId: string, limit: number) => Promise<string[]>,
  reconcilePayer: (id: string) => Promise<void>,
  batchSize: number
): Promise<number> {
  return processKeysetPages(
    listIds,
    async (ids) => {
      for (const id of ids) {
        await reconcilePayer(id)
      }
    },
    batchSize
  )
}

/**
 * Rebuilds workspace byte ledgers from authoritative relational metadata in
 * bounded keyset pages. The explicit post-deploy mode also reconciles one payer
 * at a time from live workspace ledgers, so it stays online without retaining
 * a global snapshot that can stale while writes continue.
 *
 * Workspace bytes include every durable `workspace_files` row in the
 * `workspace` context, including archived rows, plus active non-connector
 * knowledge documents. Mothership files and connector documents are excluded.
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

  const workspaces = await processKeysetPages(
    (afterId, limit) => store.listWorkspaceIds(afterId, limit),
    (ids) => store.reconcileWorkspaces(ids),
    batchSize
  )
  if (!reconcilePayers) {
    return { workspaces, organizations: 0, users: 0 }
  }

  const organizations = await processPayers(
    (afterId, limit) => store.listOrganizationIds(afterId, limit),
    (id) => store.reconcileOrganization(id),
    batchSize
  )
  const users = await processPayers(
    (afterId, limit) => store.listUserIds(afterId, limit),
    (id) => store.reconcileUser(id),
    batchSize
  )
  return { workspaces, organizations, users }
}

export function createPostgresStorageReconciliationStore(sql: Sql): StorageReconciliationStore {
  return {
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
      })
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

    async reconcileOrganization(organizationId) {
      await sql.begin(async (tx) => {
        const locked = await tx<Array<{ id: string }>>`
          SELECT id
          FROM organization
          WHERE id = ${organizationId}
          FOR UPDATE
        `
        if (locked.length === 0) return

        const [total] = await tx<Array<{ storage_used_bytes: number | string }>>`
          SELECT coalesce(sum(storage_used_bytes), 0)::bigint AS storage_used_bytes
          FROM workspace
          WHERE organization_id = ${organizationId}
        `
        await tx`
          UPDATE organization
          SET storage_used_bytes = ${total?.storage_used_bytes ?? 0}
          WHERE id = ${organizationId}
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

    async reconcileUser(userId) {
      await sql.begin(async (tx) => {
        const locked = await tx<Array<{ id: string }>>`
          SELECT user_id AS id
          FROM user_stats
          WHERE user_id = ${userId}
          FOR UPDATE
        `
        if (locked.length === 0) return

        const [total] = await tx<Array<{ storage_used_bytes: number | string }>>`
          SELECT coalesce(sum(storage_used_bytes), 0)::bigint AS storage_used_bytes
          FROM workspace
          WHERE organization_id IS NULL
            AND billed_account_user_id = ${userId}
        `
        await tx`
          UPDATE user_stats
          SET storage_used_bytes = ${total?.storage_used_bytes ?? 0}
          WHERE user_id = ${userId}
        `
      })
    },
  }
}

export const backfillWorkspaceStorageUsage: ScriptMigration = {
  name: '0003_backfill_workspace_storage_usage',
  async up(sql) {
    /**
     * Expand phase: seed only the additive workspace shadow ledger. Payer
     * aggregates remain under the old application's ownership until all old
     * instances drain; the explicit reconciliation command assigns exact live
     * payer totals afterward.
     */
    await reconcileWorkspaceStorageAccounting(createPostgresStorageReconciliationStore(sql), {
      reconcilePayers: false,
    })
  },
}
