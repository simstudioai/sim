import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(
  new URL('../.github/workflows/migrations.yml', import.meta.url),
  'utf8'
)
const step = workflow.match(/^ {8}run: \|\r?\n((?: {10}.*(?:\r?\n|$)|\r?\n)+)/m)?.[1]
if (!step) throw new Error('Migration workflow must contain its schema application shell step')
const script = step.replace(/^ {10}/gm, '')

/** Execute the checked-in shell with fake database commands and an isolated scratch log. */
function runMigration(env: Record<string, string> = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'migration-workflow-'))
  try {
    return spawnSync(
      'bash',
      [
        '-e',
        '-c',
        `bun() {
          printf 'COMMAND: %s\n' "$*"
          case "$2" in
            db:push) printf '%s\n' "$PUSH_OUTPUT"; return "$PUSH_EXIT" ;;
            ./scripts/prepare-dev-schema.ts) return "$PREPARE_EXIT" ;;
            ./scripts/migrate.ts) return "$MIGRATE_EXIT" ;;
            *) return 99 ;;
          esac
        }
        ${script.replaceAll('/tmp/db-push.log', '"$MIGRATION_TEST_LOG"')}`,
      ],
      {
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH,
          DATABASE_URL: 'postgresql://example.invalid/unused',
          MIGRATION_DATABASE_URL: '',
          ENVIRONMENT: 'dev',
          MIGRATION_TEST_LOG: join(directory, 'push.log'),
          PUSH_EXIT: '0',
          PUSH_OUTPUT: 'Changes applied',
          PREPARE_EXIT: '0',
          MIGRATE_EXIT: '0',
          ...env,
        },
      }
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

describe('migration workflow exit propagation', () => {
  it('fails when post-schema initialization fails before tee succeeds', () => {
    const result = runMigration({
      PUSH_EXIT: '42',
      PUSH_OUTPUT: 'Changes applied\nDATABASE_URL is required to initialize search vectors',
    })
    expect(result.status).toBe(42)
    expect(result.stdout).toContain('DATABASE_URL is required')
  })

  it('prepares the dev schema before pushing it', () => {
    const result = runMigration()
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('COMMAND: run db:push --force')
    expect(result.stdout.indexOf('COMMAND: run ./scripts/prepare-dev-schema.ts')).toBeLessThan(
      result.stdout.indexOf('COMMAND: run db:push --force')
    )
    expect(result.stdout).toContain('COMMAND: run ./scripts/prepare-dev-schema.ts')
  })

  it('still rejects drizzle interactive failures that exit zero', () => {
    const result = runMigration({ PUSH_OUTPUT: 'Interactive prompts require a TTY terminal' })
    expect(result.status).toBe(1)
  })

  it('stops before push when preparation fails', () => {
    const result = runMigration({ PREPARE_EXIT: '43' })
    expect(result.status).toBe(43)
    expect(result.stdout).not.toContain('COMMAND: run db:push')
  })

  it.each(['staging', 'production'])(
    'keeps versioned migration failures fatal in %s',
    (environment) => {
      const result = runMigration({ ENVIRONMENT: environment, MIGRATE_EXIT: '44' })
      expect(result.status).toBe(44)
      expect(result.stdout).toContain('COMMAND: run ./scripts/migrate.ts')
      expect(result.stdout).not.toContain('COMMAND: run db:push')
      expect(result.stdout).not.toContain('COMMAND: run ./scripts/prepare-dev-schema.ts')
    }
  )

  it('fails before invoking commands when no database URL is configured', () => {
    const result = runMigration({ DATABASE_URL: '' })
    expect(result.status).toBe(1)
    expect(result.stdout).not.toContain('COMMAND:')
  })
})
