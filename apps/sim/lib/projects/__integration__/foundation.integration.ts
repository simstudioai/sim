import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { db } from '@sim/db'
import {
  member,
  organization,
  permissionGroup,
  permissions,
  project,
  projectWorkspace,
  user,
  userStats,
  workflow,
  workflowBlocks,
  workspace,
  workspaceForkBlockMap,
  workspaceForkDependentValue,
  workspaceForkPromoteRun,
  workspaceForkResourceMap,
} from '@sim/db/schema'
import {
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { getErrorMessage, getPostgresErrorCode } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import postgres from 'postgres'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { removeUserFromOrganization } from '@/lib/billing/organizations/membership'
import { prepareProjectsForAccountDeletion } from '@/lib/projects/account-deletion'
import {
  archiveProject,
  createProject,
  getProject,
  getProjectIssueAccess,
  getWorkspaceProject,
  listProjects,
  renameProject,
} from '@/lib/projects/application'
import { archiveProjectInTransaction } from '@/lib/projects/lifecycle'
import {
  createProjectForWorkspace,
  lockProject,
  lockWorkspaceProject,
  splitForkProject,
  transferWorkspaceProjects,
} from '@/lib/projects/membership'
import { getAccountDeletionPlan } from '@/lib/users/account-deletion'
import { disableUserResources, restoreWorkflow } from '@/lib/workflows/lifecycle'
import { buildNewWorkflowRow } from '@/lib/workflows/persistence/new-workflow-row'
import { createWorkspaceInTransaction } from '@/lib/workspaces/create'
import { archiveWorkspace } from '@/lib/workspaces/lifecycle'
import { detachOrganizationWorkspacesTx } from '@/lib/workspaces/organization-workspaces'
import { getWorkspaceWithOwner } from '@/lib/workspaces/permissions/utils'
import { getWorkspaceCreationPolicy } from '@/lib/workspaces/policy'
import { POST as importAdminWorkflow } from '@/app/api/v1/admin/workflows/import/route'
import { createFork } from '@/ee/workspace-forking/lib/create-fork'
import { unlinkForkEdge } from '@/ee/workspace-forking/lib/lineage/unlink'

const isolated = await vi.hoisted(async () => {
  process.env.ADMIN_API_KEY = 'project-fixture-admin-key'
  const { execFileSync } = await import('node:child_process')
  const { fileURLToPath } = await import('node:url')
  const { readTestDatabaseUrl } = await import('@sim/db/testing/test-infrastructure')
  const { generateId } = await import('@sim/utils/id')
  const { default: postgres } = await import('postgres')
  const admin = postgres(readTestDatabaseUrl(), { max: 1 })
  const name = `project_foundation_test_${generateId().replaceAll('-', '')}`
  const url = new URL(readTestDatabaseUrl())
  url.pathname = `/${name}`
  const databaseUrl = url.toString()
  await admin.unsafe(`CREATE DATABASE "${name}"`)
  const client = postgres(databaseUrl, { max: 1, onnotice: () => undefined })
  try {
    await client.unsafe(
      'CREATE EXTENSION vector; CREATE EXTENSION btree_gin; CREATE EXTENSION pg_trgm'
    )
    execFileSync('bun', ['--no-env-file', 'scripts/migrate.ts'], {
      cwd: fileURLToPath(new URL('../../../../../packages/db/', import.meta.url)),
      env: { ...process.env, DATABASE_URL: databaseUrl, MIGRATION_DATABASE_URL: databaseUrl },
      stdio: 'pipe',
      timeout: 120_000,
    })
    process.env.DATABASE_URL = databaseUrl
    return { admin, name, databaseUrl, client }
  } catch (error) {
    await client.end()
    await admin.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`)
    await admin.end()
    throw error
  }
})

beforeEach(async () => {
  vi.stubEnv('PROJECT_API_ENABLED', 'true')
  const rows = await db.execute(sql`SELECT 1 FROM pg_trigger
    WHERE tgname = 'project_contract_check' AND tgrelid IN ('project'::regclass, 'workspace'::regclass, 'project_workspace'::regclass)`)
  expect(rows).toHaveLength(3)
})

async function enforce() {
  const client = postgres(isolated.databaseUrl, { max: 1, onnotice: () => undefined })
  try {
    const migration = await readFile(
      new URL(
        '../../../../../packages/db/migrations/0395_project_membership_enforcement.sql',
        import.meta.url
      ),
      'utf8'
    )
    for (const statement of migration.split('--> statement-breakpoint'))
      await client.unsafe(statement)
  } finally {
    await client.end()
  }
}

const request = { requestId: 'project-foundation-integration', headers: new Headers() }
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []

/** Exercises durable auth and lifecycle invariants against real Postgres, including concurrent writers. */
function check(name: string, run: () => Promise<void>, legacy = false) {
  it(name, async () => {
    const started = performance.now()
    try {
      if (legacy) {
        try {
          for (const table of ['project', 'project_workspace', 'workspace']) {
            await isolated.client.unsafe(
              `DROP TRIGGER project_contract_lock ON ${table}; DROP TRIGGER project_contract_check ON ${table}`
            )
          }
          await run()
        } finally {
          await enforce()
        }
      } else {
        await run()
      }
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

async function fixture(org = true, count = 2) {
  const ownerId = generateId()
  const teammateId = generateId()
  const outsiderId = generateId()
  const now = new Date()
  for (const id of [ownerId, teammateId, outsiderId]) {
    await db.insert(user).values({
      id,
      email: `${id}@projects.invalid`,
      name: 'Project fixture',
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
  }
  await db
    .insert(userStats)
    .values([ownerId, teammateId, outsiderId].map((userId) => ({ id: generateId(), userId })))
  const organizationId = org ? generateId() : null
  if (organizationId) {
    await db
      .insert(organization)
      .values({ id: organizationId, name: 'Project fixture', slug: organizationId, createdAt: now })
    await db
      .insert(member)
      .values({ id: generateId(), organizationId, userId: ownerId, role: 'owner', createdAt: now })
  }
  const ids = Array.from({ length: count }, () => generateId())
  let projectId = ''
  await db.transaction(async (tx) => {
    for (const [index, id] of ids.entries()) {
      await tx.insert(workspace).values({
        id,
        name: `Environment ${index}`,
        ownerId,
        billedAccountUserId: ownerId,
        organizationId,
        workspaceMode: organizationId ? 'organization' : 'grandfathered_shared',
        forkedFromWorkspaceId: index ? ids[index - 1] : null,
      })
      await tx.insert(permissions).values({
        id: generateId(),
        entityType: 'workspace',
        entityId: id,
        userId: ownerId,
        permissionType: 'admin',
      })
      if (!index)
        projectId = await createProjectForWorkspace(tx, {
          workspaceId: id,
          name: 'Environment 0',
          organizationId,
          ownerId,
        })
      else await tx.insert(projectWorkspace).values({ projectId, workspaceId: id })
    }
  })
  const owner = createSessionPrincipal({ userId: ownerId })
  const teammate = createSessionPrincipal({ userId: teammateId })
  await db.insert(permissions).values({
    id: generateId(),
    entityType: 'workspace',
    entityId: ids[0],
    userId: teammateId,
    permissionType: 'admin',
  })
  return { ownerId, teammateId, outsiderId, organizationId, projectId, ids, owner, teammate }
}

async function addWorkflow(workspaceId: string, userId: string) {
  const id = generateId()
  const now = new Date()
  await db.insert(workflow).values({
    id,
    workspaceId,
    userId,
    name: 'Scheduled work',
    createdAt: now,
    updatedAt: now,
    lastSynced: now,
    isDeployed: true,
    isPublicApi: true,
  })
  return id
}

afterAll(async () => {
  try {
    const reportPath =
      process.env.PROJECT_FOUNDATION_REPORT_PATH ?? resolve('test-results/project-foundation.json')
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
  } finally {
    await db.$client.end({ timeout: 2 })
    await isolated.client.end()
    try {
      await isolated.admin.unsafe(`DROP DATABASE "${isolated.name}" WITH (FORCE)`)
    } finally {
      await isolated.admin.end()
    }
  }
})

describe('Project foundation at the database and application boundary', () => {
  check(
    'application creation, disconnect, organization deletion and archive commit with SQL enforcement',
    async () => {
      const f = await fixture(true, 1)
      const organizationId = f.organizationId
      if (!organizationId) throw new Error('Missing organization fixture')
      const created = await createProject.execute({
        principal: f.owner,
        input: {
          organizationId: f.organizationId,
          name: 'Enforced',
          initialEnvironment: { name: 'Production' },
        },
        request,
      })

      const source = await getWorkspaceWithOwner(created.initialEnvironment.id)
      if (!source) throw new Error('Missing source environment')
      const fork = await createFork({
        source,
        policy: await getWorkspaceCreationPolicy({ userId: f.ownerId }),
        userId: f.ownerId,
        name: 'Staging',
      })

      await unlinkForkEdge({ parentWorkspaceId: source.id, childWorkspaceId: fork.workspace.id })
      const [detached] = await db
        .select()
        .from(projectWorkspace)
        .where(eq(projectWorkspace.workspaceId, fork.workspace.id))
      expect(detached.projectId).not.toBe(created.project.id)
      await db.transaction(async (tx) => {
        await detachOrganizationWorkspacesTx(tx, organizationId)
        await tx.delete(organization).where(eq(organization.id, organizationId))
      })
      await archiveProject.execute({
        principal: f.owner,
        input: { projectId: created.project.id },
        request,
      })
      const [archived] = await db.select().from(project).where(eq(project.id, created.project.id))
      expect(archived.organizationId).toBeNull()
      expect(archived.archivedAt).not.toBeNull()
      expect(
        await db
          .select()
          .from(workflow)
          .where(and(eq(workflow.workspaceId, source.id), sql`${workflow.archivedAt} IS NULL`))
      ).toHaveLength(0)
    }
  )

  check(
    'workspace creation and fork/disconnect assign Projects while APIs remain disabled',
    async () => {
      vi.stubEnv('PROJECT_API_ENABLED', 'false')
      const f = await fixture(false, 1)
      const source = await db.transaction((tx) =>
        createWorkspaceInTransaction(tx, {
          userId: f.ownerId,
          name: 'Legacy source',
          organizationId: null,
          observedOrganizationId: null,
          governingPermissionGroupOrganizationId: null,
          workspaceMode: 'personal',
          billedAccountUserId: f.ownerId,
          skipDefaultWorkflow: true,
        })
      )

      expect(
        await db.select().from(projectWorkspace).where(eq(projectWorkspace.workspaceId, source.id))
      ).toHaveLength(1)
      const parent = await getWorkspaceWithOwner(source.id)
      if (!parent) throw new Error('Missing source fixture')
      const fork = await createFork({
        source: parent,
        policy: await getWorkspaceCreationPolicy({ userId: f.ownerId }),
        userId: f.ownerId,
        name: 'Legacy child',
      })

      expect(
        await db
          .select()
          .from(projectWorkspace)
          .where(eq(projectWorkspace.workspaceId, fork.workspace.id))
      ).toHaveLength(1)
      await unlinkForkEdge({ parentWorkspaceId: source.id, childWorkspaceId: fork.workspace.id })
      const [child] = await db.select().from(workspace).where(eq(workspace.id, fork.workspace.id))
      expect(child.forkedFromWorkspaceId).toBeNull()
      expect(await db.select().from(project).where(eq(project.ownerId, f.ownerId))).toHaveLength(3)
    }
  )

  check(
    'Project operations remain unavailable until API activation with no partial creation',
    async () => {
      const f = await fixture(false, 1)
      vi.stubEnv('PROJECT_API_ENABLED', 'false')
      const input = { projectId: f.projectId }
      const calls = [
        () =>
          createProject.execute({
            principal: f.owner,
            input: {
              organizationId: null,
              name: 'Blocked',
              initialEnvironment: { name: 'Production' },
            },
            request,
          }),
        () => getProject.execute({ principal: f.owner, input, request }),
        () =>
          getWorkspaceProject.execute({
            principal: f.owner,
            input: { workspaceId: f.ids[0] },
            request,
          }),
        () => listProjects.execute({ principal: f.owner, input: { limit: 10 }, request }),
        () =>
          renameProject.execute({
            principal: f.owner,
            input: { ...input, name: 'Blocked' },
            request,
          }),
        () => archiveProject.execute({ principal: f.owner, input, request }),
        () => getProjectIssueAccess.execute({ principal: f.owner, input, request }),
      ]
      for (const call of calls) await expect(call()).rejects.toMatchObject({ statusCode: 503 })
      expect(
        await db.select().from(workspace).where(eq(workspace.ownerId, f.ownerId))
      ).toHaveLength(1)
      const [record] = await db.select().from(project).where(eq(project.id, f.projectId))
      expect(record.name).toBe('Environment 0 - Project')
      expect(record.archivedAt).toBeNull()
    }
  )

  check(
    'disabling activation preserves assigned fork membership and lifecycle protections',
    async () => {
      const f = await fixture(false, 1)
      vi.stubEnv('PROJECT_API_ENABLED', 'false')
      const parent = await getWorkspaceWithOwner(f.ids[0])
      if (!parent) throw new Error('Missing source fixture')
      const fork = await createFork({
        source: parent,
        policy: await getWorkspaceCreationPolicy({ userId: f.ownerId }),
        userId: f.ownerId,
        name: 'Assigned child',
      })

      const [membership] = await db
        .select()
        .from(projectWorkspace)
        .where(eq(projectWorkspace.workspaceId, fork.workspace.id))
      expect(membership.projectId).toBe(f.projectId)
      await unlinkForkEdge({ parentWorkspaceId: f.ids[0], childWorkspaceId: fork.workspace.id })
      const [detached] = await db
        .select()
        .from(projectWorkspace)
        .where(eq(projectWorkspace.workspaceId, fork.workspace.id))
      expect(detached.projectId).not.toBe(f.projectId)
      await expect(
        archiveWorkspace(fork.workspace.id, { requestId: 'disabled-project-rollout' })
      ).rejects.toMatchObject({ code: 'conflict' })
    }
  )

  check('new workspaces receive Projects while Project APIs remain disabled', async () => {
    vi.stubEnv('PROJECT_API_ENABLED', 'false')
    const f = await fixture(false, 1)
    const created = await db.transaction((tx) =>
      createWorkspaceInTransaction(tx, {
        userId: f.ownerId,
        name: 'Writer activation',
        organizationId: null,
        observedOrganizationId: null,
        governingPermissionGroupOrganizationId: null,
        workspaceMode: 'personal',
        billedAccountUserId: f.ownerId,
        skipDefaultWorkflow: true,
      })
    )

    expect(
      await db.select().from(projectWorkspace).where(eq(projectWorkspace.workspaceId, created.id))
    ).toHaveLength(1)
  })

  check(
    'legacy fork and disconnect refuse a partially assigned subtree',
    async () => {
      const f = await fixture(false, 3)
      await db
        .delete(projectWorkspace)
        .where(inArray(projectWorkspace.workspaceId, f.ids.slice(0, 2)))
      vi.stubEnv('PROJECT_API_ENABLED', 'false')
      const parent = await getWorkspaceWithOwner(f.ids[1])
      if (!parent) throw new Error('Missing source fixture')
      await expect(
        createFork({
          source: parent,
          policy: await getWorkspaceCreationPolicy({ userId: f.ownerId }),
          userId: f.ownerId,
          name: 'Invalid child',
        })
      ).rejects.toMatchObject({ code: 'conflict' })
      await expect(
        unlinkForkEdge({ parentWorkspaceId: f.ids[0], childWorkspaceId: f.ids[1] })
      ).rejects.toMatchObject({ code: 'conflict' })
      const [child] = await db.select().from(workspace).where(eq(workspace.id, f.ids[1]))
      expect(child.forkedFromWorkspaceId).toBe(f.ids[0])
      expect(
        await db.select().from(workspace).where(eq(workspace.ownerId, f.ownerId))
      ).toHaveLength(3)
    },
    true
  )

  check(
    'legacy membership decisions exclude backfill until the writing transaction commits',
    async () => {
      const f = await fixture(false, 1)
      await db.delete(projectWorkspace).where(eq(projectWorkspace.workspaceId, f.ids[0]))
      await db.delete(project).where(eq(project.id, f.projectId))
      const read = createDeferred<void>()
      const release = createDeferred<void>()
      const writer = db.transaction(async (tx) => {
        expect(await lockWorkspaceProject(tx, f.ids[0])).toBeNull()
        read.resolve()
        await release.promise
        await tx
          .update(workspace)
          .set({ name: 'Concurrent legacy edit' })
          .where(eq(workspace.id, f.ids[0]))
      })
      try {
        await Promise.race([read.promise, writer])
        await db.transaction(async (tx) => {
          const [lock] = await tx.execute<{ acquired: boolean }>(sql`
            SELECT pg_try_advisory_xact_lock(hashtextextended(${`project-backfill:${f.ids[0]}`}, 0)) AS acquired
          `)
          expect(lock.acquired).toBe(false)
          const [unrelated] = await tx.execute<{ acquired: boolean }>(sql`
            SELECT pg_try_advisory_xact_lock(hashtextextended('project-backfill:unrelated', 0)) AS acquired
          `)
          expect(unrelated.acquired).toBe(true)
        })
      } finally {
        release.resolve()
        await writer
      }
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`project-backfill:${f.ids[0]}`}, 0))`
        )
        await createProjectForWorkspace(tx, {
          workspaceId: f.ids[0],
          name: 'Concurrent legacy edit',
          organizationId: null,
          ownerId: f.ownerId,
        })
      })
      expect(
        await db.select().from(projectWorkspace).where(eq(projectWorkspace.workspaceId, f.ids[0]))
      ).toHaveLength(1)
    },
    true
  )

  check(
    'a fork waiting for backfill inherits membership committed before it resumes',
    async () => {
      const f = await fixture(false, 1)
      await db.delete(projectWorkspace).where(eq(projectWorkspace.workspaceId, f.ids[0]))
      await db.delete(project).where(eq(project.id, f.projectId))
      const parent = await getWorkspaceWithOwner(f.ids[0])
      if (!parent) throw new Error('Missing source fixture')
      const policy = await getWorkspaceCreationPolicy({ userId: f.ownerId })
      const locked = createDeferred<void>()
      const release = createDeferred<void>()
      const backfill = db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`project-backfill:${f.ids[0]}`}, 0))`
        )
        locked.resolve()
        await release.promise
        return createProjectForWorkspace(tx, {
          workspaceId: f.ids[0],
          name: 'Backfilled source',
          organizationId: null,
          ownerId: f.ownerId,
        })
      })
      await Promise.race([locked.promise, backfill])
      const fork = createFork({
        source: parent,
        policy,
        userId: f.ownerId,
        name: 'Concurrent child',
      })
      let blocked = false
      try {
        for (let attempt = 0; attempt < 100; attempt++) {
          const rows = await db.execute<{ waiting: boolean }>(sql`SELECT EXISTS (
          SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND mode = 'ShareLock' AND NOT granted
        ) AS waiting`)
          if (rows[0]?.waiting) {
            blocked = true
            break
          }
          await sleep(20)
        }
      } finally {
        release.resolve()
      }
      const [projectId, result] = await Promise.all([backfill, fork])
      expect(blocked).toBe(true)
      const [membership] = await db
        .select()
        .from(projectWorkspace)
        .where(eq(projectWorkspace.workspaceId, result.workspace.id))
      expect(membership.projectId).toBe(projectId)
    },
    true
  )

  check(
    'Project creation commits its named first environment and starter workflow in the requested scope',
    async () => {
      for (const personal of [false, true]) {
        const f = await fixture(true, 1)
        const organizationId = personal ? null : f.organizationId
        if (!f.organizationId) throw new Error('Missing organization fixture')
        await db.insert(member).values({
          id: generateId(),
          organizationId: f.organizationId,
          userId: f.teammateId,
          role: 'admin',
          createdAt: new Date(),
        })
        const result = await createProject.execute({
          principal: f.teammate,
          input: {
            organizationId,
            name: 'Customer support',
            initialEnvironment: { name: 'Production' },
          },
          request,
        })

        const [created] = await db.select().from(project).where(eq(project.id, result.project.id))
        expect(created).toMatchObject({
          name: 'Customer support',
          organizationId,
          ownerId: f.teammateId,
        })
        const [env] = await db
          .select()
          .from(workspace)
          .where(eq(workspace.id, result.initialEnvironment.id))
        expect(env).toMatchObject({
          name: 'Production',
          organizationId,
          ownerId: f.teammateId,
          billedAccountUserId: personal ? f.teammateId : f.ownerId,
        })
        expect(
          await db
            .select({
              projectId: projectWorkspace.projectId,
              workspaceId: projectWorkspace.workspaceId,
            })
            .from(projectWorkspace)
            .where(eq(projectWorkspace.projectId, created.id))
        ).toEqual([{ projectId: created.id, workspaceId: env.id }])
        const grants = await db.select().from(permissions).where(eq(permissions.entityId, env.id))
        expect(
          grants.map((grant) => ({ userId: grant.userId, permissionType: grant.permissionType }))
        ).toEqual(
          expect.arrayContaining([
            { userId: f.teammateId, permissionType: 'admin' },
            ...(personal ? [] : [{ userId: f.ownerId, permissionType: 'admin' }]),
          ])
        )
        expect(grants).toHaveLength(personal ? 1 : 2)
        const workflows = await db.select().from(workflow).where(eq(workflow.workspaceId, env.id))
        expect(workflows).toHaveLength(1)
        const blocks = await db
          .select()
          .from(workflowBlocks)
          .where(eq(workflowBlocks.workflowId, workflows[0].id))
        expect(blocks.length).toBeGreaterThan(0)
      }
    }
  )

  check(
    'Project creation refuses workspace keys and foreign organizations without creating resources',
    async () => {
      const f = await fixture(true, 1)
      const foreign = await fixture(true, 1)
      const input = {
        organizationId: foreign.organizationId,
        name: 'Forbidden project',
        initialEnvironment: { name: 'Production' },
      }
      await expect(
        createProject.execute({ principal: f.owner, input, request })
      ).rejects.toMatchObject({ code: 'forbidden' })
      await expect(
        createProject.execute({
          principal: createWorkspaceApiKeyPrincipal({ workspaceId: f.ids[0] }),
          input: { ...input, organizationId: f.organizationId },
          request,
        })
      ).rejects.toThrow('cannot perform operation')
      expect(await db.select().from(project).where(eq(project.ownerId, f.ownerId))).toHaveLength(1)
      expect(
        await db.select().from(workspace).where(eq(workspace.ownerId, f.ownerId))
      ).toHaveLength(1)
    }
  )

  check(
    'Project creation cannot bypass the workspace-creation restriction through personal scope',
    async () => {
      const f = await fixture(true, 1)
      if (!f.organizationId) throw new Error('Missing organization fixture')
      await db.insert(permissionGroup).values({
        id: generateId(),
        organizationId: f.organizationId,
        name: 'Creation disabled',
        createdBy: f.ownerId,
        isDefault: true,
        config: { disableWorkspaceCreation: true },
      })
      for (const organizationId of [f.organizationId, null]) {
        await expect(
          createProject.execute({
            principal: f.owner,
            input: {
              organizationId,
              name: 'Forbidden project',
              initialEnvironment: { name: 'Production' },
            },
            request,
          })
        ).rejects.toMatchObject({ detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED' })
      }
      expect(await db.select().from(project).where(eq(project.ownerId, f.ownerId))).toHaveLength(1)
      expect(
        await db.select().from(workspace).where(eq(workspace.ownerId, f.ownerId))
      ).toHaveLength(1)
    }
  )

  check(
    'A starter-workflow failure rolls back the Project, environment and permissions together',
    async () => {
      const f = await fixture(false, 1)
      const constraint = sql.identifier(`project_create_test_${generateId().replaceAll('-', '')}`)
      const before = await db.select().from(permissions).where(eq(permissions.userId, f.ownerId))
      await db.execute(
        sql`ALTER TABLE ${workflow} ADD CONSTRAINT ${constraint} CHECK (${workflow.userId} <> ${f.ownerId}) NOT VALID`.inlineParams()
      )
      try {
        await expect(
          createProject.execute({
            principal: f.owner,
            input: {
              organizationId: null,
              name: 'Rollback project',
              initialEnvironment: { name: 'Rollback environment' },
            },
            request,
          })
        ).rejects.toSatisfy((error: unknown) => getPostgresErrorCode(error) === '23514')
        expect(await db.select().from(project).where(eq(project.ownerId, f.ownerId))).toHaveLength(
          1
        )
        expect(
          await db.select().from(workspace).where(eq(workspace.ownerId, f.ownerId))
        ).toHaveLength(1)
        expect(
          await db.select().from(permissions).where(eq(permissions.userId, f.ownerId))
        ).toEqual(before)
      } finally {
        await db.execute(sql`ALTER TABLE ${workflow} DROP CONSTRAINT ${constraint}`)
      }
    }
  )

  check('workspace creation and forks commit exactly one Project membership', async () => {
    const f = await fixture(false, 1)
    const source = await db.transaction((tx) =>
      createWorkspaceInTransaction(tx, {
        userId: f.ownerId,
        name: 'New environment',
        organizationId: null,
        observedOrganizationId: null,
        governingPermissionGroupOrganizationId: null,
        workspaceMode: 'personal',
        billedAccountUserId: f.ownerId,
        skipDefaultWorkflow: true,
      })
    )

    const before = await db
      .select()
      .from(projectWorkspace)
      .where(eq(projectWorkspace.workspaceId, source.id))
    expect(before).toHaveLength(1)
    const policy = await getWorkspaceCreationPolicy({ userId: f.ownerId })
    const parent = await getWorkspaceWithOwner(source.id)
    if (!parent) throw new Error('Missing source fixture')
    const fork = await createFork({
      source: parent,
      policy,
      userId: f.ownerId,
      name: 'Child environment',
    })

    const child = await db
      .select()
      .from(projectWorkspace)
      .where(eq(projectWorkspace.workspaceId, fork.workspace.id))
    expect(child).toHaveLength(1)
    expect(child[0].projectId).toBe(before[0].projectId)
  })

  check(
    'a departing organization member transfers Project lifecycle ownership to the org owner',
    async () => {
      const f = await fixture()
      const organizationId = f.organizationId
      if (!organizationId) throw new Error('Missing organization fixture')
      const memberId = generateId()
      await db.insert(member).values({
        id: memberId,
        organizationId: organizationId,
        userId: f.teammateId,
        role: 'member',
        createdAt: new Date(),
      })
      await db.update(project).set({ ownerId: f.teammateId }).where(eq(project.id, f.projectId))
      const result = await removeUserFromOrganization({
        userId: f.teammateId,
        organizationId: organizationId,
        memberId,
        actorUserId: f.ownerId,
        skipBillingLogic: true,
        onError: 'throw',
      })
      expect(result.success).toBe(true)
      const [record] = await db.select().from(project).where(eq(project.id, f.projectId))
      expect(record.ownerId).toBe(f.ownerId)
      expect(record.organizationId).toBe(f.organizationId)
    }
  )

  check(
    'hides inaccessible environments and denies mismatched scopes and workspace keys',
    async () => {
      const f = await fixture()
      const input = { projectId: f.projectId }
      const result = await getProject.execute({ principal: f.teammate, input, request })
      expect(result.project.environments.map((row) => row.id)).toEqual([f.ids[0]])
      expect(result.project.capabilities).toEqual({ administer: false, issues: true })
      await expect(
        getWorkspaceProject.execute({
          principal: f.teammate,
          input: { workspaceId: f.ids[1] },
          request,
        })
      ).rejects.toMatchObject({ code: 'not_found' })
      await expect(
        getProject.execute({
          principal: f.teammate,
          input: { ...input, organizationId: generateId() },
          request,
        })
      ).rejects.toMatchObject({ code: 'not_found' })
      await expect(
        getProject.execute({
          principal: createSessionPrincipal({ userId: f.outsiderId }),
          input,
          request,
        })
      ).rejects.toMatchObject({ code: 'not_found' })
      await expect(
        getProject.execute({
          principal: createWorkspaceApiKeyPrincipal({ workspaceId: f.ids[0] }),
          input,
          request,
        })
      ).rejects.toThrow()
      await expect(
        renameProject.execute({
          principal: f.teammate,
          input: { ...input, name: 'Renamed' },
          request,
        })
      ).rejects.toMatchObject({ code: 'forbidden' })
      const list = await listProjects.execute({
        principal: f.teammate,
        input: { limit: 1 },
        request,
      })
      expect(list.projects.map((row) => row.id)).toEqual([f.projectId])
    }
  )

  check(
    'Issues restriction applies only to partial access and excludes archived environments',
    async () => {
      const f = await fixture()
      const organizationId = f.organizationId
      if (!organizationId) throw new Error('Missing organization fixture')
      const args = { principal: f.teammate, input: { projectId: f.projectId }, request }
      await expect(getProjectIssueAccess.execute(args)).resolves.toEqual({ projectId: f.projectId })
      await db.insert(permissionGroup).values({
        id: generateId(),
        organizationId: organizationId,
        name: 'Default restrictions',
        createdBy: f.ownerId,
        isDefault: true,
        config: { deniedPartialAccessProjectIssues: [f.projectId] },
      })
      await expect(getProjectIssueAccess.execute(args)).rejects.toMatchObject({
        detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
      })
      await db.insert(permissions).values({
        id: generateId(),
        userId: f.teammateId,
        entityType: 'workspace',
        entityId: f.ids[1],
        permissionType: 'read',
      })
      await expect(getProjectIssueAccess.execute(args)).resolves.toEqual({ projectId: f.projectId })
      await db
        .delete(permissions)
        .where(and(eq(permissions.userId, f.teammateId), eq(permissions.entityId, f.ids[1])))
      await archiveWorkspace(f.ids[1], request)
      await expect(getProjectIssueAccess.execute(args)).resolves.toEqual({ projectId: f.projectId })
      await expect(
        renameProject.execute({
          ...args,
          input: { ...args.input, name: 'Still requires all admins' },
        })
      ).rejects.toMatchObject({ code: 'forbidden' })
    }
  )

  check(
    'personal ownership does not substitute for access; admins of every environment may rename',
    async () => {
      const f = await fixture(false)
      await db.insert(permissions).values({
        id: generateId(),
        userId: f.teammateId,
        entityType: 'workspace',
        entityId: f.ids[1],
        permissionType: 'admin',
      })
      await expect(
        renameProject.execute({
          principal: f.teammate,
          input: { projectId: f.projectId, name: 'Personal project' },
          request,
        })
      ).resolves.toEqual({ id: f.projectId, name: 'Personal project' })
      await db.delete(permissions).where(eq(permissions.userId, f.ownerId))
      await expect(
        getProject.execute({ principal: f.owner, input: { projectId: f.projectId }, request })
      ).rejects.toMatchObject({ code: 'not_found' })
    }
  )

  check('concurrent individual removals preserve the last active environment', async () => {
    const f = await fixture(false)
    const results = await Promise.allSettled(f.ids.map((id) => archiveWorkspace(id, request)))
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    const rows = await db.select().from(workspace).where(inArray(workspace.id, f.ids))
    expect(rows.filter((row) => !row.archivedAt)).toHaveLength(1)
  })

  check(
    'retrying an environment archive repairs previously unarchived child workflows',
    async () => {
      const f = await fixture(false)
      await archiveWorkspace(f.ids[1], request)
      const workflowId = await addWorkflow(f.ids[1], f.ownerId)
      expect(await archiveWorkspace(f.ids[1], request)).toMatchObject({ archived: false })
      const [row] = await db.select().from(workflow).where(eq(workflow.id, workflowId))
      expect(row.archivedAt).not.toBeNull()
      expect(row.isDeployed).toBe(false)
      expect(row.isPublicApi).toBe(false)
    }
  )

  check(
    'admin import returns not found when a concurrent archive wins the workspace lock',
    async () => {
      const f = await fixture(false, 1)
      const held = createDeferred<number>()
      const release = createDeferred<void>()
      const archive = db.transaction(async (tx) => {
        const [connection] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
        await archiveProjectInTransaction(tx, f.projectId)
        held.resolve(connection.pid)
        await release.promise
      })
      const blocker = await held.promise
      const imported = importAdminWorkflow(
        new NextRequest('http://localhost:3000/api/v1/admin/workflows/import', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-admin-key': 'project-fixture-admin-key',
          },
          body: JSON.stringify({
            workspaceId: f.ids[0],
            workflow: { blocks: {}, edges: [], loops: {}, parallels: {} },
          }),
        }),
        {}
      )
      try {
        let waiting = false
        for (let attempt = 0; attempt < 100; attempt++) {
          const rows = await db.execute(
            sql`SELECT 1 FROM pg_stat_activity WHERE ${blocker} = ANY(pg_blocking_pids(pid))`
          )
          if (rows.length) {
            waiting = true
            break
          }
          await sleep(10)
        }
        expect(waiting).toBe(true)
      } finally {
        release.resolve()
        await archive
      }
      expect((await imported).status).toBe(404)
      expect(await db.select().from(workflow).where(eq(workflow.workspaceId, f.ids[0]))).toEqual([])
    }
  )

  check('workflow restore cannot overtake a concurrent Project archive', async () => {
    const f = await fixture()
    const workflowId = await addWorkflow(f.ids[0], f.ownerId)
    await db.update(workflow).set({ archivedAt: new Date() }).where(eq(workflow.id, workflowId))
    const held = createDeferred<number>()
    const release = createDeferred<void>()
    const archive = db.transaction(async (tx) => {
      const [connection] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
      await tx.select().from(workflow).where(eq(workflow.id, workflowId)).for('update')
      await archiveProjectInTransaction(tx, f.projectId)
      held.resolve(connection.pid)
      await release.promise
    })
    const blocker = await held.promise
    const restore = restoreWorkflow(workflowId, request).then(
      (result) => result,
      (error: unknown) => error
    )
    try {
      let waiting = false
      for (let attempt = 0; attempt < 100; attempt++) {
        const rows = await db.execute(sql`
          SELECT 1 FROM pg_stat_activity WHERE ${blocker} = ANY(pg_blocking_pids(pid))
        `)
        if (rows.length) {
          waiting = true
          break
        }
        await sleep(10)
      }
      expect(waiting).toBe(true)
    } finally {
      release.resolve()
      await archive
    }
    expect(await restore).toMatchObject({ code: 'not_found' })
    const [row] = await db.select().from(workflow).where(eq(workflow.id, workflowId))
    expect(row.archivedAt).not.toBeNull()
  })

  check(
    'Project archive rolls back as a unit and retries without losing environments',
    async () => {
      const f = await fixture()
      const workflowIds = await Promise.all(f.ids.map((id) => addWorkflow(id, f.ownerId)))
      await expect(
        db.transaction(async (tx) => {
          await archiveProjectInTransaction(tx, f.projectId)
          throw new Error('Abort compound archive')
        })
      ).rejects.toThrow('Abort compound archive')
      const before = await db.select().from(workspace).where(inArray(workspace.id, f.ids))
      expect(before.every((row) => row.archivedAt === null)).toBe(true)
      const args = { principal: f.owner, input: { projectId: f.projectId }, request }
      await archiveProject.execute(args)
      await archiveProject.execute(args)
      await expect(
        db.transaction(async (tx) => {
          const row = await buildNewWorkflowRow(tx, {
            id: generateId(),
            userId: f.ownerId,
            workspaceId: f.ids[0],
            folderId: null,
            name: 'Late workflow',
            description: null,
          })
          await tx.insert(workflow).values(row)
        })
      ).rejects.toMatchObject({ code: 'not_found' })

      const rows = await db.select().from(workspace).where(inArray(workspace.id, f.ids))
      expect(rows.every((row) => row.archivedAt !== null)).toBe(true)
      const workflows = await db.select().from(workflow).where(inArray(workflow.id, workflowIds))
      expect(
        workflows.every((row) => row.archivedAt !== null && !row.isDeployed && !row.isPublicApi)
      ).toBe(true)
      expect(
        await db.select().from(projectWorkspace).where(eq(projectWorkspace.projectId, f.projectId))
      ).toHaveLength(2)
      await expect(getProjectIssueAccess.execute(args)).rejects.toMatchObject({ code: 'conflict' })
    }
  )

  check(
    'disconnect moves descendants to one new Project and preserves restrictions on retry',
    async () => {
      const f = await fixture(true, 3)
      const organizationId = f.organizationId
      if (!organizationId) throw new Error('Missing organization fixture')
      const groupId = generateId()
      await db.insert(permissionGroup).values({
        id: groupId,
        organizationId: organizationId,
        name: 'Restricted',
        createdBy: f.ownerId,
        isDefault: true,
        config: { deniedPartialAccessProjectIssues: [f.projectId] },
      })
      for (const childWorkspaceId of [f.ids[1], f.ids[2]]) {
        await db.insert(workspaceForkResourceMap).values({
          id: generateId(),
          childWorkspaceId,
          resourceType: 'workflow',
          parentResourceId: 'parent-workflow',
          childResourceId: 'child-workflow',
        })
        await db.insert(workspaceForkBlockMap).values({
          id: generateId(),
          childWorkspaceId,
          parentWorkflowId: 'parent-workflow',
          childWorkflowId: 'child-workflow',
          parentBlockId: 'parent-block',
          childBlockId: 'child-block',
        })
        await db.insert(workspaceForkDependentValue).values({
          id: generateId(),
          childWorkspaceId,
          targetWorkflowId: 'child-workflow',
          targetBlockId: 'child-block',
          subBlockKey: 'selection',
          value: 'saved-selection',
        })
        await db.insert(workspaceForkPromoteRun).values({
          id: generateId(),
          childWorkspaceId,
          sourceWorkspaceId: f.ids[0],
          targetWorkspaceId: childWorkspaceId,
          direction: 'pull',
          snapshot: {},
        })
      }
      const edge = { parentWorkspaceId: f.ids[0], childWorkspaceId: f.ids[1] }
      expect(await unlinkForkEdge(edge)).toEqual({ unlinked: true })
      for (const table of [
        workspaceForkResourceMap,
        workspaceForkBlockMap,
        workspaceForkDependentValue,
        workspaceForkPromoteRun,
      ]) {
        const rows = await db
          .select({ childWorkspaceId: table.childWorkspaceId })
          .from(table)
          .where(inArray(table.childWorkspaceId, [f.ids[1], f.ids[2]]))
        expect(rows).toEqual([{ childWorkspaceId: f.ids[2] }])
      }
      const first = await db
        .select()
        .from(projectWorkspace)
        .where(inArray(projectWorkspace.workspaceId, f.ids))
      const root = first.find((row) => row.workspaceId === f.ids[0])
      const child = first.find((row) => row.workspaceId === f.ids[1])
      const grandchild = first.find((row) => row.workspaceId === f.ids[2])
      if (!root || !child || !grandchild) throw new Error('Missing family membership fixture')
      expect(root.projectId).toBe(f.projectId)
      expect(child.projectId).not.toBe(f.projectId)
      expect(grandchild.projectId).toBe(child.projectId)
      expect(await unlinkForkEdge(edge)).toEqual({ unlinked: false })
      const [group] = await db.select().from(permissionGroup).where(eq(permissionGroup.id, groupId))
      expect(group.config).toEqual({
        deniedPartialAccessProjectIssues: [f.projectId, child.projectId],
      })
      const second = await db
        .select()
        .from(projectWorkspace)
        .where(eq(projectWorkspace.workspaceId, f.ids[1]))
      expect(second[0].projectId).toBe(child.projectId)
    }
  )

  check(
    'disconnect refuses a partially assigned subtree without moving any environments',
    async () => {
      const f = await fixture(true, 3)
      await db.delete(projectWorkspace).where(eq(projectWorkspace.workspaceId, f.ids[2]))
      await expect(
        unlinkForkEdge({ parentWorkspaceId: f.ids[0], childWorkspaceId: f.ids[1] })
      ).rejects.toMatchObject({ code: 'conflict' })
      const [child] = await db
        .select()
        .from(projectWorkspace)
        .where(eq(projectWorkspace.workspaceId, f.ids[1]))
      expect(child.projectId).toBe(f.projectId)
      const [edge] = await db.select().from(workspace).where(eq(workspace.id, f.ids[1]))
      expect(edge.forkedFromWorkspaceId).toBe(f.ids[0])
    },
    true
  )

  check(
    'organization moves remove obsolete Project restrictions while preserving unrelated policy',
    async () => {
      const source = await fixture(true, 1)
      const organizationId = source.organizationId
      if (!organizationId) throw new Error('Missing organization fixture')
      const destination = await fixture(true, 1)
      const groupId = generateId()
      await db.insert(permissionGroup).values({
        id: groupId,
        organizationId: organizationId,
        name: 'Source policy',
        createdBy: source.ownerId,
        isDefault: true,
        config: { deniedPartialAccessProjectIssues: [source.projectId], hideTablesTab: true },
      })
      await db.transaction(async (tx) => {
        await transferWorkspaceProjects(tx, source.ids, destination.organizationId)
        await tx
          .update(workspace)
          .set({ organizationId: destination.organizationId })
          .where(eq(workspace.id, source.ids[0]))
      })
      const [group] = await db.select().from(permissionGroup).where(eq(permissionGroup.id, groupId))
      expect(group.config).toEqual({ deniedPartialAccessProjectIssues: [], hideTablesTab: true })
      const [moved] = await db.select().from(project).where(eq(project.id, source.projectId))
      expect(moved).toMatchObject({
        organizationId: destination.organizationId,
        ownerId: source.ownerId,
      })
    }
  )

  check(
    'organization deletion preserves Project identity and assigns its former owner explicitly',
    async () => {
      const f = await fixture()
      const organizationId = f.organizationId
      if (!organizationId) throw new Error('Missing organization fixture')
      await db.transaction(async (tx) => {
        await detachOrganizationWorkspacesTx(tx, organizationId)
        await tx.delete(organization).where(eq(organization.id, organizationId))
      })
      const [record] = await db.select().from(project).where(eq(project.id, f.projectId))
      expect(record).toMatchObject({ id: f.projectId, organizationId: null, ownerId: f.ownerId })
      const result = await getProject.execute({
        principal: f.owner,
        input: { projectId: f.projectId },
        request,
      })
      expect(result.project.environments).toHaveLength(2)
      await expect(
        db.transaction((tx) => transferWorkspaceProjects(tx, [f.ids[0]], generateId()))
      ).rejects.toMatchObject({ code: 'conflict' })
    }
  )

  check(
    'account deletion preview reports a surviving Project losing its last active environment',
    async () => {
      const f = await fixture(false)
      await db
        .delete(permissions)
        .where(and(eq(permissions.entityId, f.ids[0]), eq(permissions.userId, f.teammateId)))
      await db
        .delete(permissions)
        .where(and(eq(permissions.entityId, f.ids[1]), eq(permissions.userId, f.ownerId)))
      await db.insert(permissions).values({
        id: generateId(),
        entityId: f.ids[1],
        entityType: 'workspace',
        userId: f.teammateId,
        permissionType: 'admin',
      })
      await db
        .update(workspace)
        .set({ archivedAt: new Date(), ownerId: f.teammateId, billedAccountUserId: f.teammateId })
        .where(eq(workspace.id, f.ids[1]))
      const plan = await getAccountDeletionPlan(f.ownerId)
      expect(plan.workspacesToDelete.map((row) => row.id)).toEqual([f.ids[0]])
      expect(plan.blockers).toEqual([
        { code: 'project_lifecycle', message: expect.stringContaining('Archive') },
      ])
      await expect(
        db.transaction((tx) => prepareProjectsForAccountDeletion(tx, f.ownerId, [f.ids[0]]))
      ).rejects.toMatchObject({ code: 'conflict' })
      await db.transaction((tx) => archiveProjectInTransaction(tx, f.projectId))
      expect((await getAccountDeletionPlan(f.ownerId)).blockers).toEqual([])
    }
  )

  check(
    'account teardown can choose an organization admin without per-environment grants',
    async () => {
      const f = await fixture()
      if (!f.organizationId) throw new Error('Missing organization fixture')
      await db.insert(member).values({
        id: generateId(),
        organizationId: f.organizationId,
        userId: f.teammateId,
        role: 'admin',
        createdAt: new Date(),
      })
      await db.transaction((tx) => prepareProjectsForAccountDeletion(tx, f.ownerId, []))
      const [record] = await db.select().from(project).where(eq(project.id, f.projectId))
      expect(record.ownerId).toBe(f.teammateId)
    }
  )

  check(
    'account teardown re-reads Projects created by an unlink while waiting for the old Project',
    async () => {
      const f = await fixture(false)
      const held = createDeferred<number>()
      const release = createDeferred<void>()
      let detachedProjectId: string | null = null
      const unlink = db.transaction(async (tx) => {
        await lockProject(tx, f.projectId)
        const [connection] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
        held.resolve(connection.pid)
        await release.promise
        detachedProjectId = await splitForkProject(tx, f.ids[1])
        await tx
          .update(workspace)
          .set({ forkedFromWorkspaceId: null })
          .where(eq(workspace.id, f.ids[1]))
      })
      const blocker = await held.promise
      const deletion = db.transaction(async (tx) => {
        await prepareProjectsForAccountDeletion(tx, f.ownerId, [f.ids[1]])
        await tx.delete(workspace).where(eq(workspace.id, f.ids[1]))
      })
      try {
        let waiting = false
        for (let attempt = 0; attempt < 100; attempt++) {
          const rows = await db.execute(
            sql`SELECT 1 FROM pg_stat_activity WHERE ${blocker} = ANY(pg_blocking_pids(pid))`
          )
          if (rows.length) {
            waiting = true
            break
          }
          await sleep(10)
        }
        expect(waiting).toBe(true)
      } finally {
        release.resolve()
        await unlink
      }
      await deletion
      if (!detachedProjectId) throw new Error('Unlink did not create a Project')
      expect(await db.select().from(project).where(eq(project.id, detachedProjectId))).toEqual([])
    }
  )

  check(
    'banning a former owner cannot archive environments transferred while waiting for the Project',
    async () => {
      const f = await fixture(false)
      const held = createDeferred<number>()
      const release = createDeferred<void>()
      const transfer = db.transaction(async (tx) => {
        await lockProject(tx, f.projectId)
        const [connection] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
        held.resolve(connection.pid)
        await release.promise
        await tx
          .update(workspace)
          .set({ ownerId: f.teammateId })
          .where(inArray(workspace.id, f.ids))
      })
      const blocker = await held.promise
      const ban = disableUserResources(f.ownerId)
      try {
        let waiting = false
        for (let attempt = 0; attempt < 100; attempt++) {
          const rows = await db.execute(
            sql`SELECT 1 FROM pg_stat_activity WHERE ${blocker} = ANY(pg_blocking_pids(pid))`
          )
          if (rows.length) {
            waiting = true
            break
          }
          await sleep(10)
        }
        expect(waiting).toBe(true)
      } finally {
        release.resolve()
        await transfer
      }
      await ban
      const rows = await db.select().from(workspace).where(inArray(workspace.id, f.ids))
      expect(rows.every((row) => row.archivedAt === null && row.ownerId === f.teammateId)).toBe(
        true
      )
      const [record] = await db.select().from(project).where(eq(project.id, f.projectId))
      expect(record.archivedAt).toBeNull()
    }
  )

  check(
    'account teardown transfers surviving Projects and atomically removes wholly private Projects',
    async () => {
      const f = await fixture(false)
      await db.insert(permissions).values({
        id: generateId(),
        userId: f.teammateId,
        entityType: 'workspace',
        entityId: f.ids[1],
        permissionType: 'admin',
      })
      await db.transaction(async (tx) => {
        await prepareProjectsForAccountDeletion(tx, f.ownerId, [f.ids[0]])
        await tx.delete(workspace).where(eq(workspace.id, f.ids[0]))
      })
      const [survivor] = await db.select().from(project).where(eq(project.id, f.projectId))
      expect(survivor.ownerId).toBe(f.teammateId)
      const privateProject = await fixture(false, 1)
      await db.transaction(async (tx) => {
        await prepareProjectsForAccountDeletion(tx, privateProject.ownerId, privateProject.ids)
        await tx.delete(workspace).where(inArray(workspace.id, privateProject.ids))
      })
      expect(
        await db.select().from(project).where(eq(project.id, privateProject.projectId))
      ).toEqual([])
    }
  )
})
