import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { db } from '@sim/db'
import {
  member,
  organization,
  permissionGroup,
  permissions,
  project,
  projectMembershipRollout,
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
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { getErrorMessage, getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, or, sql } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  removeUserFromOrganization,
  transferOrganizationOwnership,
} from '@/lib/billing/organizations/membership'
import {
  getProjectAccountDeletionBlockers,
  prepareProjectsForAccountDeletion,
} from '@/lib/projects/account-deletion'
import {
  archiveProject,
  createProject,
  getProject,
  getProjectIssueAccess,
  getWorkspaceProject,
  listProjects,
  renameProject,
} from '@/lib/projects/application'
import {
  getProjectEnvironmentSource,
  getProjectMembershipPhase,
} from '@/lib/projects/environment-source'
import { archiveProjectInTransaction } from '@/lib/projects/lifecycle'
import {
  createProjectRecord,
  lockProject,
  lockWorkspaceProject,
  projectBackfillLockKey,
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

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)

function setProjectsEnabled(enabled: boolean) {
  featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(
    async (flag) => enabled && flag === 'projects'
  )
}

beforeEach(async () => {
  await db
    .update(projectMembershipRollout)
    .set({ phase: 'column' })
    .where(eq(projectMembershipRollout.id, 'membership'))
  setProjectsEnabled(true)
})

const users: string[] = []
const organizations: string[] = []
const request = { requestId: 'project-foundation-integration', headers: new Headers() }
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []

/** Registers a test and records its status and duration in the suite report. */
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

