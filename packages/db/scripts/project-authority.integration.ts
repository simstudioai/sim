import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { runScriptMigrations, scriptMigrations } from '@sim/db/script-migrations'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { generateId } from '@sim/utils/id'
import postgres, { type Sql } from 'postgres'
import { describe, expect, it } from 'vitest'

async function database(run: (sql: Sql, runner: Sql, url: string) => Promise<void>) {
  const admin = postgres(readTestDatabaseUrl(), { max: 1 })
  const name = `project_authority_test_${generateId().replaceAll('-', '')}`
  const url = new URL(readTestDatabaseUrl())
  url.pathname = `/${name}`
  await admin`CREATE DATABASE ${admin(name)}`
  const sql = postgres(url.toString(), { max: 1, onnotice: () => {} })
  const runner = postgres(url.toString(), { max: 1, max_lifetime: null, onnotice: () => {} })
  try {
    await sql.unsafe(`
      CREATE TABLE "user" (id text PRIMARY KEY);
      CREATE TABLE organization (id text PRIMARY KEY);
      CREATE TABLE workspace (id text PRIMARY KEY, name text NOT NULL, owner_id text NOT NULL,
        organization_id text, archived_at timestamp, forked_from_workspace_id text REFERENCES workspace(id));
      CREATE INDEX workspace_parent_idx ON workspace(forked_from_workspace_id);
      CREATE TABLE workflow (id text PRIMARY KEY, workspace_id text REFERENCES workspace(id), archived_at timestamp);
      INSERT INTO "user" VALUES ('owner');
    `)
    await sql.unsafe(
      await readFile(new URL('../migrations/0394_project_foundation.sql', import.meta.url), 'utf8')
    )
    const expansion = await readFile(
      new URL('../migrations/0405_workspace_project_column.sql', import.meta.url),
      'utf8'
    )
    for (const statement of expansion.split('--> statement-breakpoint')) await sql.unsafe(statement)
    await sql`INSERT INTO project (id,name,owner_id) VALUES ('retained','Retained','owner')`
    await sql`INSERT INTO workspace (id,name,owner_id) VALUES ('env','Environment','owner')`
    await sql`INSERT INTO project_workspace (project_id,workspace_id) VALUES ('retained','env')`
    await run(sql, runner, url.toString())
  } finally {
    await Promise.all([sql.end({ timeout: 2 }), runner.end({ timeout: 2 })])
    await admin`DROP DATABASE ${admin(name)} WITH (FORCE)`
    await admin.end()
  }
}

function migrate(sql: Sql) {
  return runScriptMigrations(
    sql,
    scriptMigrations.filter((entry) => entry.name === '0031_project_membership')
  )
}

async function phase(sql: Sql) {
  return sql`SELECT phase FROM project_membership_rollout WHERE id = 'membership'`
}

describe('Project membership authority cutover', () => {
  it('leaves connector authority intact while a legacy transaction is active and switches after it commits', async () => {
    await database(async (sql, runner) => {
      await sql.begin(async (tx) => {
        await tx`UPDATE workspace SET name = 'Legacy write' WHERE id = 'env'`
        await expect(migrate(runner)).rejects.toMatchObject({ code: '55P03' })
        expect(await phase(tx)).toEqual([{ phase: 'connector' }])
        expect(await tx`SELECT project_id FROM workspace`).toEqual([{ project_id: null }])
      })
      await migrate(runner)
      expect(await phase(sql)).toEqual([{ phase: 'column' }])
      expect(await sql`SELECT name,project_id FROM workspace`).toEqual([
        { name: 'Legacy write', project_id: 'retained' },
      ])
      expect(await sql`SELECT to_regclass('project_workspace') AS connector`).toEqual([
        { connector: null },
      ])
    })
  })

  it('rejects acknowledged CLI writes before the authority switch', async () => {
    await database(async (sql, _runner, url) => {
      await expect(
        promisify(execFile)(
          'bun',
          [
            '--no-env-file',
            'scripts/backfill-projects.ts',
            'apply',
            '--manifest',
            '/nonexistent-project-plan.json',
            '--report',
            '/nonexistent-project-report.json',
            '--ack-release-drained',
          ],
          {
            cwd: new URL('../../../apps/sim/', import.meta.url),
            env: { ...process.env, MIGRATION_DATABASE_URL: url },
          }
        )
      ).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('authority must switch') })
      expect(await phase(sql)).toEqual([{ phase: 'connector' }])
      expect(await sql`SELECT project_id FROM workspace`).toEqual([{ project_id: null }])
    })
  })

  it('keeps read-only connector transactions ahead of cutover', async () => {
    await database(async (sql, runner) => {
      await sql.begin('isolation level repeatable read read only', async (tx) => {
        await tx`LOCK TABLE workspace IN ACCESS SHARE MODE`
        expect(await phase(tx)).toEqual([{ phase: 'connector' }])
        await expect(migrate(runner)).rejects.toMatchObject({ code: '55P03' })
        expect(await phase(tx)).toEqual([{ phase: 'connector' }])
      })
      await migrate(runner)
      expect(await phase(sql)).toEqual([{ phase: 'column' }])
    })
  })

  it('commits the switch before a discovery failure and resumes with intervening column writes', async () => {
    await database(async (sql, runner) => {
      await sql`INSERT INTO project (id,name,owner_id) VALUES ('empty','Needs remediation','owner')`
      await expect(migrate(runner)).rejects.toThrow('conflicts')
      expect(await phase(sql)).toEqual([{ phase: 'column' }])
      expect(
        await sql`SELECT name FROM script_migrations WHERE name = '0031_project_membership'`
      ).toHaveLength(0)
      await sql`INSERT INTO workspace (id,name,owner_id,project_id) VALUES ('new','Column writer','owner','empty')`
      await migrate(runner)
      await migrate(runner)
      expect(await phase(sql)).toEqual([{ phase: 'column' }])
      expect(await sql`SELECT id,project_id FROM workspace ORDER BY id`).toEqual([
        { id: 'env', project_id: 'retained' },
        { id: 'new', project_id: 'empty' },
      ])
      expect(
        await sql`SELECT name FROM script_migrations WHERE name = '0031_project_membership'`
      ).toHaveLength(1)
    })
  })

  it.each(['missing-row', 'missing-table', 'invalid-phase', 'populated-column'] as const)(
    'fails closed for %s without copying membership or retiring the connector',
    async (state) => {
      await database(async (sql, runner) => {
        if (state === 'missing-row') await sql`DELETE FROM project_membership_rollout`
        if (state === 'missing-table') await sql`DROP TABLE project_membership_rollout`
        if (state === 'invalid-phase') {
          await sql`ALTER TABLE project_membership_rollout DROP CONSTRAINT project_membership_rollout_phase`
          await sql`UPDATE project_membership_rollout SET phase = 'invalid'`
        }
        if (state === 'populated-column') await sql`UPDATE workspace SET project_id = 'retained'`
        const before = await sql`SELECT id,project_id FROM workspace`
        await expect(migrate(runner)).rejects.toThrow(/authority|rollout|populated/i)
        expect(await sql`SELECT id,project_id FROM workspace`).toEqual(before)
        expect(await sql`SELECT project_id,workspace_id FROM project_workspace`).toEqual([
          { project_id: 'retained', workspace_id: 'env' },
        ])
        expect(
          await sql`SELECT name FROM script_migrations WHERE name = '0031_project_membership'`
        ).toHaveLength(0)
      })
    }
  )
})
