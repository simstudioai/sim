import { replaceProjectionSourceAclSync } from '@sim/db/script-migrations/0021_embedding_search_connector'
import type { ScriptMigration } from '@sim/db/script-migrations/types'

/**
 * Replaces the document trigger's body so a document's ACL change no longer writes the ACL onto
 * chunks the source and ACL fill has not reached yet; see {@link replaceProjectionSourceAclSync}.
 * The function is replaced in place, so the trigger that calls it and every other object from
 * `0022_projection_source_acl_backfill` stay as they are. A database that runs `0022` now installs
 * the same body, so this is a no-op there.
 */
export const projectionAclSkipUnfilledMigration: ScriptMigration = {
  name: '0023_projection_acl_skip_unfilled',
  async up(sql) {
    await replaceProjectionSourceAclSync(sql)
  },
}
