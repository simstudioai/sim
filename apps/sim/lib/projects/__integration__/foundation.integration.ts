import { mkdir, writeFile } from 'node:fs/promises'
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
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { removeUserFromOrganization } from '@/lib/billing/organizations/membership'
import { prepareProjectsForAccountDeletion } from '@/lib/projects/account-deletion'
import {
  archiveProject,
  getProject,
  getProjectIssueAccess,
  getWorkspaceProject,
  listProjects,
  renameProject,
} from '@/lib/projects/application'
import { archiveProjectInTransaction } from '@/lib/projects/lifecycle'
import { createProjectForWorkspace, transferWorkspaceProjects } from '@/lib/projects/membership'
import { buildNewWorkflowRow } from '@/lib/workflows/persistence/new-workflow-row'
import { createWorkspaceInTransaction } from '@/lib/workspaces/create'
import { archiveWorkspace } from '@/lib/workspaces/lifecycle'
import { detachOrganizationWorkspacesTx } from '@/lib/workspaces/organization-workspaces'
import { getWorkspaceWithOwner } from '@/lib/workspaces/permissions/utils'
import { getWorkspaceCreationPolicy } from '@/lib/workspaces/policy'
import { createFork } from '@/ee/workspace-forking/lib/create-fork'
import { unlinkForkEdge } from '@/ee/workspace-forking/lib/lineage/unlink'

const users: string[] = []
const organizations: string[] = []
const environments: string[] = []
const request = { requestId: 'project-foundation-integration', headers: new Headers() }
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []

/** Exercises durable auth and lifecycle invariants against real Postgres, including concurrent writers. */
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
  let projectId = ''
  await db.transaction(async (tx) => {
    for (const [index, id] of ids.entries()) {
      environments.push(id)
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
  const reportPath =
    process.env.PROJECT_FOUNDATION_REPORT_PATH ?? resolve('test-results/project-foundation.json')
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
  if (environments.length) {
    const memberships = await db
      .select({ id: projectWorkspace.projectId })
      .from(projectWorkspace)
      .where(inArray(projectWorkspace.workspaceId, environments))
    const ids = [...new Set(memberships.map((row) => row.id))]
    await db.delete(projectWorkspace).where(inArray(projectWorkspace.workspaceId, environments))
    if (ids.length) await db.delete(project).where(inArray(project.id, ids))
    await db.delete(workspace).where(inArray(workspace.id, environments))
  }
  if (organizations.length)
    await db.delete(organization).where(inArray(organization.id, organizations))
  if (users.length) await db.delete(user).where(inArray(user.id, users))
})

describe('Project foundation at the database and application boundary', () => {
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
    environments.push(source.id)
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
    environments.push(fork.workspace.id)
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
    }
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
      await db.transaction((tx) => prepareProjectsForAccountDeletion(tx, f.ownerId, [f.ids[0]]))
      const [survivor] = await db.select().from(project).where(eq(project.id, f.projectId))
      expect(survivor.ownerId).toBe(f.teammateId)
      const privateProject = await fixture(false, 1)
      await db.transaction((tx) =>
        prepareProjectsForAccountDeletion(tx, privateProject.ownerId, privateProject.ids)
      )
      expect(
        await db.select().from(project).where(eq(project.id, privateProject.projectId))
      ).toEqual([])
    }
  )
})
