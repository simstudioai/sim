import { createLogger } from '@sim/logger'
import postgres from 'postgres'
import {
  createPostgresStorageReconciliationStore,
  reconcileWorkspaceStorageAccounting,
} from '../script-migrations/0003_backfill_workspace_storage_usage'

const logger = createLogger('WorkspaceStorageReconciliation')
const REQUIRED_ACK = 'old-apps-drained'
const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL

if (!url) {
  throw new Error('Missing MIGRATION_DATABASE_URL or DATABASE_URL')
}
if (process.env.WORKSPACE_STORAGE_RECONCILE_ACK !== REQUIRED_ACK) {
  throw new Error(
    `Set WORKSPACE_STORAGE_RECONCILE_ACK=${REQUIRED_ACK} only after old app instances are drained`
  )
}

const sql = postgres(url, {
  max: 1,
  connect_timeout: 10,
  max_lifetime: null,
  connection: { application_name: 'sim-workspace-storage-reconcile' },
})

try {
  const result = await reconcileWorkspaceStorageAccounting(
    createPostgresStorageReconciliationStore(sql)
  )
  await sql`
    ALTER TABLE workspace
    VALIDATE CONSTRAINT workspace_storage_used_bytes_non_negative
  `
  logger.info('Workspace storage reconciliation completed', result)
} finally {
  await sql.end()
}
