import {
  type RetirementPacing,
  retireSearchEmbeddings,
  retireSearchEmbeddingsMigration,
} from '@sim/db/script-migrations/0027_retire_search_embeddings'
import { maintainSearchRetirementMigration } from '@sim/db/script-migrations/0028_maintain_search_retirement'
import type { ScriptMigration } from '@sim/db/script-migrations/types'

/**
 * The complete operator-run cleanup: every Search KB's retirement, then index maintenance. It is not
 * in the deploy registry; the 0027 entry runs it with `--maintenance` and journals it on success. It
 * supersedes single-KB retirement receipts so every database receives the expanded cleanup.
 */
export function retireAllSearchEmbeddings(pacing?: RetirementPacing): ScriptMigration {
  return {
    name: '0029_retire_all_search_embeddings',
    supersedes: [retireSearchEmbeddingsMigration.name, maintainSearchRetirementMigration.name],
    async up(sql) {
      await retireSearchEmbeddings(sql, pacing)
      await maintainSearchRetirementMigration.up(sql)
    },
  }
}
