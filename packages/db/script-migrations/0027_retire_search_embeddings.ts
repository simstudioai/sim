import { createLogger } from '@sim/logger'

if (import.meta.main) {
  createLogger('RetireSearchEmbeddings').error(
    'Use packages/db/scripts/retire-indexed-search.ts. The legacy delete/reindex command is disabled.'
  )
  process.exitCode = 1
}
