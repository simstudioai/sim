import { createLogger } from '@sim/logger'
import postgres from 'postgres'
import {
  assertForkKnowledgeBaseOwnershipFullyReconciled,
  assertForkKnowledgeBaseOwnershipPostDrainAck,
  createPostgresForkKnowledgeBaseOwnershipRepairStore,
  reconcileForkKnowledgeBaseFileOwnership,
} from '../script-migrations/0004_backfill_fork_kb_file_ownership'

const logger = createLogger('ForkKnowledgeBaseOwnershipReconciliation')
const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL

if (!url) {
  throw new Error('Missing MIGRATION_DATABASE_URL or DATABASE_URL')
}
assertForkKnowledgeBaseOwnershipPostDrainAck(process.env.KB_FORK_OWNERSHIP_RECONCILE_ACK)

const sql = postgres(url, {
  max: 1,
  connect_timeout: 10,
  max_lifetime: null,
  connection: { application_name: 'sim-fork-kb-ownership-reconcile' },
})

try {
  const result = await reconcileForkKnowledgeBaseFileOwnership(
    createPostgresForkKnowledgeBaseOwnershipRepairStore(sql)
  )
  logger.info('Fork knowledge-base ownership reconciliation completed', result)
  assertForkKnowledgeBaseOwnershipFullyReconciled(result)
} finally {
  await sql.end()
}
