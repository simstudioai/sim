import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { backfillProjects, type ProjectBackfillReport } from '@sim/db/project-backfill'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { generateId } from '@sim/utils/id'
import postgres, { type Sql } from 'postgres'
import { describe, expect, it } from 'vitest'

/** Isolated pre-Project fixture; applies the actual additive migration, never a schema mock. */
async function withDatabase(run: (sql: Sql, url: string) => Promise<void>) {
  const admin = postgres(readTestDatabaseUrl(), { max: 1 })
  const database = `project_backfill_test_${generateId().replaceAll('-', '')}`
  const url = new URL(readTestDatabaseUrl())
  url.pathname = `/${database}`
  await admin.unsafe(`CREATE DATABASE "${database}"`)
  const sql = postgres(url.toString(), { max: 1, onnotice: () => undefined })
  try {
    await sql.unsafe(`
      CREATE TABLE "user" (id text PRIMARY KEY);
      CREATE TABLE organization (id text PRIMARY KEY);
      CREATE TABLE workspace (
        id text PRIMARY KEY, name text NOT NULL, owner_id text NOT NULL,
        organization_id text, archived_at timestamp, forked_from_workspace_id text
      );
      INSERT INTO "user" VALUES ('owner'), ('other-owner');
      INSERT INTO organization VALUES ('org-a'), ('org-b');
    `)
    await sql.unsafe(
      await readFile(new URL('../migrations/0393_project_foundation.sql', import.meta.url), 'utf8')
    )
    await run(sql, url.toString())
  } finally {
    await sql.end({ timeout: 2 })
    await admin.unsafe(`DROP DATABASE "${database}" WITH (FORCE)`)
    await admin.end()
  }
}

async function seed(sql: Sql) {
  await sql`INSERT INTO workspace (id, name, owner_id, organization_id, forked_from_workspace_id, archived_at) VALUES
    ('a-root', 'Production', 'owner', 'org-a', NULL, NULL),
    ('b-child', 'Staging', 'other-owner', 'org-a', 'a-root', NULL),
    ('c-grandchild', 'Dev', 'owner', 'org-a', 'b-child', NULL),
    ('d-detached', 'Staging', 'owner', NULL, NULL, NULL),
    ('e-detached-child', 'Dev', 'owner', NULL, 'd-detached', NULL),
    ('f-archived', 'Archive', 'owner', NULL, NULL, '2025-01-01'),
    ('g-archived-child', 'Archive child', 'owner', NULL, 'f-archived', '2025-02-01')`
}

const databaseId = 'local-test-database'
const dryRun = (sql: Sql) => backfillProjects(sql, { mode: 'dry-run', databaseId })
const verify = (sql: Sql) => backfillProjects(sql, { mode: 'verify', databaseId })
const apply = (sql: Sql, plan: ProjectBackfillReport) =>
  backfillProjects(sql, { mode: 'apply', databaseId, plan })

