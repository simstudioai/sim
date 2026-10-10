import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { switchProjectMembershipAuthority } from '@sim/db/maintenance/project-rollout'
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
let directory: string
let manifest: string
let report: string
const redisUrl = readTestRedisUrl()
const describeWithRedis = describe.runIf(Boolean(redisUrl))
let cache: Redis
let subscriber: Redis
const mcpServerId = generateId()
const cacheKey = `mcp:tools:workspace:env:server:${mcpServerId}`
const published: unknown[] = []
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

describeWithRedis('Operator archive repair against the full compatible schema', () => {
  beforeAll(async () => {
    if (!redisUrl) throw new Error('Archive repair integration requires TEST_REDIS_URL')
    directory = await mkdtemp(join(tmpdir(), 'project-repair-test-'))
    manifest = join(directory, 'manifest.json')
    report = join(directory, 'report.json')
    cache = new Redis(redisUrl)
    subscriber = new Redis(redisUrl)
    subscriber.on('message', (_channel, message) => published.push(JSON.parse(message)))
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
    const expansion = journal.entries.find((entry) => entry.tag === '0406_workspace_project_column')
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
      const membershipIndex = scriptMigrations.findIndex((item) => item.name === '0031_project_membership');
      if (membershipIndex < 0) throw new Error('Missing membership script migration');
      try { await migrate(drizzle(sql),{migrationsFolder:process.env.FIXTURE_MIGRATIONS}); await runScriptMigrations(sql, scriptMigrations.slice(0, membershipIndex)); }
      finally { await sql.end(); }
    `,
      ],
      {
        cwd: new URL('../../../../../packages/db/', import.meta.url),
        env: { ...environment, FIXTURE_MIGRATIONS: folder },
        timeout: 120000,
      }
    )
    await client`SELECT pg_advisory_lock(hashtextextended('sim:project-backfill-operator', 0))`
    try {
      await switchProjectMembershipAuthority(client)
    } finally {
      await client`SELECT pg_advisory_unlock(hashtextextended('sim:project-backfill-operator', 0))`
    }
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
          VALUES (${projectId},'Stale active Project',${ownerId},NULL)`
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
        expect(await client`SELECT archived_at::text FROM project WHERE id = ${projectId}`).toEqual(
          [{ archived_at: '2026-05-01 00:00:00' }]
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

  it.each(['column', 'mixed'] as const)(
    'repairs an explicitly reviewed detached family with %s membership and replays a lost report',
    async (membership) => {
      const artifacts = {
        manifest: join(directory, `detach-${membership}-manifest.json`),
        report: join(directory, `detach-${membership}-report.json`),
      }
      try {
        await client`INSERT INTO "user" (id,name,email,email_verified,created_at,updated_at)
        VALUES ('detach-owner','Owner','detach@fixture.test',true,now(),now())`
        await client`INSERT INTO project (id,name,owner_id) VALUES ('detach-project','Keep context','detach-owner')`
        await client`INSERT INTO workspace (id,name,owner_id,billed_account_user_id,project_id)
        VALUES ('retained-root','Retained','detach-owner','detach-owner','detach-project'),
          ('detached-root','Detached','detach-owner','detach-owner','detach-project')`
        await client`INSERT INTO workspace (id,name,owner_id,billed_account_user_id,project_id,forked_from_workspace_id)
        VALUES ('detached-child','Child','detach-owner','detach-owner','detach-project','detached-root')`
        if (membership === 'mixed') {
          await client`INSERT INTO project_workspace (project_id,workspace_id)
          VALUES ('detach-project','retained-root'),('detach-project','detached-child')`
          await client`UPDATE workspace SET project_id=NULL WHERE id IN ('retained-root','detached-child')`
        }
        await expect(run('plan', artifacts)).rejects.toMatchObject({ code: 2 })
        const plan = JSON.parse(await readFile(artifacts.manifest, 'utf8'))
        plan.groupings[0].decision = 'detach'
        plan.groupings[0].detachRootId = 'detached-root'
        await writeFile(artifacts.manifest, JSON.stringify(plan))
        const before =
          await client`SELECT id,owner_id,organization_id,archived_at,forked_from_workspace_id FROM workspace ORDER BY id`
        const holder = postgres(url.toString(), { max: 1 })
        try {
          await holder.begin(async (tx) => {
            await tx`SELECT pg_advisory_xact_lock(hashtextextended('project:detach-project',0))`
            await expect(run('repair', artifacts)).rejects.toMatchObject({ code: 2 })
            expect(await client`SELECT id FROM project WHERE owner_id='detach-owner'`).toHaveLength(
              1
            )
          })
          if (membership === 'mixed') {
            await client`INSERT INTO project (id,name,owner_id) VALUES ('changed-project','Changed','detach-owner')`
            await holder.begin(async (tx) => {
              await tx`UPDATE project_workspace SET project_id='changed-project' WHERE workspace_id='retained-root'`
              await expect(run('repair', artifacts)).rejects.toMatchObject({ code: 2 })
              expect(
                await client`SELECT project_id FROM workspace WHERE id='retained-root'`
              ).toEqual([{ project_id: null }])
              expect(
                await client`SELECT id FROM project WHERE id=${plan.groupings[0].destinationProjectId}`
              ).toHaveLength(0)
            })
            await expect(run('repair', artifacts)).rejects.toMatchObject({ code: 1 })
            expect(await client`SELECT project_id FROM workspace WHERE id='retained-root'`).toEqual(
              [{ project_id: null }]
            )
            await client`UPDATE project_workspace SET project_id='detach-project' WHERE workspace_id='retained-root'`
            await client`DELETE FROM project WHERE id='changed-project'`
          }
        } finally {
          await holder.end()
        }
        await client`UPDATE workspace SET archived_at='2026-05-01' WHERE id='detached-child'`
        await expect(run('repair', artifacts)).rejects.toMatchObject({ code: 1 })
        expect(await client`SELECT id FROM project WHERE owner_id='detach-owner'`).toHaveLength(1)
        await client`UPDATE workspace SET archived_at=NULL WHERE id='detached-child'`
        await expect(run('repair', artifacts)).rejects.toMatchObject({ code: 2 })
        const destination = plan.groupings[0].destinationProjectId
        expect(
          await client`SELECT id FROM workspace WHERE project_id = ${destination} ORDER BY id`
        ).toEqual([{ id: 'detached-child' }, { id: 'detached-root' }])
        expect(await client`SELECT id,name FROM project WHERE id = 'detach-project'`).toEqual([
          { id: 'detach-project', name: 'Keep context' },
        ])
        expect(
          await client`SELECT id,owner_id,organization_id,archived_at,forked_from_workspace_id FROM workspace ORDER BY id`
        ).toEqual(before)
        await rm(artifacts.report)
        await expect(run('repair', artifacts)).rejects.toMatchObject({ code: 2 })
        expect(await client`SELECT id FROM project WHERE owner_id = 'detach-owner'`).toHaveLength(2)
      } finally {
        await client`DELETE FROM workspace WHERE owner_id = 'detach-owner'`
        await client`DELETE FROM project WHERE owner_id = 'detach-owner'`
        await client`DELETE FROM "user" WHERE id = 'detach-owner'`
      }
    },
    60000
  )

  it('keeps a Project active when another active environment still uses legacy membership', async () => {
    const artifacts = {
      manifest: join(directory, 'legacy-active-manifest.json'),
      report: join(directory, 'legacy-active-report.json'),
    }
    try {
      await client`INSERT INTO "user" (id,name,email,email_verified,created_at,updated_at)
        VALUES ('legacy-owner','Owner','legacy@fixture.test',true,now(),now())`
      await client`INSERT INTO project (id,name,owner_id) VALUES ('legacy-project','Project','legacy-owner')`
      await client`INSERT INTO workspace (id,name,owner_id,billed_account_user_id,project_id,archived_at)
        VALUES ('legacy-archive','Archived','legacy-owner','legacy-owner','legacy-project','2026-05-01'),
          ('legacy-live','Live','legacy-owner','legacy-owner',NULL,NULL)`
      await client`INSERT INTO project_workspace (project_id,workspace_id) VALUES ('legacy-project','legacy-live'),('legacy-project','legacy-archive')`
      await client`INSERT INTO workflow (id,name,user_id,workspace_id,last_synced,created_at,updated_at)
        VALUES ('legacy-flow','Flow','legacy-owner','legacy-archive',now(),now(),now())`
      await run('plan', artifacts)
      await expect(run('repair', artifacts)).rejects.toMatchObject({ code: 2 })
      expect(await client`SELECT archived_at FROM project WHERE id='legacy-project'`).toEqual([
        { archived_at: null },
      ])
    } finally {
      await client`DELETE FROM workspace WHERE owner_id='legacy-owner'`
      await client`DELETE FROM project WHERE id='legacy-project'`
      await client`DELETE FROM "user" WHERE id='legacy-owner'`
    }
  }, 60000)

  it('notifies healthy local MCP subscribers and completes cleanup after another subscriber throws', async () => {
    const serverId = generateId()
    try {
      await client`INSERT INTO "user" (id,name,email,email_verified,created_at,updated_at)
        VALUES ('local-owner','Owner','local@fixture.test',true,now(),now())`
      await client`INSERT INTO project (id,name,owner_id) VALUES ('local-project','Project','local-owner')`
      await client`INSERT INTO workspace (id,name,owner_id,billed_account_user_id,project_id,archived_at)
        VALUES ('local-env','Archived','local-owner','local-owner','local-project','2026-05-01')`
      await client`INSERT INTO workflow (id,name,user_id,workspace_id,last_synced,created_at,updated_at)
        VALUES ('local-flow','Flow','local-owner','local-env',now(),now(),now())`
      await client`INSERT INTO workflow_mcp_server (id,workspace_id,created_by,name,is_public)
        VALUES (${serverId},'local-env','local-owner','Server',true)`
      await client`INSERT INTO workflow_mcp_tool (id,server_id,workflow_id,tool_name)
        VALUES ('local-tool',${serverId},'local-flow','fixture')`
      await execute(
        'bun',
        [
          '--no-env-file',
          '-e',
          `
        import { repairArchivedProjectEnvironment } from '@/lib/projects/backfill-repair';
        import { mcpPubSub } from '@/lib/mcp/pubsub';
        import { db, dbReplica } from '@sim/db';
        import assert from 'node:assert/strict';
        import postgres from 'postgres';
        const client = postgres(process.env.MIGRATION_DATABASE_URL, {max:1});
        const unsubscribe = mcpPubSub.onWorkflowToolsChanged(() => { throw new Error('fixture subscriber failed'); });
        const received = [];
        const unsubscribeHealthy = mcpPubSub.onWorkflowToolsChanged((event) => received.push(event));
        try {
          await repairArchivedProjectEnvironment(client, {workspaceId:'local-env', archivedAt:'2026-05-01 00:00:00', workflowIds:['local-flow']}, 'local-subscriber');
          assert.ok(received.some((event) => event.serverId === '${serverId}' && event.workspaceId === 'local-env'), 'Healthy subscriber missed the archive notification');
        } finally {
          unsubscribe(); unsubscribeHealthy(); mcpPubSub.dispose(); await client.end();
          await Promise.all([...new Set([db.$client,dbReplica.$client])].map(client=>client.end()));
        }
      `,
        ],
        {
          cwd: new URL('../../../', import.meta.url),
          env: { ...environment, REDIS_URL: '' },
          timeout: 45000,
        }
      )
      expect(
        await client`SELECT completed_at IS NOT NULL AS complete FROM public.project_backfill_archive_repairs WHERE workspace_id = 'local-env'`
      ).toEqual([{ complete: true }])
    } finally {
      await client`DELETE FROM workspace WHERE id = 'local-env'`
      await client`DELETE FROM project WHERE id = 'local-project'`
      await client`DELETE FROM "user" WHERE id = 'local-owner'`
    }
  }, 60000)

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
      await client`SELECT id AS project_id FROM project`
    )
    expect(await client`SELECT project_id FROM project_workspace`).toHaveLength(0)
  }, 120000)
  it('finishes the real migration entrypoint with exact reviewed grouping and retries deployment without the private file', async () => {
    const artifacts = {
      manifest: join(directory, 'entrypoint-manifest.json'),
      report: join(directory, 'entrypoint-report.json'),
    }
    await client`INSERT INTO "user" (id,name,email,email_verified,created_at,updated_at)
      VALUES ('entry-owner','Owner','entry@fixture.test',true,now(),now())`
    await client`INSERT INTO project (id,name,owner_id) VALUES ('entry-project','Keep shared context','entry-owner')`
    await client`INSERT INTO workspace (id,name,owner_id,billed_account_user_id,project_id)
      VALUES ('entry-a','A','entry-owner','entry-owner','entry-project'),('entry-b','B','entry-owner','entry-owner','entry-project')`
    await expect(run('plan', artifacts)).rejects.toMatchObject({ code: 2 })
    const migrate = (reviewPath?: string) =>
      execute('bun', ['--no-env-file', 'scripts/migrate.ts'], {
        cwd: new URL('../../../../../packages/db/', import.meta.url),
        env: { ...environment, PROJECT_BACKFILL_REVIEW_PATH: reviewPath },
        timeout: 120000,
      })
    await expect(migrate()).rejects.toMatchObject({ code: 1 })
    const reviewed = JSON.parse(await readFile(artifacts.manifest, 'utf8'))
    reviewed.groupings[0].decision = 'retain'
    await writeFile(artifacts.manifest, JSON.stringify(reviewed))
    await client`UPDATE workspace SET archived_at='2026-05-01' WHERE id='entry-b'`
    await expect(migrate(artifacts.manifest)).rejects.toMatchObject({ code: 1 })
    expect(
      await client`SELECT name FROM script_migrations WHERE name='0031_project_membership'`
    ).toHaveLength(0)
    expect(
      await client`SELECT to_regclass('public.project_workspace') IS NOT NULL AS present`
    ).toEqual([{ present: true }])
    await client`UPDATE workspace SET archived_at=NULL WHERE id='entry-b'`
    await migrate(artifacts.manifest)
    expect(
      await client`SELECT name FROM script_migrations WHERE name='0031_project_membership'`
    ).toHaveLength(1)
    expect(await client`SELECT to_regclass('public.project_workspace') AS connector`).toEqual([
      { connector: null },
    ])
    expect(
      await client`SELECT id,project_id FROM workspace WHERE owner_id='entry-owner' ORDER BY id`
    ).toEqual([
      { id: 'entry-a', project_id: 'entry-project' },
      { id: 'entry-b', project_id: 'entry-project' },
    ])
    await rm(artifacts.manifest)
    await migrate()
  }, 120000)
})
