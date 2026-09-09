import {
  backfillLegacyKnowledgeBaseWorkspaces,
  createPostgresLegacyKnowledgeBaseWorkspaceStore,
} from '@sim/db/script-migrations/0013_backfill_legacy_knowledge_base_workspaces'
import type { ScriptMigration } from '@sim/db/script-migrations/types'
import { createLogger } from '@sim/logger'

const logger = createLogger('KnowledgeBaseOwnership')

/** Repairs retained archived rows using the existing atomic scope/name/storage migration. */
export const requireKnowledgeBaseOwnerMigration: ScriptMigration = {
  name: '0014_require_knowledge_base_owner',
  async up(sql) {
    const result = await backfillLegacyKnowledgeBaseWorkspaces(
      createPostgresLegacyKnowledgeBaseWorkspaceStore(sql, { includeArchived: true })
    )
    logger.info('Knowledge base ownership repair completed', result)
    if (result.no_workspace || result.file_conflict) {
      throw new Error(
        'Knowledge base ownership requires manual repair: unassigned KBs have no eligible workspace or conflicting file ownership. Repair them and rerun the migration.'
      )
    }
    const [invalid] = await sql<Array<{ found: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM knowledge_base
        WHERE num_nonnulls(workspace_id, organization_id) <> 1
          OR (organization_id IS NOT NULL AND NOT is_search_index)
      ) AS found
    `
    if (invalid?.found) {
      throw new Error(
        'Knowledge base ownership requires manual repair before enforcing the constraint'
      )
    }
    /** Repair first so old-app restores never update an unscoped row under the stricter check. */
    await sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL lock_timeout = '5s'")
      await tx.unsafe("SET LOCAL statement_timeout = '30s'")
      await tx`ALTER TABLE knowledge_base DROP CONSTRAINT IF EXISTS kb_owner_check`
      await tx`ALTER TABLE knowledge_base ADD CONSTRAINT kb_owner_check
        CHECK (num_nonnulls(workspace_id, organization_id) = 1) NOT VALID`
    })
    /** Validation scans separately from the short DDL transaction, allowing normal reads/writes. */
    await sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL lock_timeout = '5s'")
      await tx.unsafe("SET LOCAL statement_timeout = '5min'")
      await tx`ALTER TABLE knowledge_base VALIDATE CONSTRAINT kb_owner_check`
      await tx`ALTER TABLE knowledge_base VALIDATE CONSTRAINT kb_organization_search_index_check`
    })
  },
}
