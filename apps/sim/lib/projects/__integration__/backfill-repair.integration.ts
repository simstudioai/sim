import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import journal from '@sim/db/migrations/meta/_journal.json'
import { readTestDatabaseUrl, readTestRedisUrl } from '@sim/db/testing/test-infrastructure'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { generateId } from '@sim/utils/id'
import Redis from 'ioredis'
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
const redisUrl = readTestRedisUrl()
if (!redisUrl) throw new Error('Archive repair integration requires TEST_REDIS_URL')
const cache = new Redis(redisUrl)
const subscriber = new Redis(redisUrl)
const mcpServerId = generateId()
const cacheKey = `mcp:tools:workspace:env:server:${mcpServerId}`
const published: unknown[] = []
subscriber.on('message', (_channel, message) => published.push(JSON.parse(message)))
const releaseNotifications = createDeferred<void>()
let tailNotified = false
const realtime = createServer(async (request, response) => {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  const { workflowId } = JSON.parse(Buffer.concat(chunks).toString()) as { workflowId: string }
  if (workflowId === 'tail') tailNotified = true
  if (workflowId.startsWith('slow-')) await releaseNotifications.promise
  response.writeHead(200, { 'content-type': 'application/json' }).end('{}')
})
const environment = {
  ...process.env,
  DATABASE_URL: url.toString(),
  MIGRATION_DATABASE_URL: url.toString(),
  REDIS_URL: redisUrl,
  SOCKET_SERVER_URL: process.env.SOCKET_SERVER_URL,
}
const execute = promisify(execFile)
const run = (command: string, artifacts = { manifest, report }) =>
  execute(
    'bun',
    [
      '--no-env-file',
      'scripts/backfill-projects.ts',
      command,
      '--manifest',
      artifacts.manifest,
      ...(command === 'plan' ? [] : ['--report', artifacts.report, '--ack-release-drained']),
    ],
    {
      cwd: new URL('../../../', import.meta.url),
      env: environment,
      timeout: 45000,
    }
  )

beforeAll(async () => {
  await new Promise<void>((resolve) => realtime.listen(0, '127.0.0.1', resolve))
  const address = realtime.address()
  if (!address || typeof address === 'string') throw new Error('Realtime fixture failed to bind')
  environment.SOCKET_SERVER_URL = `http://127.0.0.1:${address.port}`
  await subscriber.subscribe('mcp:workflow_tools_changed')
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
    import { runScriptMigrations, scriptMigrations } from '@sim/db/script-migrations/index';
    const sql = postgres(process.env.MIGRATION_DATABASE_URL,{max:1,onnotice:()=>{}});
    try { await migrate(drizzle(sql),{migrationsFolder:process.env.FIXTURE_MIGRATIONS}); await runScriptMigrations(sql, scriptMigrations.filter((item) => item.name !== '0031_project_membership')); }
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
  releaseNotifications.resolve()
  await new Promise<void>((resolve, reject) => {
    realtime.close((error) => (error ? reject(error) : resolve()))
    realtime.closeAllConnections()
  })
  await cache.del(cacheKey)
  await Promise.all([cache.quit(), subscriber.quit()])
  await client.end({ timeout: 2 })
  await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
  await admin.end()
  await rm(directory, { recursive: true, force: true })
})

