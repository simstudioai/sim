import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import * as schema from '@sim/db/schema'
import { createPostgresStorageReconciliationStore } from '@sim/db/script-migrations/0003_backfill_workspace_storage_usage'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { sql as query } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type ProjectStorageBillingContext,
  resolveProjectStorageBillingContext,
  type StorageBillingContext,
} from '@/lib/billing/storage/context'
import { StorageLimitExceededError } from '@/lib/billing/storage/limits'
import {
  changeProjectAndWorkspaceStoragePayersInTx,
  changeProjectStoragePayersInTx,
} from '@/lib/billing/storage/payer-transfer'
import {
  incrementStorageUsageForBillingContextInTx,
  prepareProjectStorageMutationInTx,
} from '@/lib/billing/storage/tracking'
import { prepareProjectsForAccountDeletion } from '@/lib/projects/account-deletion'
import { transferWorkspaceProjects } from '@/lib/projects/membership'

const databaseUrl = readTestDatabaseUrl()
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []

function check(name: string, run: () => Promise<void>) {
  it(name, async () => {
    const started = performance.now()
    try {
      await run()
      checks.push({ name, status: 'passed', durationMs: performance.now() - started })
    } catch (error) {
      checks.push({
        name,
        status: 'failed',
        durationMs: performance.now() - started,
        error: getErrorMessage(error),
      })
      throw error
    }
  })
}

function context(projectId = 'project-a', limit = 1024): ProjectStorageBillingContext {
  return {
    projectId,
    ownerId: 'user-a',
    organizationId: 'organization-a',
    billedAccountUserId: 'user-a',
    billingEntity: { type: 'organization', id: 'organization-a' },
    plan: 'team',
    customStorageLimitGB: limit / 1024 ** 3,
  }
}

