import { retireSearchEmbeddingsMigration } from '@sim/db/script-migrations/0027_retire_search_embeddings'
import { maintainSearchRetirementMigration } from '@sim/db/script-migrations/0028_maintain_search_retirement'
import type { ScriptMigration } from '@sim/db/script-migrations/types'

/** Supersedes single-KB retirement receipts so every deployment receives the expanded cleanup. */
export const retireAllSearchEmbeddingsMigration: ScriptMigration = {
  name: '0029_retire_all_search_embeddings',
  supersedes: [retireSearchEmbeddingsMigration.name, maintainSearchRetirementMigration.name],
  async up(sql) {
    await retireSearchEmbeddingsMigration.up(sql)
    await maintainSearchRetirementMigration.up(sql)
  },
}
