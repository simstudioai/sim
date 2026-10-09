import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import journal from '@sim/db/migrations/meta/_journal.json'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { generateId } from '@sim/utils/id'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const admin = postgres(readTestDatabaseUrl(), { max: 1 })
const name = `project_repair_test_${generateId().replaceAll('-', '')}`
const url = new URL(readTestDatabaseUrl())
url.pathname = `/${name}`
const client = postgres(url.toString(), { max: 1, onnotice: () => {} })
const directory = await mkdtemp(join(tmpdir(), 'project-repair-test-'))
const manifest = join(directory, 'manifest.json')
const report = join(directory, 'report.json')
const environment = {
  ...process.env,
  DATABASE_URL: url.toString(),
  MIGRATION_DATABASE_URL: url.toString(),
}
const execute = promisify(execFile)
const run = (command: string) =>
  execute(
    'bun',
    [
      '--no-env-file',
      'scripts/backfill-projects.ts',
      command,
      '--manifest',
      manifest,
      ...(command === 'plan' ? [] : ['--report', report, '--ack-release-drained']),
    ],
    {
      cwd: new URL('../../../', import.meta.url),
      env: environment,
      timeout: 45000,
    }
  )

beforeAll(async () => {
  await admin.unsafe(`CREATE DATABASE "${name}"`)
  await client.unsafe(
    'CREATE EXTENSION vector; CREATE EXTENSION btree_gin; CREATE EXTENSION pg_trgm'
  )
  const folder = join(directory, 'migrations')
  await mkdir(join(folder, 'meta'), { recursive: true })
  const expansion = journal.entries.find((entry) => entry.tag === '0404_workspace_project_column')
  if (!expansion) throw new Error('Missing expansion migration')
  const entries = journal.entries.filter((entry) => entry.when <= expansion.when)
  const source = new URL('../../../../../packages/db/migrations/', import.meta.url)
  for (const entry of entries)
    await copyFile(new URL(`${entry.tag}.sql`, source), join(folder, `${entry.tag}.sql`))
  await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }))
  await execute(
    'bun',
    [
      '--no-env-file',
      '-e',
      `
    import postgres from 'postgres';
    import { drizzle } from 'drizzle-orm/postgres-js';
    import { migrate } from 'drizzle-orm/postgres-js/migrator';
    import { runScriptMigrations } from '@sim/db/script-migrations/index';
    const sql = postgres(process.env.MIGRATION_DATABASE_URL,{max:1,onnotice:()=>{}});
    try { await migrate(drizzle(sql),{migrationsFolder:process.env.FIXTURE_MIGRATIONS}); await runScriptMigrations(sql); }
    finally { await sql.end(); }
  `,
    ],
    {
      cwd: new URL('../../../../../packages/db/', import.meta.url),
      env: { ...environment, FIXTURE_MIGRATIONS: folder },
      timeout: 120000,
    }
  )
}, 120000)

afterAll(async () => {
  await client.end({ timeout: 2 })
  await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
  await admin.end()
  await rm(directory, { recursive: true, force: true })
})

describe('Operator archive repair against the full compatible schema', () => {
  it('commits the complete cascade, reports external failure and resumes cleanup from its original manifest', async () => {
    await client`INSERT INTO "user" (id,name,email,email_verified,created_at,updated_at) VALUES ('owner','Owner','repair@fixture.test',true,now(),now())`
    await client`INSERT INTO workspace (id,name,owner_id,billed_account_user_id,archived_at) VALUES ('env','Archived','owner','owner','2026-05-01')`
    await client`INSERT INTO workflow (id,name,user_id,workspace_id,last_synced,created_at,updated_at,is_deployed,is_public_api)
      VALUES ('flow','Flow','owner','env',now(),now(),now(),true,true)`
    await client`INSERT INTO workflow_schedule (id,workflow_id,trigger_type,status,next_run_at,last_queued_at) VALUES ('schedule','flow','schedule','active',now(),now())`
    await client`INSERT INTO webhook (id,workflow_id,provider,path,provider_config) VALUES ('hook','flow','gitlab','fixture-hook','{}')`
    await client`INSERT INTO chat (id,workflow_id,user_id,identifier,title) VALUES ('chat','flow','owner','repair-chat','Chat')`
    await client`INSERT INTO workflow_deployment_version (id,workflow_id,version,state,is_active) VALUES ('deployment','flow',1,'{}',true)`
    await client`INSERT INTO workflow_mcp_server (id,workspace_id,created_by,name,is_public) VALUES ('server','env','owner','Server',true)`
    await client`INSERT INTO workflow_mcp_tool (id,server_id,workflow_id,tool_name) VALUES ('tool','server','flow','fixture')`
    await run('plan')
    await expect(run('repair')).rejects.toMatchObject({ code: 1 })
    expect(JSON.parse(await readFile(report, 'utf8'))).toMatchObject({
      status: 'failed',
      repairsCompleted: [],
    })
    expect(await client`SELECT archived_at::text,is_deployed,is_public_api FROM workflow`).toEqual([
      { archived_at: '2026-05-01 00:00:00', is_deployed: false, is_public_api: false },
    ])
    expect(await client`SELECT status,next_run_at,last_queued_at FROM workflow_schedule`).toEqual([
      { status: 'disabled', next_run_at: null, last_queued_at: null },
    ])
    expect(
      await client`SELECT id FROM webhook WHERE archived_at IS NULL OR is_active`
    ).toHaveLength(0)
    expect(await client`SELECT id FROM chat WHERE archived_at IS NULL OR is_active`).toHaveLength(0)
    expect(await client`SELECT id FROM workflow_deployment_version WHERE is_active`).toHaveLength(0)
    expect(await client`SELECT id FROM workflow_mcp_tool WHERE archived_at IS NULL`).toHaveLength(0)
    expect(
      await client`SELECT id FROM workflow_mcp_server WHERE deleted_at IS NULL OR is_public`
    ).toHaveLength(0)
    expect(await client`SELECT id FROM workspace WHERE project_id IS NULL`).toHaveLength(1)
    await expect(run('verify')).rejects.toMatchObject({ code: 2 })
    /** The fixture's missing provider credentials are remediated without making an external request. */
    await client`UPDATE webhook SET provider = 'generic'`
    await expect(run('repair')).rejects.toMatchObject({ code: 2 })
    expect(JSON.parse(await readFile(report, 'utf8'))).toMatchObject({ repairsCompleted: ['env'] })
    await run('apply')
    await run('verify')
    expect(await client`SELECT archived_at::text FROM project`).toEqual([
      { archived_at: '2026-05-01 00:00:00' },
    ])
    expect(await client`SELECT project_id FROM workspace`).toEqual(
      await client`SELECT project_id FROM project_workspace`
    )
  }, 120000)
})