describe('Project backfill operator lifecycle', () => {
  it('plans roots and detached families, retains archive timestamps, and replays fixed IDs', async () => {
    await withDatabase(async (sql) => {
      await seed(sql)
      const plan = await dryRun(sql)
      expect(plan.createdProjects).toBe(3)
      expect(plan.assignedWorkspaces).toBe(7)
      expect(await sql`SELECT * FROM project`).toHaveLength(0)
      expect((await verify(sql)).ready).toBe(false)
      const first = await apply(sql, plan)
      expect(first.assignedWorkspaces).toBe(7)
      expect((await verify(sql)).ready).toBe(true)
      const rows = await sql`SELECT id, name, owner_id, archived_at FROM project ORDER BY name`
      expect(rows.map((row) => row.name)).toEqual([
        'Archive - Project',
        'Production - Project',
        'Staging - Project',
      ])
      expect(
        (
          await sql`SELECT archived_at::text AS value FROM project WHERE name = 'Archive - Project'`
        )[0].value
      ).toBe('2025-02-01 00:00:00')
      expect(rows[1].owner_id).toBe('owner')
      const repeat = await apply(sql, plan)
      expect(repeat.createdProjects).toBe(0)
      expect(repeat.unchangedFamilies).toBe(3)
      expect(await sql`SELECT id, name, owner_id, archived_at FROM project ORDER BY name`).toEqual(
        rows
      )
    })
  })

  it('completes partial assignments but blocks split Projects, cycles, missing parents and mixed organizations', async () => {
    await withDatabase(async (sql) => {
      await seed(sql)
      await sql`INSERT INTO project (id, name, owner_id, organization_id) VALUES ('existing', 'Keep this name', 'owner', 'org-a')`
      await sql`INSERT INTO project_workspace VALUES ('existing', 'a-root', now())`
      const plan = await dryRun(sql)
      await apply(sql, plan)
      expect(
        await sql`SELECT workspace_id FROM project_workspace WHERE project_id = 'existing'`
      ).toHaveLength(3)
      expect((await sql`SELECT name FROM project WHERE id = 'existing'`)[0].name).toBe(
        'Keep this name'
      )
      await sql`INSERT INTO project (id, name, owner_id, organization_id) VALUES ('split', 'Split', 'owner', 'org-a'), ('empty', 'Empty', 'owner', NULL)`
      await sql`UPDATE project_workspace SET project_id = 'split' WHERE workspace_id = 'b-child'`
      await sql`INSERT INTO workspace (id, name, owner_id, forked_from_workspace_id) VALUES ('cycle-a', 'A', 'owner', 'cycle-b'), ('cycle-b', 'B', 'owner', 'cycle-a'), ('orphan', 'Orphan', 'owner', 'missing')`
      await sql`UPDATE workspace SET organization_id = 'org-b' WHERE id = 'e-detached-child'`
      const broken = await verify(sql)
      expect(broken.ready).toBe(false)
      expect(broken.conflicts.map((row) => row.reason)).toEqual(
        expect.arrayContaining([
          'Family spans multiple Projects',
          'Family spans organizations',
          'Empty Project',
          'Cycle, missing parent, or lineage depth exceeds 1000',
        ])
      )
      expect(broken.conflicts.find((row) => row.workspaceId === 'a-root')?.projectIds).toEqual([
        'existing',
        'split',
      ])
      await expect(apply(sql, { ...broken, mode: 'dry-run' })).rejects.toThrow('conflict-free')
    })
  })

  it('rejects a new descendant added after dry-run without assigning a partial family', async () => {
    await withDatabase(async (sql) => {
      await seed(sql)
      const plan = await dryRun(sql)
      await sql`INSERT INTO workspace (id, name, owner_id, organization_id, forked_from_workspace_id) VALUES ('late-child', 'Late', 'owner', 'org-a', 'b-child')`
      const result = await apply(sql, plan)
      expect(
        result.conflicts.some(
          (row) => row.workspaceId === 'a-root' && row.reason.includes('changed since dry-run')
        )
      ).toBe(true)
      expect(
        await sql`SELECT * FROM project_workspace WHERE workspace_id IN ('a-root', 'b-child', 'c-grandchild', 'late-child')`
      ).toHaveLength(0)
      const fresh = await dryRun(sql)
      await apply(sql, fresh)
      expect((await verify(sql)).ready).toBe(true)
    })
  })

  it('resumes after a committed-family interruption and retains progress when reporting fails', async () => {
    await withDatabase(async (sql) => {
      await seed(sql)
      const plan = await dryRun(sql)
      let stop = false
      const partial = await backfillProjects(sql, {
        mode: 'apply',
        databaseId,
        plan,
        shouldStop: () => stop,
        onProgress: async (report) => {
          if (report.families === 1) stop = true
        },
      })
      expect(partial.completed).toBe(false)
      expect(partial.createdProjects).toBe(1)
      const firstId = (await sql`SELECT id FROM project`)[0].id
      await expect(
        backfillProjects(sql, {
          mode: 'apply',
          databaseId,
          plan,
          onProgress: async (report) => {
            if (report.createdProjects > 0) throw new Error('Report disk unavailable')
          },
        })
      ).rejects.toThrow('Report disk unavailable')
      expect(await sql`SELECT id FROM project`).toHaveLength(2)
      await apply(sql, plan)
      expect(await sql`SELECT id FROM project WHERE id = ${firstId}`).toHaveLength(1)
      expect((await verify(sql)).ready).toBe(true)
    })
  })

  it('refuses another runner while a run owns the lock and stops on a lost database session', async () => {
    await withDatabase(async (sql, url) => {
      await seed(sql)
      const other = postgres(url, { max: 1 })
      try {
        let checked = false
        await backfillProjects(sql, {
          mode: 'dry-run',
          databaseId,
          onProgress: async () => {
            if (checked) return
            checked = true
            await expect(dryRun(other)).rejects.toThrow('maintenance lock')
          },
        })
        const plan = await dryRun(sql)
        let terminated = false
        let snapshot: ProjectBackfillReport | undefined
        await expect(
          backfillProjects(sql, {
            mode: 'apply',
            databaseId,
            plan,
            onProgress: async (report) => {
              snapshot = structuredClone(report)
              if (terminated || report.families !== 1) return
              terminated = true
              await other`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()`
            },
          })
        ).rejects.toThrow()
        expect(snapshot?.completed).toBe(false)
        expect(snapshot?.createdProjects).toBe(1)
        await apply(other, plan)
        expect((await verify(other)).ready).toBe(true)
      } finally {
        await other.end({ timeout: 2 })
      }
    })
  })

  it('fails boundedly behind a live writer, then succeeds after the writer finishes', async () => {
    await withDatabase(async (sql, url) => {
      await seed(sql)
      const plan = await dryRun(sql)
      const writer = postgres(url, { max: 1 })
      try {
        await writer.begin(async (tx) => {
          await tx`UPDATE workspace SET name = name WHERE id = 'a-root'`
          let last: ProjectBackfillReport | undefined
          await expect(
            backfillProjects(sql, {
              mode: 'apply',
              databaseId,
              plan,
              onProgress: async (report) => {
                last = structuredClone(report)
              },
            })
          ).rejects.toMatchObject({ code: '55P03' })
          expect(last?.retries).toBe(2)
          expect(last?.createdProjects).toBe(0)
        })
        await apply(sql, plan)
        expect((await verify(sql)).ready).toBe(true)
      } finally {
        await writer.end()
      }
    })
  })

  it('retries rolled-back serialization failures but stops on cancellation without partial writes', async () => {
    await withDatabase(async (sql) => {
      await seed(sql)
      const plan = await dryRun(sql)
      await sql.unsafe(`
        CREATE SEQUENCE attempts;
        CREATE FUNCTION fail_twice() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF nextval('attempts') <= 2 THEN RAISE EXCEPTION 'injected serialization failure' USING ERRCODE = '40001'; END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER fail_twice BEFORE INSERT ON project FOR EACH ROW EXECUTE FUNCTION fail_twice();
      `)
      const result = await apply(sql, plan)
      expect(result.retries).toBe(2)
      expect(result.createdProjects).toBe(3)
      expect((await verify(sql)).ready).toBe(true)
      await sql`DELETE FROM project_workspace`
      await sql`DELETE FROM project`
      await sql.unsafe(`
        DROP TRIGGER fail_twice ON project;
        CREATE FUNCTION cancel_write() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'injected cancellation' USING ERRCODE = '57014'; END $$;
        CREATE TRIGGER cancel_write BEFORE INSERT ON project FOR EACH ROW EXECUTE FUNCTION cancel_write();
      `)
      let report: ProjectBackfillReport | undefined
      await expect(
        backfillProjects(sql, {
          mode: 'apply',
          databaseId,
          plan,
          onProgress: async (progress) => {
            report = structuredClone(progress)
          },
        })
      ).rejects.toMatchObject({ code: '57014' })
      expect(report?.retries).toBe(0)
      expect(report?.errorCode).toBe('57014')
      expect(await sql`SELECT * FROM project_workspace`).toHaveLength(0)
      expect(await sql`SELECT * FROM project`).toHaveLength(0)
    })
  })

  it('fails readiness for empty Projects and archived-state mismatch without mutating them', async () => {
    await withDatabase(async (sql) => {
      await seed(sql)
      await apply(sql, await dryRun(sql))
      await sql`UPDATE project SET archived_at = now() WHERE name = 'Production - Project'`
      await sql`INSERT INTO project (id, name, owner_id) VALUES ('empty', 'Empty', 'owner')`
      const result = await verify(sql)
      expect(result.ready).toBe(false)
      expect(result.conflicts.map((row) => row.reason)).toEqual(
        expect.arrayContaining(['Empty Project', 'Project archive state differs'])
      )
      expect(await sql`SELECT id FROM project WHERE id = 'empty'`).toHaveLength(1)
    })
  })
})