describe('Project storage admission, transfer, and reconciliation in PostgreSQL', () => {
  const schemaName = `project_storage_${generateId().replaceAll('-', '')}`
  let sql: Sql
  let admin: Sql
  let database: ReturnType<typeof drizzle<typeof schema>>

  async function waitForDatabaseLock(pid: number) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const [state] = await sql<{ waiting: boolean }[]>`SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity WHERE pid = ${pid} AND wait_event_type = 'Lock'
      ) AS waiting`
      if (state.waiting) return
      await sleep(10)
    }
    throw new Error('Concurrent billing operation did not wait for its ownership or payer lock')
  }

  beforeAll(async () => {
    admin = postgres(databaseUrl, { max: 1, onnotice: () => undefined })
    await admin.unsafe(`CREATE SCHEMA "${schemaName}"`)
    sql = postgres(databaseUrl, {
      max: 5,
      onnotice: () => undefined,
      connection: { search_path: schemaName },
    })
    database = drizzle(sql, { schema })
    await sql.unsafe(`
      CREATE TABLE organization (id text PRIMARY KEY, storage_used_bytes bigint NOT NULL DEFAULT 0);
      CREATE TABLE user_stats (id text PRIMARY KEY, user_id text UNIQUE NOT NULL, storage_used_bytes bigint NOT NULL DEFAULT 0);
      CREATE TABLE member (id text PRIMARY KEY, organization_id text NOT NULL, user_id text NOT NULL, role text NOT NULL);
      CREATE TABLE subscription (id text PRIMARY KEY, plan text NOT NULL, reference_id text NOT NULL,
        stripe_customer_id text, stripe_subscription_id text, status text, period_start timestamp,
        period_end timestamp, cancel_at_period_end boolean, cancel_at timestamp, canceled_at timestamp,
        ended_at timestamp, seats integer, trial_start timestamp, trial_end timestamp,
        billing_interval text, stripe_schedule_id text, metadata json, last_closed_period_start timestamp);
      CREATE TABLE project (id text PRIMARY KEY, owner_id text NOT NULL, organization_id text,
        name text NOT NULL DEFAULT 'Project', created_at timestamp NOT NULL DEFAULT now(),
        archived_at timestamp, updated_at timestamp NOT NULL DEFAULT now());
      CREATE TABLE workspace (id text PRIMARY KEY, billed_account_user_id text NOT NULL,
        owner_id text NOT NULL DEFAULT 'user-a', archived_at timestamp, updated_at timestamp DEFAULT now(),
        organization_id text, storage_used_bytes bigint NOT NULL DEFAULT 0);
      CREATE TABLE project_workspace (project_id text NOT NULL, workspace_id text UNIQUE NOT NULL,
        created_at timestamp NOT NULL DEFAULT now());
      CREATE TABLE permissions (id text PRIMARY KEY, user_id text NOT NULL, entity_type text NOT NULL,
        entity_id text NOT NULL, permission_type text NOT NULL);
      CREATE TABLE permission_group (id text PRIMARY KEY, organization_id text,
        config jsonb, updated_at timestamp);
      CREATE TABLE workspace_files (id text PRIMARY KEY, entity_type text, entity_id text,
        workspace_id text, context text NOT NULL, size_bytes bigint, deleted_at timestamp);
      CREATE TABLE workspace_file_version (id text PRIMARY KEY,
        file_id text REFERENCES workspace_files(id) ON DELETE CASCADE, size_bytes bigint NOT NULL);
      CREATE TABLE knowledge_base (id text PRIMARY KEY, workspace_id text);
      CREATE TABLE document (id text PRIMARY KEY, knowledge_base_id text, connector_id text,
        file_size bigint, deleted_at timestamp);
      CREATE TABLE knowledge_connector (id text PRIMARY KEY, knowledge_base_id text,
        detached_at timestamp, detach_reserved_bytes bigint);
    `)
  })

  beforeEach(async () => {
    vi.stubEnv('FREE_STORAGE_LIMIT_GB', '1')
    await sql`TRUNCATE workspace_file_version, workspace_files, project, workspace, organization, user_stats, member, subscription, project_workspace, permissions, permission_group`
    await sql`INSERT INTO organization (id) VALUES ('organization-a'), ('organization-b')`
    await sql`INSERT INTO user_stats (id, user_id) VALUES ('stats-a', 'user-a'), ('stats-b', 'user-b')`
    await sql`INSERT INTO project (id, owner_id, organization_id)
      VALUES ('project-a', 'user-a', 'organization-a'), ('project-b', 'user-a', 'organization-a')`
    await sql`INSERT INTO workspace (id, billed_account_user_id, organization_id)
      VALUES ('workspace-a', 'user-a', 'organization-a')`
  })

  afterAll(async () => {
    try {
      await sql?.end()
      await admin?.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
    } finally {
      await admin?.end()
      const reportPath = process.env.PROJECT_STORAGE_REPORT_PATH
      if (reportPath) {
        await mkdir(dirname(reportPath), { recursive: true })
        await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
      }
    }
  })

  check('resolves the canonical payer and its plan within the caller transaction', async () => {
    await database.transaction(async (tx) => {
      await tx.execute(query`INSERT INTO member (id, organization_id, user_id, role)
        VALUES ('member-a', 'organization-a', 'user-b', 'owner')`)
      await tx.execute(query`INSERT INTO subscription (id, plan, reference_id, status, metadata)
        VALUES ('org-sub', 'team_25000', 'organization-a', 'active', '{"customStorageLimitGB":2}'),
          ('personal-sub', 'pro_4000', 'user-a', 'active', NULL),
          ('unrelated-sub', 'enterprise', 'user-b', 'active', '{"customStorageLimitGB":100}')`)
      const organizationContext = await resolveProjectStorageBillingContext(
        { projectId: 'project-a', ownerId: 'user-a', organizationId: 'organization-a' },
        tx
      )
      expect(organizationContext).toMatchObject({
        billedAccountUserId: 'user-b',
        billingEntity: { type: 'organization', id: 'organization-a' },
        plan: 'team_25000',
        customStorageLimitGB: 2,
      })
      const prepared = await prepareProjectStorageMutationInTx(tx, organizationContext)
      await prepared.applyDelta(40)
      await tx.execute(query`UPDATE project SET organization_id = NULL WHERE id = 'project-b'`)
      const personalContext = await resolveProjectStorageBillingContext(
        { projectId: 'project-b', ownerId: 'user-a', organizationId: null },
        tx
      )
      expect(personalContext).toMatchObject({
        billedAccountUserId: 'user-a',
        billingEntity: { type: 'user', id: 'user-a' },
        plan: 'pro_4000',
        customStorageLimitGB: null,
      })
      const personalPrepared = await prepareProjectStorageMutationInTx(tx, personalContext)
      await personalPrepared.applyDelta(20)
    })
    const [organizationPayer] = await sql`SELECT storage_used_bytes::integer AS bytes
      FROM organization WHERE id = 'organization-a'`
    const [personalPayer] = await sql`SELECT storage_used_bytes::integer AS bytes
      FROM user_stats WHERE user_id = 'user-a'`
    expect(organizationPayer.bytes).toBe(40)
    expect(personalPayer.bytes).toBe(20)
  })

  check(
    'combines Project and workspace transfers before repairing an underfunded shared payer',
    async () => {
      await sql`UPDATE project SET organization_id = NULL WHERE id = 'project-a'`
      await sql`UPDATE workspace SET organization_id = NULL, billed_account_user_id = 'user-b',
      storage_used_bytes = 100 WHERE id = 'workspace-a'`
      await sql`UPDATE user_stats SET storage_used_bytes = 50 WHERE user_id = 'user-b'`
      await sql`INSERT INTO workspace_files (id, entity_type, entity_id, workspace_id, context, size_bytes)
      VALUES ('project-file', 'project', 'project-a', NULL, 'project', 40),
        ('workspace-file', 'workspace', 'workspace-a', 'workspace-a', 'workspace', 100)`
      await database.transaction((tx) =>
        changeProjectAndWorkspaceStoragePayersInTx(tx, {
          projectChanges: [
            {
              projectId: 'project-a',
              ownerId: 'user-b',
              organizationId: null,
              expectedCurrentOwner: { ownerId: 'user-a', organizationId: null },
            },
          ],
          workspaceChanges: [
            {
              workspaceId: 'workspace-a',
              billedAccountUserId: 'user-a',
              organizationId: null,
              expectedCurrentPayer: { billedAccountUserId: 'user-b', organizationId: null },
            },
          ],
        })
      )
      expect(
        await sql`SELECT user_id, storage_used_bytes::integer AS bytes FROM user_stats ORDER BY user_id`
      ).toEqual([
        { user_id: 'user-a', bytes: 100 },
        { user_id: 'user-b', bytes: 40 },
      ])
      expect((await sql`SELECT owner_id FROM project WHERE id = 'project-a'`)[0].owner_id).toBe(
        'user-b'
      )
      expect(
        (await sql`SELECT billed_account_user_id FROM workspace WHERE id = 'workspace-a'`)[0]
          .billed_account_user_id
      ).toBe('user-a')
    }
  )

  check(
    'Project environment transfer moves both ledgers once when personal owners differ',
    async () => {
      await sql`UPDATE project SET organization_id = NULL WHERE id = 'project-a'`
      await sql`UPDATE workspace SET organization_id = NULL, billed_account_user_id = 'user-b',
      storage_used_bytes = 20 WHERE id = 'workspace-a'`
      await sql`INSERT INTO project_workspace (project_id, workspace_id) VALUES ('project-a', 'workspace-a')`
      await sql`UPDATE user_stats SET storage_used_bytes = CASE user_id WHEN 'user-a' THEN 40 ELSE 20 END`
      await sql`INSERT INTO workspace_files (id, entity_type, entity_id, workspace_id, context, size_bytes)
      VALUES ('project-file', 'project', 'project-a', NULL, 'project', 40),
        ('workspace-file', 'workspace', 'workspace-a', 'workspace-a', 'workspace', 20)`
      await database.transaction((tx) =>
        transferWorkspaceProjects(tx, ['workspace-a'], 'organization-a', undefined, [
          {
            workspaceId: 'workspace-a',
            organizationId: 'organization-a',
            billedAccountUserId: 'user-b',
            expectedCurrentPayer: { organizationId: null, billedAccountUserId: 'user-b' },
          },
        ])
      )
      expect(
        await sql`SELECT user_id, storage_used_bytes::integer AS bytes FROM user_stats ORDER BY user_id`
      ).toEqual([
        { user_id: 'user-a', bytes: 0 },
        { user_id: 'user-b', bytes: 0 },
      ])
      expect(
        (
          await sql`SELECT storage_used_bytes::integer AS bytes FROM organization WHERE id = 'organization-a'`
        )[0].bytes
      ).toBe(60)
      expect(
        (await sql`SELECT organization_id FROM workspace WHERE id = 'workspace-a'`)[0]
          .organization_id
      ).toBe('organization-a')
    }
  )

  check(
    'account teardown waits for a Project write and transfers survivor ledgers as one batch',
    async () => {
      await sql`DELETE FROM project WHERE id = 'project-b'`
      await sql`UPDATE project SET organization_id = NULL WHERE id = 'project-a'`
      await sql`UPDATE workspace SET organization_id = NULL, storage_used_bytes = 20 WHERE id = 'workspace-a'`
      await sql`INSERT INTO project_workspace (project_id, workspace_id) VALUES ('project-a', 'workspace-a')`
      await sql`INSERT INTO permissions (id, user_id, entity_type, entity_id, permission_type)
      VALUES ('admin', 'user-b', 'workspace', 'workspace-a', 'admin')`
      await sql`UPDATE user_stats SET storage_used_bytes = 20 WHERE user_id = 'user-a'`
      await sql`INSERT INTO workspace_files (id, entity_type, entity_id, workspace_id, context, size_bytes)
        VALUES ('workspace-file', 'workspace', 'workspace-a', 'workspace-a', 'workspace', 20)`
      const written = createDeferred<void>()
      const releaseWrite = createDeferred<void>()
      const teardownPid = createDeferred<number>()
      const write = database.transaction(async (tx) => {
        const prepared = await prepareProjectStorageMutationInTx(tx, {
          ...context(),
          organizationId: null,
          billingEntity: { type: 'user', id: 'user-a' },
        })
        await tx.execute(query`INSERT INTO workspace_files (id, entity_type, entity_id, context, size_bytes)
          VALUES ('project-file', 'project', 'project-a', 'project', 40)`)
        await prepared.applyDelta(40)
        written.resolve()
        await releaseWrite.promise
      })
      await Promise.race([written.promise, write])
      const teardown = database.transaction(async (tx) => {
        const [connection] = await tx.execute<{ pid: number }>(
          query`SELECT pg_backend_pid() AS pid`
        )
        teardownPid.resolve(connection.pid)
        await prepareProjectsForAccountDeletion(tx, 'user-a', [])
      })
      try {
        await waitForDatabaseLock(await teardownPid.promise)
      } finally {
        releaseWrite.resolve()
      }
      await Promise.all([write, teardown])
      expect(
        await sql`SELECT user_id, storage_used_bytes::integer AS bytes FROM user_stats ORDER BY user_id`
      ).toEqual([
        { user_id: 'user-a', bytes: 0 },
        { user_id: 'user-b', bytes: 60 },
      ])
      expect((await sql`SELECT owner_id FROM project WHERE id = 'project-a'`)[0].owner_id).toBe(
        'user-b'
      )
      expect(
        (await sql`SELECT billed_account_user_id FROM workspace WHERE id = 'workspace-a'`)[0]
          .billed_account_user_id
      ).toBe('user-b')
    }
  )

  check(
    'two Projects and a workspace share one locked quota without committing rejected file rows',
    async () => {
      const workspaceContext: StorageBillingContext = {
        ...context('project-a', 60),
        workspaceId: 'workspace-a',
      }
      const attempts = await Promise.allSettled([
        ...['project-a', 'project-b'].map((projectId) =>
          database.transaction(async (tx) => {
            const prepared = await prepareProjectStorageMutationInTx(tx, context(projectId, 60))
            await tx.execute(query`INSERT INTO workspace_files (id, entity_type, entity_id, context, size_bytes)
          VALUES (${projectId}, 'project', ${projectId}, 'project', 40)`)
            await prepared.applyDelta(40)
          })
        ),
        database.transaction(async (tx) => {
          await tx.execute(query`INSERT INTO workspace_files (id, workspace_id, context, size_bytes)
          VALUES ('workspace-file', 'workspace-a', 'workspace', 40)`)
          await incrementStorageUsageForBillingContextInTx(tx, workspaceContext, 40)
        }),
      ])
      expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      for (const attempt of attempts) {
        if (attempt.status === 'rejected')
          expect(attempt.reason).toBeInstanceOf(StorageLimitExceededError)
      }
      const [payer] =
        await sql`SELECT storage_used_bytes::integer AS bytes FROM organization WHERE id = 'organization-a'`
      expect(payer.bytes).toBe(40)
      expect(await sql`SELECT id FROM workspace_files`).toHaveLength(1)
    }
  )

  check(
    'rejects stale owner snapshots and invalid deltas before a charge can survive',
    async () => {
      await sql`UPDATE project SET owner_id = 'user-b' WHERE id = 'project-a'`
      await expect(
        database.transaction((tx) => prepareProjectStorageMutationInTx(tx, context()))
      ).rejects.toThrow(/changed/)
      await sql`UPDATE project SET owner_id = 'user-a' WHERE id = 'project-a'`
      for (const delta of [
        Number.NaN,
        Number.POSITIVE_INFINITY,
        0.5,
        Number.MAX_SAFE_INTEGER + 1,
      ]) {
        await expect(
          database.transaction(async (tx) => {
            const prepared = await prepareProjectStorageMutationInTx(tx, context())
            await prepared.applyDelta(delta)
          })
        ).rejects.toThrow(/Invalid/)
      }
      await expect(
        database.transaction(async (tx) => {
          const prepared = await prepareProjectStorageMutationInTx(tx, context())
          await prepared.applyDelta(1)
          await prepared.applyDelta(1)
        })
      ).rejects.toThrow(/already/)
      const [payer] =
        await sql`SELECT storage_used_bytes::integer AS bytes FROM organization WHERE id = 'organization-a'`
      expect(payer.bytes).toBe(0)
    }
  )

  check(
    'keeps current-head deltas separate from retained history and rolls back failed finalization',
    async () => {
      await database.transaction(async (tx) => {
        const prepared = await prepareProjectStorageMutationInTx(tx, context())
        await tx.execute(
          query`INSERT INTO workspace_files VALUES ('file', 'project', 'project-a', NULL, 'project', 100, NULL)`
        )
        await tx.execute(query`INSERT INTO workspace_file_version VALUES ('version', 'file', 500)`)
        await prepared.applyDelta(100)
      })
      await database.transaction(async (tx) => {
        const prepared = await prepareProjectStorageMutationInTx(tx, context())
        await tx.execute(
          query`UPDATE workspace_files SET size_bytes = 40, deleted_at = now() WHERE id = 'file'`
        )
        await prepared.applyDelta(-60)
      })
      await expect(
        database.transaction(async (tx) => {
          const prepared = await prepareProjectStorageMutationInTx(tx, context())
          await prepared.applyDelta(10)
          throw new Error('finalization failed')
        })
      ).rejects.toThrow('finalization failed')
      const [payer] =
        await sql`SELECT storage_used_bytes::integer AS bytes FROM organization WHERE id = 'organization-a'`
      expect(payer.bytes).toBe(40)
      await database.transaction(async (tx) => {
        const prepared = await prepareProjectStorageMutationInTx(tx, context())
        await tx.execute(query`DELETE FROM workspace_files WHERE id = 'file'`)
        await prepared.applyDelta(-40)
      })
      expect(await sql`SELECT id FROM workspace_file_version`).toHaveLength(0)
      const [empty] =
        await sql`SELECT storage_used_bytes::integer AS bytes FROM organization WHERE id = 'organization-a'`
      expect(empty.bytes).toBe(0)
    }
  )

  check(
    'moves exact Project heads once across payers, including archived heads but excluding versions',
    async () => {
      await sql`INSERT INTO workspace_files VALUES
      ('active', 'project', 'project-a', NULL, 'project', 40, NULL),
      ('archived', 'project', 'project-a', NULL, 'project', 60, now()),
      ('other', 'project', 'project-b', NULL, 'project', 25, NULL)`
      await sql`INSERT INTO workspace_file_version VALUES ('version', 'active', 900)`
      await sql`UPDATE organization SET storage_used_bytes = 125 WHERE id = 'organization-a'`
      await database.transaction((tx) =>
        changeProjectStoragePayersInTx(tx, [
          {
            projectId: 'project-a',
            organizationId: null,
            ownerId: 'user-b',
            expectedCurrentOwner: { organizationId: 'organization-a', ownerId: 'user-a' },
          },
        ])
      )
      expect(
        await sql`SELECT owner_id, organization_id FROM project WHERE id = 'project-a'`
      ).toEqual([{ owner_id: 'user-b', organization_id: null }])
      expect(
        await sql`SELECT storage_used_bytes::integer AS bytes FROM organization WHERE id = 'organization-a'`
      ).toEqual([{ bytes: 25 }])
      expect(
        await sql`SELECT storage_used_bytes::integer AS bytes FROM user_stats WHERE user_id = 'user-b'`
      ).toEqual([{ bytes: 100 }])
      await expect(
        database.transaction((tx) =>
          changeProjectStoragePayersInTx(tx, [
            {
              projectId: 'project-a',
              organizationId: 'organization-b',
              ownerId: 'user-b',
              expectedCurrentOwner: { organizationId: 'organization-a', ownerId: 'user-a' },
            },
          ])
        )
      ).rejects.toThrow(/changed/)
    }
  )

  check(
    'reconciliation adds Project heads once and refuses incomplete canonical size metadata',
    async () => {
      await sql`INSERT INTO workspace_files VALUES
      ('workspace-file', 'workspace', 'workspace-a', 'workspace-a', 'workspace', 20, NULL),
      ('project-file', 'project', 'project-a', NULL, 'project', 40, NULL),
      ('archived', 'project', 'project-a', NULL, 'project', 60, now()),
      ('chat', NULL, NULL, 'workspace-a', 'mothership', 999, NULL)`
      await sql`INSERT INTO workspace_file_version VALUES ('version', 'project-file', 900)`
      const store = createPostgresStorageReconciliationStore(sql)
      await store.reconcileWorkspaces(['workspace-a'])
      await store.reconcileOrganization('organization-a')
      expect(
        await sql`SELECT storage_used_bytes::integer AS bytes FROM organization WHERE id = 'organization-a'`
      ).toEqual([{ bytes: 120 }])
      await sql`UPDATE workspace_files SET size_bytes = NULL WHERE id = 'project-file'`
      await expect(store.reconcileOrganization('organization-a')).rejects.toThrow(
        /invalid canonical size/
      )
      expect(
        await sql`SELECT storage_used_bytes::integer AS bytes FROM organization WHERE id = 'organization-a'`
      ).toEqual([{ bytes: 120 }])
    }
  )

  check('reconciliation waits for a Project write and keeps the committed charge', async () => {
    const changed = createDeferred<void>()
    const release = createDeferred<void>()
    const write = database.transaction(async (tx) => {
      const prepared = await prepareProjectStorageMutationInTx(tx, context())
      await tx.execute(
        query`INSERT INTO workspace_files VALUES ('file', 'project', 'project-a', NULL, 'project', 40, NULL)`
      )
      await prepared.applyDelta(40)
      changed.resolve()
      await release.promise
    })
    await Promise.race([changed.promise, write])
    const observer = postgres(databaseUrl, {
      max: 1,
      onnotice: () => undefined,
      connection: { search_path: schemaName },
    })
    let reconciliation: Promise<void> | undefined
    try {
      const [backend] = await observer<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
      reconciliation =
        createPostgresStorageReconciliationStore(observer).reconcileOrganization('organization-a')
      await waitForDatabaseLock(backend.pid)
    } finally {
      release.resolve()
      await write
      await reconciliation
      await observer.end()
    }
    expect(
      await sql`SELECT storage_used_bytes::integer AS bytes FROM organization WHERE id = 'organization-a'`
    ).toEqual([{ bytes: 40 }])
  })

  check(
    'a queued ownership transfer includes the Project write that committed ahead of it',
    async () => {
      const changed = createDeferred<void>()
      const release = createDeferred<void>()
      const write = database.transaction(async (tx) => {
        const prepared = await prepareProjectStorageMutationInTx(tx, context())
        await tx.execute(
          query`INSERT INTO workspace_files VALUES ('file', 'project', 'project-a', NULL, 'project', 40, NULL)`
        )
        await prepared.applyDelta(40)
        changed.resolve()
        await release.promise
      })
      await Promise.race([changed.promise, write])
      const waiting = createDeferred<number>()
      let transfer: Promise<unknown> | undefined
      try {
        transfer = database.transaction(async (tx) => {
          const [backend] = await tx.execute<{ pid: number }>(query`SELECT pg_backend_pid() AS pid`)
          waiting.resolve(backend.pid)
          return changeProjectStoragePayersInTx(tx, [
            {
              projectId: 'project-a',
              organizationId: null,
              ownerId: 'user-b',
              expectedCurrentOwner: { organizationId: 'organization-a', ownerId: 'user-a' },
            },
          ])
        })
        await waitForDatabaseLock(await waiting.promise)
      } finally {
        release.resolve()
        await write
        await transfer
      }
      const store = createPostgresStorageReconciliationStore(sql)
      await store.reconcileOrganization('organization-a')
      await store.reconcileUser('user-b')
      expect(
        await sql`SELECT storage_used_bytes::integer AS bytes FROM organization WHERE id = 'organization-a'`
      ).toEqual([{ bytes: 0 }])
      expect(
        await sql`SELECT storage_used_bytes::integer AS bytes FROM user_stats WHERE user_id = 'user-b'`
      ).toEqual([{ bytes: 40 }])
    }
  )
})
