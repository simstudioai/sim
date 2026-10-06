import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createLogger } from '@sim/logger'
import postgres from 'postgres'

/**
 * Schema push never runs versioned SQL, so a pushed database would lack the trigger that returns an
 * issue to the inbox when its working chat goes away, and deleting that chat would then fail the
 * issue's working-chat check. This replays the trigger statements from the issue migration itself,
 * so the migration stays their only definition. Every statement is idempotent.
 */
const logger = createLogger('IssueTriggers')
const url = process.env.DATABASE_URL
if (!url) throw new Error('Missing DATABASE_URL')

const migrationsDir = join(import.meta.dir, '../migrations')
const [migration, ...extra] = readdirSync(migrationsDir).filter((name) =>
  /^\d+_issue\.sql$/.test(name)
)
if (!migration || extra.length > 0) throw new Error('Expected exactly one *_issue.sql migration')

const statements = readFileSync(join(migrationsDir, migration), 'utf-8')
  .split('--> statement-breakpoint')
  .map((statement) => statement.trim())
  .filter((statement) => statement.includes('issue_working_chat_detached'))
if (statements.length === 0) throw new Error(`${migration} defines no issue triggers`)

const sql = postgres(url, {
  max: 1,
  connect_timeout: 10,
  connection: { application_name: 'sim-issue-triggers' },
})

try {
  await sql.begin(async (tx) => {
    for (const statement of statements) await tx.unsafe(statement)
  })
  logger.info('Issue triggers applied', { migration, statements: statements.length })
} finally {
  await sql.end()
}
