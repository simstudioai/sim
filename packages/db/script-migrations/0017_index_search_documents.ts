import { buildSearchIndexes } from '@sim/db/script-migrations/0016_backfill_search_vectors'
import type { ScriptMigration } from '@sim/db/script-migrations/types'

export const indexSearchDocumentsMigration: ScriptMigration = {
  name: '0017_index_search_documents',
  up: buildSearchIndexes,
}