/** CLI cases exercise the normal connection contract against an isolated database. */
describe('Project backfill CLI', () => {
  it('runs dry-run/apply/verify with durable reports and refuses a mismatched target', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    await withDatabase(async (sql, url) => {
      await seed(sql)
      const directory = await mkdtemp(join(tmpdir(), 'project-backfill-test-'))
      const planPath = join(directory, 'plan.json')
      const reportPath = join(directory, 'report.json')
      const run = async (args: string[], report = reportPath) => {
        const child = spawn('bun', ['--no-env-file', 'scripts/backfill-projects.ts', ...args], {
          env: {
            ...process.env,
            PROJECT_BACKFILL_DATABASE_URL: url,
            PROJECT_BACKFILL_REPORT_PATH: report,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        let stdout = ''
        let stderr = ''
        child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
          stdout += chunk
        })
        child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
          stderr += chunk
        })
        const code = await new Promise<number | null>((resolve, reject) => {
          child.on('error', reject)
          child.on('close', resolve)
        })
        expect(stdout + stderr).not.toContain(url)
        return { stdout, stderr, code }
      }
      try {
        const dry = await run(['dry-run'], planPath)
        expect(dry.code, dry.stdout + dry.stderr).toBe(0)
        const plan = JSON.parse(await readFile(planPath, 'utf8')) as ProjectBackfillReport
        for (const missing of [
          '--project-writers-enabled',
          '--release-revision',
          '--writers-drained',
        ]) {
          const args = ['apply', '--from-file', planPath, '--database-id', plan.databaseId]
          if (missing !== '--writers-drained') args.push('--writers-drained')
          if (missing !== '--project-writers-enabled') args.push('--project-writers-enabled')
          if (missing !== '--release-revision')
            args.push('--release-revision', 'integration-compatible-release')
          const refused = await run(args)
          expect(refused.code).toBe(1)
          expect(refused.stdout + refused.stderr).toContain('Apply requires')
          expect(await sql`SELECT * FROM project`).toHaveLength(0)
        }

        expect(
          (
            await run([
              'apply',
              '--from-file',
              planPath,
              '--writers-drained',
              '--project-writers-enabled',
              '--release-revision',
              'integration-compatible-release',
              '--database-id',
              'wrong',
            ])
          ).code
        ).toBe(1)
        expect(await sql`SELECT * FROM project`).toHaveLength(0)
        expect(
          (
            await run([
              'apply',
              '--from-file',
              planPath,
              '--writers-drained',
              '--project-writers-enabled',
              '--release-revision',
              'integration-compatible-release',
              '--database-id',
              plan.databaseId,
            ])
          ).code
        ).toBe(0)
        const applied = JSON.parse(await readFile(reportPath, 'utf8'))
        expect(applied.operatorAssertions).toEqual({
          oldWritersDrained: true,
          projectWritersEnabled: true,
          releaseRevision: 'integration-compatible-release',
        })
        expect((await run(['verify'])).code).toBe(0)
        const report = JSON.parse(await readFile(reportPath, 'utf8')) as ProjectBackfillReport
        expect(report.ready).toBe(true)
        expect(
          (
            await run(
              [
                'apply',
                '--from-file',
                planPath,
                '--writers-drained',
                '--project-writers-enabled',
                '--release-revision',
                'integration-compatible-release',
                '--database-id',
                plan.databaseId,
              ],
              planPath
            )
          ).code
        ).toBe(1)
        expect(JSON.parse(await readFile(planPath, 'utf8')).mode).toBe('dry-run')
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    })
  })
})