async function fixture(org = true, count = 2) {
  const ownerId = generateId()
  const teammateId = generateId()
  const outsiderId = generateId()
  const now = new Date()
  for (const id of [ownerId, teammateId, outsiderId]) {
    users.push(id)
    await db.insert(user).values({
      id,
      email: `${id}@projects.invalid`,
      name: 'Project fixture',
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
  }
  await db.insert(userStats).values({ id: generateId(), userId: ownerId })
  const organizationId = org ? generateId() : null
  if (organizationId) {
    organizations.push(organizationId)
    await db
      .insert(organization)
      .values({ id: organizationId, name: 'Project fixture', slug: organizationId, createdAt: now })
    await db
      .insert(member)
      .values({ id: generateId(), organizationId, userId: ownerId, role: 'owner', createdAt: now })
  }
  const ids = Array.from({ length: count }, () => generateId())
  const projectId = await db.transaction(async (tx) => {
    const id = await createProjectRecord(tx, {
      name: 'Environment 0',
      organizationId,
      ownerId,
    })
    for (const [index, workspaceId] of ids.entries()) {
      await tx.insert(workspace).values({
        id: workspaceId,
        projectId: id,
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
        entityId: workspaceId,
        userId: ownerId,
        permissionType: 'admin',
      })
    }
    return id
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

/**
 * Waits until the operation under test is blocked behind `blockerPid`: a session whose
 * current statement contains `waitingIn` (an advisory lock tag or row-lock clause).
 * When the caller owns the transaction, `waitingPid` identifies that exact backend.
 */
async function waitUntilBlockedBy(blockerPid: number, waitingIn: string, waitingPid?: number) {
  await expect
    .poll(
      async () =>
        (
          await db.execute(sql`
            SELECT 1 FROM pg_stat_activity
            WHERE ${waitingPid === undefined ? sql`true` : sql`pid = ${waitingPid}`}
              AND ${blockerPid} = ANY(pg_blocking_pids(pid))
              AND position(${waitingIn.toLowerCase()} in lower(query)) > 0
          `)
        ).length,
      { timeout: 2000, interval: 10 }
    )
    .toBeGreaterThan(0)
}

async function addOrganizationProject(organizationId: string, ownerId: string) {
  const workspaceId = generateId()
  const projectId = await db.transaction(async (tx) => {
    const id = await createProjectRecord(tx, {
      name: 'Sibling environment',
      organizationId,
      ownerId,
    })
    await tx.insert(workspace).values({
      id: workspaceId,
      projectId: id,
      name: 'Sibling environment',
      ownerId,
      billedAccountUserId: ownerId,
      organizationId,
      workspaceMode: 'organization',
    })
    return id
  })
  return { workspaceId, projectId }
}

async function useLegacyMemberships(ids: string[], projectId: string) {
  await db.transaction(async (tx) => {
    await tx.update(workspace).set({ projectId: null }).where(inArray(workspace.id, ids))
    await tx.insert(projectWorkspace).values(ids.map((workspaceId) => ({ projectId, workspaceId })))
  })
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

async function clearFixtures() {
  await db.transaction(async (tx) => {
    if (users.length)
      await tx
        .delete(workspace)
        .where(or(inArray(workspace.ownerId, users), inArray(workspace.billedAccountUserId, users)))
    if (users.length) await tx.delete(project).where(inArray(project.ownerId, users))
    if (organizations.length)
      await tx.delete(organization).where(inArray(organization.id, organizations))
    if (users.length) await tx.delete(user).where(inArray(user.id, users))
  })
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
  for (const phase of ['connector', 'column'] as const) {
    check(`workspace creation and fork/disconnect use only ${phase} authority`, async () => {
      setProjectsEnabled(false)
      const f = await fixture(false, 1)
      await db
        .update(projectMembershipRollout)
        .set({ phase })
        .where(eq(projectMembershipRollout.id, 'membership'))
      const source = await db.transaction((tx) =>
        createWorkspaceInTransaction(tx, {
          userId: f.ownerId,
          name: 'Source',
          organizationId: null,
          observedOrganizationId: null,
          governingPermissionGroupOrganizationId: null,
          workspaceMode: 'personal',
          billedAccountUserId: f.ownerId,
          skipDefaultWorkflow: true,
        })
      )
      const parent = await getWorkspaceWithOwner(source.id)
      if (!parent) throw new Error('Missing source fixture')
      const fork = await createFork({
        source: parent,
        policy: await getWorkspaceCreationPolicy({ userId: f.ownerId }),
        userId: f.ownerId,
        name: 'Child',
      })
      async function membership(id: string) {
        return db.transaction(async (tx) => {
          const environments = await getProjectEnvironmentSource(tx)
          const [row] = await tx
            .select({ projectId: environments.projectId })
            .from(environments)
            .where(eq(environments.id, id))
          return row?.projectId
        })
      }
      const sourceProject = await membership(source.id)
      expect(sourceProject).toEqual(expect.any(String))
      expect(await membership(fork.workspace.id)).toBe(sourceProject)
      await unlinkForkEdge({ parentWorkspaceId: source.id, childWorkspaceId: fork.workspace.id })
      const childProject = await membership(fork.workspace.id)
      expect(childProject).toEqual(expect.any(String))
      expect(childProject).not.toBe(sourceProject)
      const rows = await db
        .select({ projectId: workspace.projectId, parent: workspace.forkedFromWorkspaceId })
        .from(workspace)
        .where(inArray(workspace.id, [source.id, fork.workspace.id]))
      expect(rows.every((row) => row.parent === null)).toBe(true)
      const connectors = await db
        .select({ id: projectWorkspace.workspaceId })
        .from(projectWorkspace)
        .where(inArray(projectWorkspace.workspaceId, [source.id, fork.workspace.id]))
      expect(connectors).toHaveLength(phase === 'connector' ? 2 : 0)
      expect(
        rows.every((row) =>
          phase === 'connector' ? row.projectId === null : row.projectId !== null
        )
      ).toBe(true)
      if (phase === 'connector') {
        /** The old Project-first teardown must remove a newly created private environment. */
        await db.transaction(async (tx) => {
          await tx.delete(projectWorkspace).where(eq(projectWorkspace.projectId, childProject!))
          await tx.delete(project).where(eq(project.id, childProject!))
          await tx.delete(workspace).where(eq(workspace.id, fork.workspace.id))
        })
        expect(await membership(fork.workspace.id)).toBeUndefined()
      }
    })
  }

  check('authority barrier excludes cutover until a connector transaction commits', async () => {
    await db
      .update(projectMembershipRollout)
      .set({ phase: 'connector' })
      .where(eq(projectMembershipRollout.id, 'membership'))
    const entered = createDeferred<void>()
    const release = createDeferred<void>()
    const reader = db.transaction(async (tx) => {
      expect(await getProjectMembershipPhase(tx)).toBe('connector')
      entered.resolve()
      await release.promise
      expect(await getProjectMembershipPhase(tx)).toBe('connector')
    })
    try {
      await entered.promise
      await expect(
        db.transaction(async (tx) => {
          await tx.execute(sql`LOCK TABLE workspace IN ACCESS EXCLUSIVE MODE NOWAIT`)
          await tx.update(projectMembershipRollout).set({ phase: 'column' })
        })
      ).rejects.toSatisfy((error: unknown) => getPostgresErrorCode(error) === '55P03')
    } finally {
      release.resolve()
      await reader
    }
    await db.transaction(async (tx) => {
      await tx.execute(sql`LOCK TABLE workspace IN ACCESS EXCLUSIVE MODE NOWAIT`)
      await tx.update(projectMembershipRollout).set({ phase: 'column' })
    })
    expect(await db.transaction((tx) => getProjectMembershipPhase(tx))).toBe('column')
  })

  check(
    'Project snapshot waits before its first SELECT and observes committed cutover',
    async () => {
      const f = await fixture(false, 1)
      await useLegacyMemberships(f.ids, f.projectId)
      await db.update(projectMembershipRollout).set({ phase: 'connector' })
      const entered = createDeferred<number>()
      const release = createDeferred<void>()
      const cutover = db.transaction(async (tx) => {
        await tx.execute(sql`LOCK TABLE workspace IN ACCESS EXCLUSIVE MODE NOWAIT`)
        const [backend] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
        await tx.update(projectMembershipRollout).set({ phase: 'column' })
        await tx
          .update(workspace)
          .set({ projectId: f.projectId, name: 'Committed after cutover' })
          .where(eq(workspace.id, f.ids[0]))
        await tx.delete(projectWorkspace).where(eq(projectWorkspace.workspaceId, f.ids[0]))
        entered.resolve(backend.pid)
        await release.promise
      })
      let read: ReturnType<typeof getProject.execute> | undefined
      try {
        const pid = await entered.promise
        read = getProject.execute({
          principal: f.owner,
          input: { projectId: f.projectId },
          request,
        })
        await waitUntilBlockedBy(pid, 'LOCK TABLE')
      } finally {
        release.resolve()
        await cutover
      }
      const result = await read!
      expect(result.project.environments.map((row) => row.id)).toEqual(f.ids)
      expect(result.project.environments[0].name).toBe('Committed after cutover')
    }
  )

  check(
    'missing authority refuses membership reads and creation without partial writes',
    async () => {
      const f = await fixture(false, 1)
      await db.delete(projectMembershipRollout)
      try {
        await expect(
          getProject.execute({ principal: f.owner, input: { projectId: f.projectId }, request })
        ).rejects.toThrow('Project membership authority is missing')
        await expect(
          db.transaction((tx) =>
            createWorkspaceInTransaction(tx, {
              userId: f.ownerId,
              name: 'Refused',
              organizationId: null,
              observedOrganizationId: null,
              governingPermissionGroupOrganizationId: null,
              workspaceMode: 'personal',
              billedAccountUserId: f.ownerId,
              skipDefaultWorkflow: true,
            })
          )
        ).rejects.toThrow('Project membership authority is missing')
        expect(
          await db
            .select({ id: workspace.id })
            .from(workspace)
            .where(eq(workspace.ownerId, f.ownerId))
        ).toHaveLength(1)
      } finally {
        await db.insert(projectMembershipRollout).values({ id: 'membership', phase: 'column' })
      }
    }
  )

  check(
    'Project operations remain unavailable until API activation with no partial creation',
    async () => {
      const f = await fixture(false, 1)
      setProjectsEnabled(false)
      const input = { projectId: f.projectId }
      const [before] = await db.select().from(project).where(eq(project.id, f.projectId))
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
      expect(await db.select().from(project).where(eq(project.id, f.projectId))).toEqual([before])
    }
  )

  check('a detached fork keeps its own Project, archived with its only environment', async () => {
    const f = await fixture(false, 1)
    const parent = await getWorkspaceWithOwner(f.ids[0])
    if (!parent) throw new Error('Missing source fixture')
    const fork = await createFork({
      source: parent,
      policy: await getWorkspaceCreationPolicy({ userId: f.ownerId }),
      userId: f.ownerId,
      name: 'Assigned child',
    })
    const [membership] = await db
      .select({ projectId: workspace.projectId, workspaceId: workspace.id })
      .from(workspace)
      .where(eq(workspace.id, fork.workspace.id))
    expect(membership.projectId).toBe(f.projectId)
    await unlinkForkEdge({ parentWorkspaceId: f.ids[0], childWorkspaceId: fork.workspace.id })
    const [detached] = await db
      .select({ projectId: workspace.projectId, workspaceId: workspace.id })
      .from(workspace)
      .where(eq(workspace.id, fork.workspace.id))
    expect(detached.projectId).not.toBe(f.projectId)
    if (!detached.projectId) throw new Error('Missing detached Project assignment')
    await expect(
      archiveWorkspace(fork.workspace.id, { requestId: 'detached-fork-archive' })
    ).resolves.toMatchObject({ archived: true })
    const [detachedProject] = await db
      .select()
      .from(project)
      .where(eq(project.id, detached.projectId))
    expect(detachedProject.archivedAt).not.toBeNull()
  })

  check('legacy unassigned forks and disconnects preserve the unassigned lineage', async () => {
    const f = await fixture(false, 1)
    await db.update(workspace).set({ projectId: null }).where(eq(workspace.id, f.ids[0]))
    await db.delete(project).where(eq(project.id, f.projectId))
    const parent = await getWorkspaceWithOwner(f.ids[0])
    if (!parent) throw new Error('Missing legacy source fixture')
    const fork = await createFork({
      source: parent,
      policy: await getWorkspaceCreationPolicy({ userId: f.ownerId }),
      userId: f.ownerId,
      name: 'Legacy unassigned child',
    })
    await expect(
      getWorkspaceProject.execute({
        principal: f.owner,
        input: { workspaceId: fork.workspace.id },
        request,
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    await unlinkForkEdge({ parentWorkspaceId: parent.id, childWorkspaceId: fork.workspace.id })
    const [child] = await db
      .select({ projectId: workspace.projectId, parentId: workspace.forkedFromWorkspaceId })
      .from(workspace)
      .where(eq(workspace.id, fork.workspace.id))
    expect(child).toEqual({ projectId: null, parentId: null })
    expect(await db.select().from(project).where(eq(project.ownerId, f.ownerId))).toEqual([])
  })

  check('fork refuses a partially assigned lineage', async () => {
    const f = await fixture(false, 3)
    await db
      .update(workspace)
      .set({ projectId: null })
      .where(inArray(workspace.id, f.ids.slice(0, 2)))
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
    const [child] = await db.select().from(workspace).where(eq(workspace.id, f.ids[1]))
    expect(child.forkedFromWorkspaceId).toBe(f.ids[0])
    expect(await db.select().from(workspace).where(eq(workspace.ownerId, f.ownerId))).toHaveLength(
      3
    )
  })

  check(
    'legacy membership decisions exclude backfill until the writing transaction commits',
    async () => {
      const f = await fixture(false, 1)
      await db.update(workspace).set({ projectId: null }).where(eq(workspace.id, f.ids[0]))
      await db.delete(project).where(eq(project.id, f.projectId))
      const [legacyWorkspace] = await db.select().from(workspace).where(eq(workspace.id, f.ids[0]))
      expect(legacyWorkspace.projectId).toBeNull()
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
            SELECT pg_try_advisory_xact_lock(hashtextextended(${projectBackfillLockKey(f.ids[0])}, 0)) AS acquired
          `)
          expect(lock.acquired).toBe(false)
        })
      } finally {
        release.resolve()
        await writer
      }
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${projectBackfillLockKey(f.ids[0])}, 0))`
        )
        const projectId = await createProjectRecord(tx, {
          name: 'Concurrent legacy edit',
          organizationId: null,
          ownerId: f.ownerId,
        })
        await tx.update(workspace).set({ projectId }).where(eq(workspace.id, f.ids[0]))
      })
      expect(
        await db
          .select({
            projectId: workspace.projectId,
            workspaceId: workspace.id,
          })
          .from(workspace)
          .where(eq(workspace.id, f.ids[0]))
      ).toHaveLength(1)
    }
  )

  check(
    'a fork waiting for a legacy assignment inherits it without copying the parent column',
    async () => {
      const f = await fixture(false, 1)
      await db.update(workspace).set({ projectId: null }).where(eq(workspace.id, f.ids[0]))
      await db.delete(project).where(eq(project.id, f.projectId))
      const parent = await getWorkspaceWithOwner(f.ids[0])
      if (!parent) throw new Error('Missing source fixture')
      const policy = await getWorkspaceCreationPolicy({ userId: f.ownerId })
      const locked = createDeferred<number>()
      const release = createDeferred<void>()
      const backfill = db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${projectBackfillLockKey(f.ids[0])}, 0))`
        )
        const [connection] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
        locked.resolve(connection.pid)
        await release.promise
        const projectId = await createProjectRecord(tx, {
          name: 'Backfilled source',
          organizationId: null,
          ownerId: f.ownerId,
        })
        await tx.insert(projectWorkspace).values({ projectId, workspaceId: f.ids[0] })
        return projectId
      })
      await Promise.race([locked.promise, backfill])
      const fork = createFork({
        source: parent,
        policy,
        userId: f.ownerId,
        name: 'Concurrent child',
      })
      try {
        await waitUntilBlockedBy(await locked.promise, "lock='project_backfill'")
      } finally {
        release.resolve()
      }
      const [projectId, result] = await Promise.all([backfill, fork])
      const [membership] = await db
        .select({
          projectId: workspace.projectId,
          workspaceId: workspace.id,
        })
        .from(workspace)
        .where(eq(workspace.id, result.workspace.id))
      expect(membership.projectId).toBe(projectId)
      const [persistedFork] = await db
        .select()
        .from(workspace)
        .where(eq(workspace.id, result.workspace.id))
      expect(persistedFork.projectId).toBe(projectId)
      const [legacyParent] = await db.select().from(workspace).where(eq(workspace.id, f.ids[0]))
      expect(legacyParent.projectId).toBeNull()
      const resolved = await getWorkspaceProject.execute({
        principal: f.owner,
        input: { workspaceId: f.ids[0] },
        request,
      })
      expect(resolved.project.id).toBe(projectId)
    }
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
          projectId: created.id,
          name: 'Production',
          organizationId,
          ownerId: f.teammateId,
          billedAccountUserId: personal ? f.teammateId : f.ownerId,
        })
        expect(
          await db
            .select({
              projectId: workspace.projectId,
              workspaceId: workspace.id,
            })
            .from(workspace)
            .where(eq(workspace.projectId, created.id))
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
          await db
            .select({ workspaceId: workspace.id })
            .from(workspace)
            .innerJoin(project, eq(project.id, workspace.projectId))
            .where(eq(project.ownerId, f.ownerId))
        ).toEqual([{ workspaceId: f.ids[0] }])
        expect(
          await db.select().from(permissions).where(eq(permissions.userId, f.ownerId))
        ).toEqual(before)
      } finally {
        await db.execute(sql`ALTER TABLE ${workflow} DROP CONSTRAINT ${constraint}`)
      }
    }
  )

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
      ).rejects.toThrow('cannot perform operation')
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

  check('concurrent removal of every environment archives the Project', async () => {
    const f = await fixture(false)
    const results = await Promise.allSettled(f.ids.map((id) => archiveWorkspace(id, request)))
    expect(results).toMatchObject(f.ids.map(() => ({ status: 'fulfilled' })))
    const rows = await db.select().from(workspace).where(inArray(workspace.id, f.ids))
    expect(rows.map((row) => row.archivedAt)).not.toContain(null)
    const [record] = await db.select().from(project).where(eq(project.id, f.projectId))
    expect(record.archivedAt).not.toBeNull()
  })

  check('removing one of several environments keeps the Project active', async () => {
    const f = await fixture(false)
    await archiveWorkspace(f.ids[0], request)
    const [record] = await db.select().from(project).where(eq(project.id, f.projectId))
    expect(record.archivedAt).toBeNull()
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
        await waitUntilBlockedBy(blocker, 'for share')
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
      await waitUntilBlockedBy(blocker, 'for share')
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
      const untouched = await db.select().from(workspace).where(inArray(workspace.id, f.ids))
      expect(untouched.map((row) => row.archivedAt)).toEqual([null, null])
      const activeWorkflows = await db
        .select()
        .from(workflow)
        .where(inArray(workflow.id, workflowIds))
      expect(activeWorkflows).toMatchObject(
        workflowIds.map(() => ({ archivedAt: null, isDeployed: true }))
      )
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
        await db
          .select({
            projectId: workspace.projectId,
            workspaceId: workspace.id,
          })
          .from(workspace)
          .where(eq(workspace.projectId, f.projectId))
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
      await expect(
        db.transaction(async (tx) => {
          await splitForkProject(tx, f.ids[1])
          throw new Error('Abort compound disconnect')
        })
      ).rejects.toThrow('Abort compound disconnect')
      expect(
        await db
          .select({ projectId: workspace.projectId })
          .from(workspace)
          .where(inArray(workspace.id, f.ids))
      ).toEqual(f.ids.map(() => ({ projectId: f.projectId })))
      expect(
        await db
          .select({ projectId: workspace.projectId })
          .from(workspace)
          .where(inArray(workspace.id, f.ids))
      ).toEqual(f.ids.map(() => ({ projectId: f.projectId })))
      expect(await db.select().from(project).where(eq(project.ownerId, f.ownerId))).toHaveLength(1)
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
        .select({
          projectId: workspace.projectId,
          workspaceId: workspace.id,
        })
        .from(workspace)
        .where(inArray(workspace.id, f.ids))
      const root = first.find((row) => row.workspaceId === f.ids[0])
      const child = first.find((row) => row.workspaceId === f.ids[1])
      const grandchild = first.find((row) => row.workspaceId === f.ids[2])
      if (!root || !child || !grandchild) throw new Error('Missing family membership fixture')
      expect(root.projectId).toBe(f.projectId)
      expect(child.projectId).not.toBe(f.projectId)
      expect(grandchild.projectId).toBe(child.projectId)
      const environments = await db
        .select({ id: workspace.id, projectId: workspace.projectId })
        .from(workspace)
        .where(inArray(workspace.id, f.ids))
      expect(environments).toEqual(
        expect.arrayContaining([
          { id: f.ids[0], projectId: f.projectId },
          { id: f.ids[1], projectId: child.projectId },
          { id: f.ids[2], projectId: child.projectId },
        ])
      )
      expect(await unlinkForkEdge(edge)).toEqual({ unlinked: false })
      const [group] = await db.select().from(permissionGroup).where(eq(permissionGroup.id, groupId))
      expect(group.config).toEqual({
        deniedPartialAccessProjectIssues: [f.projectId, child.projectId],
      })
      const second = await db
        .select({
          projectId: workspace.projectId,
          workspaceId: workspace.id,
        })
        .from(workspace)
        .where(eq(workspace.id, f.ids[1]))
      expect(second[0].projectId).toBe(child.projectId)
    }
  )

  check(
    'disconnect refuses a partially assigned subtree without moving any environments',
    async () => {
      const f = await fixture(true, 3)
      await db.update(workspace).set({ projectId: null }).where(eq(workspace.id, f.ids[2]))
      await expect(
        unlinkForkEdge({ parentWorkspaceId: f.ids[0], childWorkspaceId: f.ids[1] })
      ).rejects.toMatchObject({ code: 'conflict' })
      const [child] = await db
        .select({
          projectId: workspace.projectId,
          workspaceId: workspace.id,
        })
        .from(workspace)
        .where(eq(workspace.id, f.ids[1]))
      expect(child.projectId).toBe(f.projectId)
      const [edge] = await db.select().from(workspace).where(eq(workspace.id, f.ids[1]))
      expect(edge.forkedFromWorkspaceId).toBe(f.ids[0])
    }
  )

  check(
    'organization moves remove obsolete Project restrictions while preserving unrelated policy',
    async () => {
      const source = await fixture(true, 1)
      const organizationId = source.organizationId
      if (!organizationId) throw new Error('Missing organization fixture')
      const destination = await fixture(true, 1)
      const sibling = await addOrganizationProject(organizationId, source.ownerId)
      const staying = await addOrganizationProject(organizationId, source.ownerId)
      const groupId = generateId()
      await db.insert(permissionGroup).values({
        id: groupId,
        organizationId: organizationId,
        name: 'Source policy',
        createdBy: source.ownerId,
        isDefault: true,
        config: {
          deniedPartialAccessProjectIssues: [
            source.projectId,
            staying.projectId,
            sibling.projectId,
          ],
          hideTablesTab: true,
        },
      })
      const moving = [...source.ids, sibling.workspaceId]
      await db.transaction(async (tx) => {
        await transferWorkspaceProjects(tx, moving, destination.organizationId)
        await tx
          .update(workspace)
          .set({ organizationId: destination.organizationId })
          .where(inArray(workspace.id, moving))
      })
      const [group] = await db.select().from(permissionGroup).where(eq(permissionGroup.id, groupId))
      expect(group.config).toEqual({
        deniedPartialAccessProjectIssues: [staying.projectId],
        hideTablesTab: true,
      })
      const [moved] = await db.select().from(project).where(eq(project.id, source.projectId))
      expect(moved).toMatchObject({
        organizationId: destination.organizationId,
        ownerId: source.ownerId,
      })
    }
  )

  check('organization ownership transfer moves the previous owner’s Projects', async () => {
    const f = await fixture(true, 1)
    if (!f.organizationId) throw new Error('Missing organization fixture')
    await db.insert(member).values({
      id: generateId(),
      organizationId: f.organizationId,
      userId: f.teammateId,
      role: 'member',
      createdAt: new Date(),
    })
    const result = await transferOrganizationOwnership({
      organizationId: f.organizationId,
      currentOwnerUserId: f.ownerId,
      newOwnerUserId: f.teammateId,
    })
    expect(result).toMatchObject({ success: true })
    const [record] = await db.select().from(project).where(eq(project.id, f.projectId))
    expect(record.ownerId).toBe(f.teammateId)
  })

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
    'account deletion archives a surviving Project losing its last active environment',
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
      expect(plan.blockers).toEqual([])
      await db.transaction(async (tx) => {
        expect(await prepareProjectsForAccountDeletion(tx, f.ownerId, [f.ids[0]])).toEqual([])
        await tx.delete(workspace).where(eq(workspace.id, f.ids[0]))
      })
      const [record] = await db.select().from(project).where(eq(project.id, f.projectId))
      expect(record.archivedAt).not.toBeNull()
      expect(record.ownerId).toBe(f.teammateId)
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
      await db.transaction(async (tx) => {
        expect(await prepareProjectsForAccountDeletion(tx, f.ownerId, [])).toEqual([])
      })
      const [record] = await db.select().from(project).where(eq(project.id, f.projectId))
      expect(record.ownerId).toBe(f.teammateId)
    }
  )

  check(
    'column reassignment waits for a legacy membership writer before locking workspace rows',
    async () => {
      const f = await fixture(false)
      await useLegacyMemberships(f.ids, f.projectId)
      const held = createDeferred<number>()
      const release = createDeferred<void>()
      let replacementId = ''
      const legacy = db.transaction(async (tx) => {
        await lockProject(tx, f.projectId)
        replacementId = await createProjectRecord(tx, {
          name: 'Legacy disconnect',
          ownerId: f.ownerId,
          organizationId: null,
        })
        await tx.execute(
          sql`SELECT workspace_id FROM project_workspace WHERE workspace_id = ${f.ids[1]} FOR UPDATE`
        )
        const [backend] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
        held.resolve(backend.pid)
        await release.promise
        await tx.execute(
          sql`UPDATE project_workspace SET project_id = ${replacementId} WHERE workspace_id = ${f.ids[1]}`
        )
      })
      const blocker = await held.promise
      const detachPid = createDeferred<number>()
      const detach = db
        .transaction(async (tx) => {
          const [backend] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
          detachPid.resolve(backend.pid)
          return splitForkProject(tx, f.ids[1])
        })
        .then(
          () => null,
          (error: unknown) => {
            detachPid.reject(error)
            return error
          }
        )
      try {
        await waitUntilBlockedBy(blocker, "lock='project'", await detachPid.promise)
      } finally {
        release.resolve()
        await legacy
      }
      expect(await detach).toMatchObject({
        message: 'Project membership changed; retry the operation',
      })
      expect(
        await db.execute(sql`SELECT w.project_id, pw.project_id AS connector_id
      FROM workspace w JOIN project_workspace pw ON pw.workspace_id = w.id WHERE w.id = ${f.ids[1]}`)
      ).toEqual([{ project_id: null, connector_id: replacementId }])
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
        const projectIds = await prepareProjectsForAccountDeletion(tx, f.ownerId, [f.ids[1]])
        expect(projectIds).toHaveLength(1)
        await tx.delete(workspace).where(eq(workspace.id, f.ids[1]))
        await tx.delete(project).where(inArray(project.id, projectIds))
      })
      try {
        await waitUntilBlockedBy(blocker, "lock='project'")
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
        await waitUntilBlockedBy(blocker, "lock='project'")
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
        expect(await prepareProjectsForAccountDeletion(tx, f.ownerId, [f.ids[0]])).toEqual([])
        await tx.delete(workspace).where(eq(workspace.id, f.ids[0]))
      })
      const [survivor] = await db.select().from(project).where(eq(project.id, f.projectId))
      expect(survivor.ownerId).toBe(f.teammateId)
      const privateProject = await fixture(false, 1)
      await expect(
        db.transaction(async (tx) => {
          const projectIds = await prepareProjectsForAccountDeletion(
            tx,
            privateProject.ownerId,
            privateProject.ids
          )
          expect(projectIds).toEqual([privateProject.projectId])
          expect(
            await tx.select().from(project).where(eq(project.id, privateProject.projectId))
          ).toHaveLength(1)
          throw new Error('Workspace deletion refused')
        })
      ).rejects.toThrow('Workspace deletion refused')
      expect(
        await db
          .select({ projectId: workspace.projectId })
          .from(workspace)
          .where(inArray(workspace.id, privateProject.ids))
      ).toEqual([{ projectId: privateProject.projectId }])
      expect(
        await db
          .select({ workspaceId: workspace.id })
          .from(workspace)
          .where(eq(workspace.projectId, privateProject.projectId))
      ).toEqual([{ workspaceId: privateProject.ids[0] }])
      await db.transaction(async (tx) => {
        const projectIds = await prepareProjectsForAccountDeletion(
          tx,
          privateProject.ownerId,
          privateProject.ids
        )
        expect(projectIds).toEqual([privateProject.projectId])
        await tx.delete(workspace).where(inArray(workspace.id, privateProject.ids))
        await tx.delete(project).where(inArray(project.id, projectIds))
      })
      expect(
        await db.select().from(project).where(eq(project.id, privateProject.projectId))
      ).toEqual([])
    }
  )

  for (const phase of ['connector', 'column'] as const) {
    check(
      `legacy Project account preview and teardown preserve surviving environments in ${phase} mode`,
      async () => {
        const f = await fixture()
        await useLegacyMemberships(f.ids, f.projectId)
        await db.update(projectMembershipRollout).set({ phase })
        if (!f.organizationId) throw new Error('Missing organization fixture')
        await db.insert(member).values({
          id: generateId(),
          organizationId: f.organizationId,
          userId: f.teammateId,
          role: 'admin',
          createdAt: new Date(),
        })
        expect(await getProjectAccountDeletionBlockers(f.ownerId, [])).toEqual([])
        await db.transaction(async (tx) => {
          expect(await prepareProjectsForAccountDeletion(tx, f.ownerId, [])).toEqual([])
        })
        const [record] = await db.select().from(project).where(eq(project.id, f.projectId))
        expect(record.ownerId).toBe(f.teammateId)
        expect(
          await db.select({ id: workspace.id }).from(workspace).where(inArray(workspace.id, f.ids))
        ).toHaveLength(2)
      }
    )
  }

  check(
    'legacy detach assigns the whole subtree and stale connector rows cannot restore membership',
    async () => {
      const f = await fixture(false, 3)
      await useLegacyMemberships(f.ids, f.projectId)
      await unlinkForkEdge({ parentWorkspaceId: f.ids[0], childWorkspaceId: f.ids[1] })
      const rows = await db.select().from(workspace).where(inArray(workspace.id, f.ids))
      const child = rows.find((row) => row.id === f.ids[1])
      const grandchild = rows.find((row) => row.id === f.ids[2])
      expect(child?.projectId).toEqual(expect.any(String))
      expect(child?.projectId).not.toBe(f.projectId)
      expect(grandchild?.projectId).toBe(child?.projectId)
      expect(
        await db
          .select({ projectId: projectWorkspace.projectId })
          .from(projectWorkspace)
          .where(inArray(projectWorkspace.workspaceId, f.ids))
      ).toEqual(f.ids.map(() => ({ projectId: f.projectId })))
      const current = await getWorkspaceProject.execute({
        principal: f.owner,
        input: { workspaceId: f.ids[1] },
        request,
      })
      expect(current.project.id).toBe(child?.projectId)
      await archiveWorkspace(f.ids[0], request)
      const [original] = await db.select().from(project).where(eq(project.id, f.projectId))
      expect(original.archivedAt).not.toBeNull()
      const detached = await getWorkspaceProject.execute({
        principal: f.owner,
        input: { workspaceId: f.ids[2] },
        request,
      })
      expect(detached.project.archivedAt).toBeNull()
    }
  )

  check(
    'legacy organization deletion transfers Projects without filling their columns',
    async () => {
      const f = await fixture()
      await useLegacyMemberships(f.ids, f.projectId)
      const organizationId = f.organizationId
      if (!organizationId) throw new Error('Missing organization fixture')
      await db.transaction(async (tx) => {
        await detachOrganizationWorkspacesTx(tx, organizationId)
        await tx.delete(organization).where(eq(organization.id, organizationId))
      })
      const [record] = await db.select().from(project).where(eq(project.id, f.projectId))
      expect(record).toMatchObject({ organizationId: null, ownerId: f.ownerId })
      expect(
        await db
          .select({ projectId: workspace.projectId })
          .from(workspace)
          .where(inArray(workspace.id, f.ids))
      ).toEqual(f.ids.map(() => ({ projectId: null })))
    }
  )

  check(
    'Project administration includes legacy environments during partial column assignment',
    async () => {
      const f = await fixture(false)
      await useLegacyMemberships([f.ids[1]], f.projectId)
      await expect(
        renameProject.execute({
          principal: f.teammate,
          input: { projectId: f.projectId, name: 'Forbidden rename' },
          request,
        })
      ).rejects.toMatchObject({ code: 'forbidden' })
      const visible = await getProject.execute({
        principal: f.owner,
        input: { projectId: f.projectId },
        request,
      })
      expect(visible.project.environments).toHaveLength(2)
    }
  )

  check(
    'connector retirement refuses busy workspace or Project readers without retaining locks',
    async () => {
      const f = await fixture(false)
      await useLegacyMemberships(f.ids, f.projectId)
      for (const held of ['workspace', 'project']) {
        await db.transaction(async (tx) => {
          if (held === 'workspace')
            expect((await lockWorkspaceProject(tx, f.ids[0]))?.id).toBe(f.projectId)
          else await tx.select().from(project).where(eq(project.id, f.projectId))
          await expect(
            isolated.client.begin(async (ddl) => {
              await ddl`LOCK TABLE workspace, project, project_workspace IN ACCESS EXCLUSIVE MODE NOWAIT`
              await ddl`DROP TABLE project_workspace`
            })
          ).rejects.toSatisfy((error: unknown) => getPostgresErrorCode(error) === '55P03')
          await isolated.client.begin(async (writer) => {
            await writer`SET LOCAL lock_timeout = '100ms'`
            await writer`UPDATE workspace SET name = 'Still writable' WHERE id = ${f.ids[0]}`
          })
        })
      }
    }
  )

  check(
    'account teardown after a legacy detach removes only obsolete connector references',
    async () => {
      const f = await fixture(false)
      await useLegacyMemberships(f.ids, f.projectId)
      await db
        .delete(permissions)
        .where(and(eq(permissions.entityId, f.ids[0]), eq(permissions.userId, f.teammateId)))
      await db.insert(permissions).values({
        id: generateId(),
        userId: f.teammateId,
        entityId: f.ids[1],
        entityType: 'workspace',
        permissionType: 'admin',
      })
      await unlinkForkEdge({ parentWorkspaceId: f.ids[0], childWorkspaceId: f.ids[1] })
      const [detached] = await db.select().from(workspace).where(eq(workspace.id, f.ids[1]))
      if (!detached.projectId) throw new Error('Missing detached Project')
      await db.update(workspace).set({ projectId: f.projectId }).where(eq(workspace.id, f.ids[0]))
      await expect(
        db.transaction(async (tx) => {
          await prepareProjectsForAccountDeletion(tx, f.ownerId, [f.ids[0]])
          throw new Error('Cancel account deletion')
        })
      ).rejects.toThrow('Cancel account deletion')
      expect(
        await db
          .select({ workspaceId: projectWorkspace.workspaceId })
          .from(projectWorkspace)
          .where(eq(projectWorkspace.projectId, f.projectId))
      ).toHaveLength(2)
      await db.transaction(async (tx) => {
        const ids = await prepareProjectsForAccountDeletion(tx, f.ownerId, [f.ids[0]])
        expect(ids).toEqual([f.projectId])
        expect(
          await tx
            .select({ workspaceId: projectWorkspace.workspaceId })
            .from(projectWorkspace)
            .where(eq(projectWorkspace.projectId, f.projectId))
        ).toEqual([{ workspaceId: f.ids[0] }])
        await tx.delete(workspace).where(eq(workspace.id, f.ids[0]))
        await tx.delete(project).where(inArray(project.id, ids))
      })
      expect(
        await db.select({ id: project.id }).from(project).where(eq(project.id, f.projectId))
      ).toEqual([])
      const [surviving] = await db.select().from(project).where(eq(project.id, detached.projectId))
      expect(surviving.ownerId).toBe(f.teammateId)
      expect(
        await db.select({ id: workspace.id }).from(workspace).where(eq(workspace.id, f.ids[1]))
      ).toEqual([{ id: f.ids[1] }])
    }
  )

  check(
    'column-only application operations remain valid after the connector is removed',
    async () => {
      await clearFixtures()
      const f = await fixture(true, 1)
      const locked = createDeferred<number>()
      const release = createDeferred<void>()
      const retirement = isolated.client.begin(async (tx) => {
        await tx`LOCK TABLE workspace, project, project_workspace IN ACCESS EXCLUSIVE MODE NOWAIT`
        const [connection] = await tx`SELECT pg_backend_pid() AS pid`
        locked.resolve(connection.pid)
        await release.promise
        await tx`DROP TABLE project_workspace`
        await tx`ALTER TABLE workspace ALTER COLUMN project_id SET NOT NULL`
        await tx`ALTER TABLE workspace VALIDATE CONSTRAINT workspace_project_id_project_id_fk`
      })
      await Promise.race([locked.promise, retirement])
      const overlappingRead = getWorkspaceProject.execute({
        principal: f.owner,
        input: { workspaceId: f.ids[0] },
        request,
      })
      try {
        await waitUntilBlockedBy(await locked.promise, 'workspace')
      } finally {
        release.resolve()
      }
      const [, overlappingResult] = await Promise.all([retirement, overlappingRead])
      expect(overlappingResult.project.environments.map((row) => row.id)).toEqual(f.ids)
      const organizationId = f.organizationId
      if (!organizationId) throw new Error('Missing organization fixture')
      const created = await createProject.execute({
        principal: f.owner,
        input: {
          organizationId,
          name: 'Column-only Project',
          initialEnvironment: { name: 'Production' },
        },
        request,
      })
      const source = await getWorkspaceWithOwner(created.initialEnvironment.id)
      if (!source) throw new Error('Missing source environment')
      const resolved = await getWorkspaceProject.execute({
        principal: f.owner,
        input: { workspaceId: source.id },
        request,
      })
      expect(resolved.project.id).toBe(created.project.id)
      await expect(
        getProject.execute({
          principal: createSessionPrincipal({ userId: f.outsiderId }),
          input: { projectId: created.project.id },
          request,
        })
      ).rejects.toMatchObject({ code: 'not_found' })
      const listed = await listProjects.execute({
        principal: f.owner,
        input: { limit: 10 },
        request,
      })
      expect(listed.projects.map((row) => row.id)).toEqual(
        expect.arrayContaining([f.projectId, created.project.id])
      )
      await renameProject.execute({
        principal: f.owner,
        input: { projectId: created.project.id, name: 'Renamed without connector' },
        request,
      })
      const fork = await createFork({
        source,
        policy: await getWorkspaceCreationPolicy({ userId: f.ownerId }),
        userId: f.ownerId,
        name: 'Staging',
      })
      const [forkEnvironment] = await db
        .select({ projectId: workspace.projectId })
        .from(workspace)
        .where(eq(workspace.id, fork.workspace.id))
      expect(forkEnvironment.projectId).toBe(created.project.id)
      await unlinkForkEdge({ parentWorkspaceId: source.id, childWorkspaceId: fork.workspace.id })
      const [detached] = await db
        .select({ projectId: workspace.projectId, parentId: workspace.forkedFromWorkspaceId })
        .from(workspace)
        .where(eq(workspace.id, fork.workspace.id))
      if (!detached.projectId) throw new Error('Disconnected environment has no Project')
      expect(detached.projectId).not.toBe(created.project.id)
      expect(detached.parentId).toBeNull()
      await archiveWorkspace(fork.workspace.id, request)
      const [detachedProject] = await db
        .select({ archivedAt: project.archivedAt })
        .from(project)
        .where(eq(project.id, detached.projectId))
      expect(detachedProject.archivedAt).not.toBeNull()
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
      expect(archived.name).toBe('Renamed without connector')
      expect(archived.organizationId).toBeNull()
      expect(archived.archivedAt).not.toBeNull()
      expect(
        await db
          .select({ id: workflow.id })
          .from(workflow)
          .where(and(eq(workflow.workspaceId, source.id), sql`${workflow.archivedAt} IS NULL`))
      ).toEqual([])
      const privateProject = await fixture(false, 1)
      await db.transaction(async (tx) => {
        const projectIds = await prepareProjectsForAccountDeletion(
          tx,
          privateProject.ownerId,
          privateProject.ids
        )
        expect(projectIds).toEqual([privateProject.projectId])
        await tx.delete(workspace).where(inArray(workspace.id, privateProject.ids))
        await tx.delete(project).where(inArray(project.id, projectIds))
      })
      expect(
        await db.select().from(project).where(eq(project.id, privateProject.projectId))
      ).toEqual([])
    }
  )
})
