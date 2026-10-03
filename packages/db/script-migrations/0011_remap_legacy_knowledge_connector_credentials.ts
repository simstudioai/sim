import { createLogger } from '@sim/logger'
import type { Sql } from 'postgres'
import type { ScriptMigration } from './types'

const logger = createLogger('LegacyKnowledgeConnectorCredentialRemap')

export const LEGACY_CONNECTOR_CREDENTIAL_BATCH_SIZE = 500

/** Message written to connectors whose legacy credential could not be remapped. */
export const LEGACY_CONNECTOR_CREDENTIAL_DISCONNECTED_ERROR =
  'Credential must be reconnected before this connector can sync'

export interface LegacyKnowledgeConnectorCredentialStore {
  /**
   * Connectors whose `credential_id` matches no `credential` row, in keyset
   * order. `afterId` is an opaque cursor over `knowledge_connector.id`.
   */
  listUnmappedConnectorIds(afterId: string, limit: number): Promise<string[]>
  /**
   * Points each connector at the live workspace credential wrapping the
   * `account` row its legacy id names, when exactly such a credential exists.
   * Returns the number of connectors remapped.
   */
  remapToWorkspaceCredential(ids: readonly string[]): Promise<number>
  /**
   * Clears the legacy id on connectors that still match no credential row and
   * parks them in `error` so the UI asks for a reconnect. Returns the count.
   */
  disconnectUnmapped(ids: readonly string[]): Promise<number>
}

export interface LegacyKnowledgeConnectorCredentialResult {
  remapped: number
  disconnected: number
}

interface RemapOptions {
  batchSize?: number
}

/**
 * Makes every `knowledge_connector.credential_id` a real `credential.id` so the
 * foreign key a later migration adds can be validated immediately.
 * Rows written before the `credential` table existed hold a raw `account.id`;
 * each is remapped to the workspace credential that wraps that account, and
 * anything that still resolves to nothing is disconnected rather than left to
 * fail the validation. Pages commit independently and re-running is a no-op.
 */
export async function remapLegacyKnowledgeConnectorCredentials(
  store: LegacyKnowledgeConnectorCredentialStore,
  options: RemapOptions = {}
): Promise<LegacyKnowledgeConnectorCredentialResult> {
  const batchSize = options.batchSize ?? LEGACY_CONNECTOR_CREDENTIAL_BATCH_SIZE
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error('Legacy connector credential remap batch size must be a positive integer')
  }

  let afterId = ''
  const result: LegacyKnowledgeConnectorCredentialResult = { remapped: 0, disconnected: 0 }
  for (;;) {
    const ids = await store.listUnmappedConnectorIds(afterId, batchSize)
    if (ids.length === 0) return result
    if (ids.length > batchSize) {
      throw new Error('Legacy connector credential remap store returned an oversized page')
    }
    const lastId = ids.at(-1)
    if (!lastId || lastId <= afterId) {
      throw new Error('Legacy connector credential remap store returned a non-advancing page')
    }
    result.remapped += await store.remapToWorkspaceCredential(ids)
    result.disconnected += await store.disconnectUnmapped(ids)
    afterId = lastId
  }
}

/** Creates the PostgreSQL store used by the deploy-time remap. */
export function createPostgresLegacyKnowledgeConnectorCredentialStore(
  sql: Sql
): LegacyKnowledgeConnectorCredentialStore {
  return {
    async listUnmappedConnectorIds(afterId, limit) {
      const rows = await sql<Array<{ id: string }>>`
        SELECT kc.id
        FROM knowledge_connector kc
        WHERE kc.id > ${afterId}
          AND kc.credential_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM credential c WHERE c.id = kc.credential_id)
        ORDER BY kc.id
        LIMIT ${limit}
      `
      return rows.map((row) => row.id)
    },
    async remapToWorkspaceCredential(ids) {
      const rows = await sql<Array<{ id: string }>>`
        UPDATE knowledge_connector kc
        SET credential_id = mapped.credential_id,
            updated_at = now()
        FROM (
          SELECT kc2.id AS connector_id,
                 (
                   SELECT c.id
                   FROM credential c
                   WHERE c.account_id = kc2.credential_id
                     AND c.workspace_id = kb.workspace_id
                     AND c.type = 'oauth'
                     AND c.revoked_at IS NULL
                   ORDER BY c.created_at ASC
                   LIMIT 1
                 ) AS credential_id
          FROM knowledge_connector kc2
          JOIN knowledge_base kb ON kb.id = kc2.knowledge_base_id
          WHERE kc2.id = ANY(${sql.array([...ids])})
            AND kc2.credential_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM credential c WHERE c.id = kc2.credential_id)
        ) mapped
        WHERE kc.id = mapped.connector_id
          AND mapped.credential_id IS NOT NULL
        RETURNING kc.id
      `
      return rows.length
    },
    async disconnectUnmapped(ids) {
      const rows = await sql<Array<{ id: string }>>`
        UPDATE knowledge_connector kc
        SET credential_id = NULL,
            status = 'error',
            last_sync_error = ${LEGACY_CONNECTOR_CREDENTIAL_DISCONNECTED_ERROR},
            next_sync_at = NULL,
            updated_at = now()
        WHERE kc.id = ANY(${sql.array([...ids])})
          AND kc.credential_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM credential c WHERE c.id = kc.credential_id)
        RETURNING kc.id
      `
      return rows.length
    },
  }
}

export const remapLegacyKnowledgeConnectorCredentialsMigration: ScriptMigration = {
  name: '0011_remap_legacy_knowledge_connector_credentials',
  async up(sql) {
    const result = await remapLegacyKnowledgeConnectorCredentials(
      createPostgresLegacyKnowledgeConnectorCredentialStore(sql)
    )
    logger.info('Legacy knowledge connector credential remap completed', result)
  },
}
