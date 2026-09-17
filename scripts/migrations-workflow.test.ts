import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(
  new URL('../.github/workflows/migrations.yml', import.meta.url),
  'utf8'
)
const step = workflow.match(/^ {8}run: \|\r?\n((?: {10}.*(?:\r?\n|$)|\r?\n)+)/m)?.[1]
if (!step) throw new Error('Migration workflow must contain its schema application shell step')
const script = step.replace(/^ {10}/gm, '')

/** Execute the checked-in shell with fake database commands. */
function runMigration(env: Record<string, string> = {}) {
  return spawnSync(
    'bash',
    [
      '-e',
      '-c',
      `bun() {
          printf 'COMMAND: %s\n' "$*"
          case "$2" in
            db:push) printf '%s\n' "$PUSH_OUTPUT"; return "$PUSH_EXIT" ;;
            ./scripts/migrate.ts) return "$MIGRATE_EXIT" ;;
            *) return 99 ;;
          esac
        }
        ${script}`,
    ],
    {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        DATABASE_URL: 'postgresql://example.invalid/unused',
        MIGRATION_DATABASE_URL: '',
        ENVIRONMENT: 'dev',
        PUSH_EXIT: '0',
        PUSH_OUTPUT: 'Changes applied',
        MIGRATE_EXIT: '0',
        ...env,
      },
    }
  )
}

describe('migration workflow exit propagation', () => {
  it('fails when post-schema initialization fails', () => {
    const result = runMigration({
      PUSH_EXIT: '42',
      PUSH_OUTPUT: 'Changes applied\nDATABASE_URL is required to initialize search vectors',
    })
    expect(result.status).toBe(42)
    expect(result.stdout).toContain('DATABASE_URL is required')
  })

  it('runs the general push command on dev', () => {
    const result = runMigration()
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('COMMAND: run db:push --force')
    expect(result.stdout).not.toContain('COMMAND: run ./scripts/migrate.ts')
  })

  it('propagates a noninteractive Drizzle failure', () => {
    const result = runMigration({
      PUSH_EXIT: '1',
      PUSH_OUTPUT: 'Interactive prompts require a TTY terminal',
    })
    expect(result.status).toBe(1)
  })

  it.each(['staging', 'production'])(
    'keeps versioned migration failures fatal in %s',
    (environment) => {
      const result = runMigration({ ENVIRONMENT: environment, MIGRATE_EXIT: '44' })
      expect(result.status).toBe(44)
      expect(result.stdout).toContain('COMMAND: run ./scripts/migrate.ts')
      expect(result.stdout).not.toContain('COMMAND: run db:push')
    }
  )

  it('fails before invoking commands when no database URL is configured', () => {
    const result = runMigration({ DATABASE_URL: '' })
    expect(result.status).toBe(1)
    expect(result.stdout).not.toContain('COMMAND:')
  })
})
