import {
  indexProjectionAcl,
  installProjectionSourceAcl,
} from '@sim/db/script-migrations/0021_embedding_search_connector'
import type { ScriptMigration } from '@sim/db/script-migrations/types'

/**
 * Installs the projection source and ACL triggers and builds their indexes; both are idempotent,
 * so a run that was cut short completes on the next deploy. The columns are not filled here: on
 * `embedding_search` every filled row is re-inserted into each HNSW index, which puts the full
 * projection far beyond what a deploy job can wait for. A row the triggers have not written since
 * stays unfilled and is decided on its document, the join per candidate every row paid before the
 * columns existed.
 *
 * Supersedes `0021_embedding_search_connector`, whose synchronous backfill this replaces: a
 * database that recorded it still gains the unfilled indexes, and one where it was cut short
 * records both names once this completes.
 */
export const projectionSourceAclBackfillMigration: ScriptMigration = {
  name: '0022_projection_source_acl_backfill',
  supersedes: ['0021_embedding_search_connector'],
  async up(sql) {
    await installProjectionSourceAcl(sql)
    await indexProjectionAcl(sql)
  },
}
