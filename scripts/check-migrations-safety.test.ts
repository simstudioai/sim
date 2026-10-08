import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const ROOT = path.resolve(import.meta.dirname, '..')
const SCRIPT = path.join(ROOT, 'scripts/check-migrations-safety.ts')

async function runAudit(
  ...args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('bun', ['run', SCRIPT, ...args], { cwd: ROOT })
    return { code: 0, stdout, stderr }
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string }
    return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' }
  }
}

const tempDirs: string[] = []

/** A scratch migrations directory holding one file. */
function migrationsDir(sql: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'migration-owner-'))
  tempDirs.push(dir)
  writeFileSync(path.join(dir, '0001_seq.sql'), sql)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('migration safety audit', () => {
  /**
   * The regression this guards: an unresolvable base ref made `git diff` fail, the
   * failure was read as an empty file list, and the audit printed
   * `✓ No new migrations to check` and exited 0 — green on a branch it never read.
   * CI reached that state whenever its `git fetch ... || true` swallowed a failure.
   */
  it('fails loudly when the base ref cannot be diffed', async () => {
    const { code, stderr } = await runAudit('origin/branch-that-does-not-exist')

    expect(code).toBe(1)
    expect(stderr).toContain('could not run')
    expect(stderr).not.toContain('No new migrations to check')
  }, 30_000)

  /**
   * Production keeps tables owned by an older role than the one that runs migrations, so linking a
   * new sequence to an existing table passed CI and staging and failed only the production
   * migration. Linking it to a table the same migration creates stays safe.
   */
  it('refuses ownership-dependent statements on existing tables', async () => {
    const dir = migrationsDir(
      [
        'CREATE SEQUENCE IF NOT EXISTS "public"."calls_seq";--> statement-breakpoint',
        'ALTER SEQUENCE "public"."calls_seq" OWNED BY "calls"."position";--> statement-breakpoint',
        'ALTER TABLE "calls" OWNER TO "postgres";',
      ].join('\n')
    )
    const { code, stdout, stderr } = await runAudit('--dir', dir)

    expect(code).toBe(1)
    expect(`${stdout}${stderr}`).toContain('sequence-owned-by-existing-table')
    expect(`${stdout}${stderr}`).toContain('owner-to')
  }, 30_000)

  it('allows a sequence owned by a table created in the same migration', async () => {
    const dir = migrationsDir(
      [
        'CREATE TABLE "jobs" ("id" text PRIMARY KEY, "position" bigint);--> statement-breakpoint',
        'CREATE SEQUENCE IF NOT EXISTS "public"."jobs_seq";--> statement-breakpoint',
        'ALTER SEQUENCE "public"."jobs_seq" OWNED BY "public"."jobs"."position";',
      ].join('\n')
    )
    const { code, stdout, stderr } = await runAudit('--dir', dir)

    expect(`${stdout}${stderr}`).not.toContain('sequence-owned-by-existing-table')
    expect(code).toBe(0)
  }, 30_000)

  it('passes against a real base ref with no new migrations', async () => {
    const { code, stdout } = await runAudit('HEAD')

    expect(code).toBe(0)
    expect(stdout).toContain('No new migrations to check')
  }, 30_000)
})
