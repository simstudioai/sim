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

  it.each(['"jobs"', '"public"."jobs"'])(
    'allows a sequence owned by a table created in the same migration as %s',
    async (table) => {
      const dir = migrationsDir(
        [
          `CREATE TABLE ${table} ("id" text PRIMARY KEY, "position" bigint);--> statement-breakpoint`,
          'CREATE SEQUENCE IF NOT EXISTS "public"."jobs_seq";--> statement-breakpoint',
          'ALTER SEQUENCE "public"."jobs_seq" OWNED BY "jobs"."position";',
        ].join('\n')
      )
      const { code, stdout, stderr } = await runAudit('--dir', dir)

      expect(`${stdout}${stderr}`).not.toContain('sequence-owned-by-existing-table')
      expect(code).toBe(0)
    },
    30_000
  )

  it('matches a schema-qualified OWNED BY to an unqualified create in public', async () => {
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

  it.each([
    [
      'a conditional create, which may find the table already there',
      'CREATE TABLE IF NOT EXISTS "jobs" ("id" text PRIMARY KEY, "position" bigint);--> statement-breakpoint\nALTER SEQUENCE "jobs_seq" OWNED BY "jobs"."position";',
    ],
    [
      'a same-named table in another schema',
      'CREATE TABLE "archive"."jobs" ("id" text PRIMARY KEY, "position" bigint);--> statement-breakpoint\nALTER SEQUENCE "jobs_seq" OWNED BY "public"."jobs"."position";',
    ],
    [
      'an ownership change wrapped in a DO block',
      'DO $$ BEGIN\n  ALTER SEQUENCE "jobs_seq" OWNED BY "jobs"."position";\nEXCEPTION WHEN undefined_table THEN NULL;\nEND $$;',
    ],
  ])(
    'refuses OWNED BY through %s',
    async (_case, sql) => {
      const { code, stdout, stderr } = await runAudit('--dir', migrationsDir(sql))

      expect(code).toBe(1)
      expect(`${stdout}${stderr}`).toContain('sequence-owned-by-existing-table')
    },
    30_000
  )

  it('reads past an escaped quote in an escape string to an ownership change after it', async () => {
    const dir = migrationsDir(
      "DO $$ BEGIN RAISE NOTICE E'it\\'s ready'; ALTER TABLE calls OWNER TO postgres; RAISE NOTICE 'done'; END $$;"
    )
    const { code, stdout, stderr } = await runAudit('--dir', dir)

    expect(code).toBe(1)
    expect(`${stdout}${stderr}`).toContain('owner-to')
  }, 30_000)

  it('ignores ownership words inside an escape string', async () => {
    const dir = migrationsDir(
      "COMMENT ON TABLE \"jobs\" IS E'Ops\\'s note: hand owner to the support team';"
    )
    const { code, stdout, stderr } = await runAudit('--dir', dir)

    expect(`${stdout}${stderr}`).not.toContain('owner-to')
    expect(code).toBe(0)
  }, 30_000)

  it('ignores ownership words inside dollar-quoted data', async () => {
    const dir = migrationsDir(
      'COMMENT ON TABLE "jobs" IS $note$Transfer owner to the support team, OWNED BY ops.jobs.id$note$;'
    )
    const { code, stdout, stderr } = await runAudit('--dir', dir)

    expect(`${stdout}${stderr}`).not.toContain('owner-to')
    expect(`${stdout}${stderr}`).not.toContain('sequence-owned-by-existing-table')
    expect(code).toBe(0)
  }, 30_000)

  it.each([
    [
      'a DO block naming its language',
      'DO LANGUAGE plpgsql $$ BEGIN ALTER TABLE calls OWNER TO postgres; END $$;',
    ],
    [
      'a function body',
      'CREATE FUNCTION hand_over() RETURNS void AS $fn$ BEGIN ALTER TABLE calls OWNER TO postgres; END $fn$ LANGUAGE plpgsql;',
    ],
  ])(
    'refuses OWNER TO inside %s',
    async (_case, sql) => {
      const { code, stdout, stderr } = await runAudit('--dir', migrationsDir(sql))

      expect(code).toBe(1)
      expect(`${stdout}${stderr}`).toContain('owner-to')
    },
    30_000
  )

  it('refuses OWNED BY an existing table whose name differs only in case from a new quoted one', async () => {
    const dir = migrationsDir(
      [
        'CREATE TABLE "Jobs" ("id" text PRIMARY KEY, "position" bigint);--> statement-breakpoint',
        'ALTER SEQUENCE "jobs_seq" OWNED BY jobs.position;',
      ].join('\n')
    )
    const { code, stdout, stderr } = await runAudit('--dir', dir)

    expect(code).toBe(1)
    expect(`${stdout}${stderr}`).toContain('sequence-owned-by-existing-table')
  }, 30_000)

  it('does not read operations out of literals, comments, or dollar-quoted data', async () => {
    const dir = migrationsDir(
      [
        '-- Next release: ALTER TABLE "jobs" RENAME COLUMN "a" TO "b".',
        'COMMENT ON TABLE "jobs" IS $note$Then ALTER TABLE jobs DROP COLUMN old$note$;--> statement-breakpoint',
        'COMMENT ON COLUMN "jobs"."id" IS \'kept until ALTER TABLE jobs DROP COLUMN id\';',
      ].join('\n')
    )
    const { code, stdout, stderr } = await runAudit('--dir', dir)
    const output = `${stdout}${stderr}`

    expect(output).not.toContain('drop-column')
    expect(output).not.toContain('rename')
    expect(code).toBe(0)
  }, 30_000)

  it('still flags a real destructive operation', async () => {
    const dir = migrationsDir('ALTER TABLE "jobs" DROP COLUMN "old";')
    const { code, stdout, stderr } = await runAudit('--dir', dir)

    expect(code).toBe(1)
    expect(`${stdout}${stderr}`).toContain('drop-column')
  }, 30_000)

  /** Migration 0076 renames a column this way; the literal is SQL the block runs, not data. */
  it.each([
    ['rename', "DO $$ BEGIN EXECUTE 'ALTER TABLE jobs RENAME COLUMN metadata TO data'; END $$;"],
    ['owner-to', "DO $$ BEGIN EXECUTE E'ALTER TABLE jobs OWNER TO postgres'; END $$;"],
  ])(
    'reads dynamic SQL that EXECUTE runs (%s)',
    async (rule, sql) => {
      const { code, stdout, stderr } = await runAudit('--dir', migrationsDir(sql))

      expect(code).toBe(1)
      expect(`${stdout}${stderr}`).toContain(rule)
    },
    30_000
  )

  /**
   * A table created in another schema must not exempt the same-named existing table in `public`
   * from the downtime checks: its old rows still need a default for a NOT NULL column.
   */
  it('keeps checking an existing table when a same-named table is created in another schema', async () => {
    const dir = migrationsDir(
      [
        'CREATE TABLE "archive"."jobs" ("id" text PRIMARY KEY);--> statement-breakpoint',
        'ALTER TABLE "jobs" ADD COLUMN "required" text NOT NULL;',
      ].join('\n')
    )
    const { code, stdout, stderr } = await runAudit('--dir', dir)

    expect(code).toBe(1)
    expect(`${stdout}${stderr}`).toContain('add-not-null-no-default')
  }, 30_000)

  it('still skips the downtime checks for a table the migration creates', async () => {
    const dir = migrationsDir(
      [
        'CREATE TABLE "public"."jobs" ("id" text PRIMARY KEY);--> statement-breakpoint',
        'ALTER TABLE "jobs" ADD COLUMN "required" text NOT NULL;',
      ].join('\n')
    )
    const { code, stdout, stderr } = await runAudit('--dir', dir)

    expect(`${stdout}${stderr}`).not.toContain('add-not-null-no-default')
    expect(code).toBe(0)
  }, 30_000)

  it('ignores ownership words inside string literals and comments', async () => {
    const dir = migrationsDir(
      [
        '-- Hands owner to the support team in a later release.',
        'COMMENT ON TABLE "jobs" IS \'Transfer owner to the support team, OWNED BY ops.jobs.id\';',
      ].join('\n')
    )
    const { code, stdout, stderr } = await runAudit('--dir', dir)

    expect(`${stdout}${stderr}`).not.toContain('owner-to')
    expect(`${stdout}${stderr}`).not.toContain('sequence-owned-by-existing-table')
    expect(code).toBe(0)
  }, 30_000)

  it('passes against a real base ref with no new migrations', async () => {
    const { code, stdout } = await runAudit('HEAD')

    expect(code).toBe(0)
    expect(stdout).toContain('No new migrations to check')
  }, 30_000)
})