describe('Operator archive repair against the full compatible schema', () => {
  it.each(['workspace', 'project', 'row'] as const)(
    'defers a busy %s lock, repairs unrelated environments and resumes without losing progress',
    async (lock) => {
      const ownerId = `owner-${lock}`
      const busyId = `busy-${lock}`
      const freeId = `free-${lock}`
      const projectId = `project-${lock}`
      const artifacts = {
        manifest: join(directory, `${lock}-manifest.json`),
        report: join(directory, `${lock}-report.json`),
      }
      const holder = postgres(url.toString(), { max: 1, onnotice: () => {} })
      try {
        await client`INSERT INTO "user" (id,name,email,email_verified,created_at,updated_at)
          VALUES (${ownerId},'Owner',${`${lock}@fixture.test`},true,now(),now())`
        await client`INSERT INTO project (id,name,owner_id,archived_at)
          VALUES (${projectId},'Archived Project',${ownerId},'2026-05-01')`
        await client`INSERT INTO workspace (id,name,owner_id,billed_account_user_id,project_id,archived_at)
          VALUES (${busyId},'Busy',${ownerId},${ownerId},${projectId},'2026-05-01'),
            (${freeId},'Free',${ownerId},${ownerId},NULL,'2026-05-01')`
        await client`INSERT INTO workflow (id,name,user_id,workspace_id,last_synced,created_at,updated_at)
          VALUES (${busyId},'Busy flow',${ownerId},${busyId},now(),now(),now()),
            (${freeId},'Free flow',${ownerId},${freeId},now(),now(),now())`
        await run('plan', artifacts)
        await holder.begin(async (tx) => {
          if (lock === 'row') await tx`SELECT id FROM workspace WHERE id = ${busyId} FOR SHARE`
          else {
            const key = lock === 'workspace' ? `project-backfill:${busyId}` : `project:${projectId}`
            await tx`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`
          }
          await expect(run('repair', artifacts)).rejects.toMatchObject({ code: 2 })
          expect(
            await client`SELECT workspace_id FROM project_backfill_archive_repairs WHERE workspace_id = ${busyId}`
          ).toHaveLength(0)
          expect(JSON.parse(await readFile(artifacts.report, 'utf8'))).toMatchObject({
            status: 'incomplete',
            repairsCompleted: [freeId],
          })
          expect(await client`SELECT workspace_id FROM workflow WHERE archived_at IS NULL`).toEqual(
            [{ workspace_id: busyId }]
          )
        })
        await expect(run('repair', artifacts)).rejects.toMatchObject({ code: 2 })
        expect(JSON.parse(await readFile(artifacts.report, 'utf8')).repairsCompleted).toEqual(
          expect.arrayContaining([freeId, busyId])
        )
        await run('apply', artifacts)
        await run('verify', artifacts)
      } finally {
        await holder.end({ timeout: 2 })
        await client`DELETE FROM workspace WHERE owner_id = ${ownerId}`
        await client`DELETE FROM project WHERE owner_id = ${ownerId}`
        await client`DELETE FROM "user" WHERE id = ${ownerId}`
      }
    },
    60000
  )

  it('commits the complete cascade, reports external failure and resumes cleanup from its original manifest', async () => {
    await client`INSERT INTO "user" (id,name,email,email_verified,created_at,updated_at) VALUES ('owner','Owner','repair@fixture.test',true,now(),now())`
    await client`INSERT INTO workspace (id,name,owner_id,billed_account_user_id,archived_at) VALUES ('env','Archived','owner','owner','2026-05-01')`
    await client`INSERT INTO workflow (id,name,user_id,workspace_id,last_synced,created_at,updated_at,is_deployed,is_public_api)
      VALUES ('flow','Flow','owner','env',now(),now(),now(),true,true)`
    await client`INSERT INTO workflow (id,name,user_id,workspace_id,last_synced,created_at,updated_at)
      SELECT 'slow-' || n,'Slow notification ' || n,'owner','env',now(),now(),now() FROM generate_series(1,7) n
      UNION ALL SELECT 'tail','Last notification','owner','env',now(),now(),now()`
    await client`INSERT INTO workflow_schedule (id,workflow_id,trigger_type,status,next_run_at,last_queued_at) VALUES ('schedule','flow','schedule','active',now(),now())`
    await client`INSERT INTO webhook (id,workflow_id,provider,path,provider_config) VALUES ('hook','flow','gitlab','fixture-hook','{}')`
    await client`INSERT INTO chat (id,workflow_id,user_id,identifier,title) VALUES ('chat','flow','owner','repair-chat','Chat')`
    await client`INSERT INTO workflow_deployment_version (id,workflow_id,version,state,is_active) VALUES ('deployment','flow',1,'{}',true)`
    await client`INSERT INTO workflow_mcp_server (id,workspace_id,created_by,name,is_public) VALUES (${mcpServerId},'env','owner','Server',true)`
    await client`INSERT INTO workflow_mcp_tool (id,server_id,workflow_id,tool_name) VALUES ('tool',${mcpServerId},'flow','fixture')`
    await client`INSERT INTO mcp_servers (id,workspace_id,created_by,name,transport) VALUES (${mcpServerId},'env','owner','Cached server','streamable-http')`
    await cache.set(cacheKey, JSON.stringify({ tools: [], expiry: Date.now() + 60000 }), 'EX', 60)
    await run('plan')
    const repair = run('repair').then(
      () => null,
      (error: unknown) => error
    )
    try {
      await expect.poll(() => tailNotified, { timeout: 10000 }).toBe(true)
      expect(JSON.parse(await readFile(report, 'utf8')).status).toBe('running')
    } finally {
      releaseNotifications.resolve()
      await repair
    }
    expect(await repair).toMatchObject({ code: 1 })
    expect(await cache.get(cacheKey)).toBeNull()
    await expect
      .poll(() => published, { timeout: 2000 })
      .toContainEqual({ serverId: mcpServerId, workspaceId: 'env' })
    expect(JSON.parse(await readFile(report, 'utf8'))).toMatchObject({
      status: 'failed',
      repairsCompleted: [],
    })
    expect(await client`SELECT id FROM workflow`).toHaveLength(9)
    expect(
      await client`SELECT id FROM workflow WHERE archived_at IS DISTINCT FROM '2026-05-01'::timestamp OR is_deployed OR is_public_api`
    ).toHaveLength(0)
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
    expect(
      await client`SELECT workspace_id FROM project_backfill_archive_repairs WHERE completed_at IS NULL`
    ).toEqual([{ workspace_id: 'env' }])
    await expect(
      execute(
        'bun',
        [
          '--no-env-file',
          '-e',
          `
      import postgres from 'postgres';
      import { runScriptMigrations, scriptMigrations } from '@sim/db/script-migrations/index';
      const sql = postgres(process.env.MIGRATION_DATABASE_URL, {max:1});
      try { await runScriptMigrations(sql, scriptMigrations.filter((item) => item.name === '0031_project_membership')); }
      finally { await sql.end(); }
    `,
        ],
        {
          cwd: new URL('../../../../../packages/db/', import.meta.url),
          env: environment,
          timeout: 15000,
        }
      )
    ).rejects.toMatchObject({ code: 1 })
    expect(await client`SELECT to_regclass('project_workspace')::text AS connector`).toEqual([
      { connector: 'project_workspace' },
    ])
    /** The fixture's missing provider credentials are remediated without making an external request. */
    await client`UPDATE webhook SET provider = 'generic'`
    await expect(run('repair')).rejects.toMatchObject({ code: 2 })
    expect(JSON.parse(await readFile(report, 'utf8'))).toMatchObject({ repairsCompleted: ['env'] })
    expect(
      await client`SELECT workspace_id FROM project_backfill_archive_repairs WHERE completed_at IS NULL`
    ).toHaveLength(0)
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
