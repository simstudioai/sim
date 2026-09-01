import { createLogger } from '@sim/logger'
import postgres from 'postgres'
import {
  backfillWorkspaceFileSizeBytes,
  createPostgresWorkspaceFileSizeBytesBackfillStore,
} from '../script-migrations/0008_backfill_workspace_file_size_bytes'

const logger = createLogger('DevWorkspaceFileSizeCutover')
const MIGRATION_NAME = '0008_backfill_workspace_file_size_bytes'
const MIGRATION_SQL_URL = new URL(
  '../migrations/0308_workspace_file_size_cutover.sql',
  import.meta.url
)
const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL

if (!url) {
  throw new Error('Missing MIGRATION_DATABASE_URL or DATABASE_URL')
}

const sql = postgres(url, {
  max: 1,
  connect_timeout: 10,
  max_lifetime: null,
  connection: { application_name: 'sim-dev-workspace-file-size-cutover' },
})

try {
  const migrationSql = await Bun.file(MIGRATION_SQL_URL).text()
  await sql.unsafe(migrationSql)
  const backfilled = await backfillWorkspaceFileSizeBytes(
    createPostgresWorkspaceFileSizeBytesBackfillStore(sql)
  )
  await sql`
    CREATE TABLE IF NOT EXISTS script_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `
  await sql`
    INSERT INTO script_migrations (name) VALUES (${MIGRATION_NAME})
    ON CONFLICT (name) DO NOTHING
  `
  logger.info('Dev workspace file size cutover completed', { backfilled })
} finally {
  await sql.end()
}
