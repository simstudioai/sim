/**
 * The default workspace a first visit creates, against real PostgreSQL. The shell's server render
 * and the client's list read (both naming the shell's organization) and the `/workspace` entry
 * (naming none) all run `listViewerWorkspaces` for the same viewer at once. Failure modes:
 * concurrent first visits each creating a default workspace; a later visit creating another; a
 * visit returning a list that misses the workspace another visit created; and a named
 * organization the viewer does not belong to deciding anything.
 */
import { db } from '@sim/db'
import {
  member,
  organization,
  permissions,
  project,
  user,
  userStats,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { OrganizationMembershipNotFoundError } from '@/lib/core/application/organization-authorization'
import { ensureUserOrganization } from '@/lib/organizations/provision-personal'
import { listViewerWorkspaces } from '@/lib/workspaces/application/viewer-workspaces'
import { listWorkspacesEnsuringDefault } from '@/lib/workspaces/create'

const userIds: string[] = []

async function createUser(): Promise<string> {
  const id = `default-workspace-user-${generateId()}`
  const now = new Date()
  await db.insert(user).values({
    id,
    name: 'Ada Lovelace',
    email: `${id}@default-workspace.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(userStats).values({ id: generateId(), userId: id, storageUsedBytes: 0 })
  userIds.push(id)
  return id
}

async function workspaceIdsOf(userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: permissions.entityId })
    .from(permissions)
    .where(and(eq(permissions.userId, userId), eq(permissions.entityType, 'workspace')))
  return rows.map((row) => row.id)
}

afterAll(async () => {
  if (userIds.length === 0) return
  const workspaces = await db
    .select({ id: workspace.id, projectId: workspace.projectId })
    .from(workspace)
    .where(inArray(workspace.ownerId, userIds))
  const organizations = await db
    .select({ id: member.organizationId })
    .from(member)
    .where(inArray(member.userId, userIds))
  if (workspaces.length > 0) {
    await db.delete(workspace).where(
      inArray(
        workspace.id,
        workspaces.map((row) => row.id)
      )
    )
    await db.delete(project).where(
      inArray(
        project.id,
        workspaces.flatMap((row) => (row.projectId ? [row.projectId] : []))
      )
    )
  }
  if (organizations.length > 0) {
    await db.delete(organization).where(
      inArray(
        organization.id,
        organizations.map((row) => row.id)
      )
    )
  }
  await db.delete(user).where(inArray(user.id, userIds))
})

describe('listWorkspacesEnsuringDefault', () => {
  it('creates exactly one default workspace across concurrent first visits', async () => {
    const userId = await createUser()
    await ensureUserOrganization(userId)
    const visit = () => listWorkspacesEnsuringDefault({ userId, activeOrganizationId: null })

    const payloads = await Promise.all([visit(), visit(), visit(), visit(), visit()])

    const created = await workspaceIdsOf(userId)
    expect(created).toHaveLength(1)
    for (const payload of payloads)
      expect(payload.workspaces.map((listed) => listed.id)).toEqual(created)
    expect(payloads[0].workspaces[0].name).toBe("Ada's Workspace")

    await visit()
    expect(await workspaceIdsOf(userId)).toEqual(created)
  })

  it('refuses a named organization the viewer does not belong to before creating anything', async () => {
    const outsiderId = await createUser()
    const userId = await createUser()
    const foreignOrganizationId = await ensureUserOrganization(outsiderId)
    if (!foreignOrganizationId) throw new Error('Expected the outsider to own an organization')
    const principal = { kind: 'session' as const, userId, sessionId: `session-${generateId()}` }

    await expect(
      listViewerWorkspaces.execute({
        principal,
        input: { scope: 'active', organizationId: foreignOrganizationId },
      })
    ).rejects.toBeInstanceOf(OrganizationMembershipNotFoundError)
    expect(await workspaceIdsOf(userId)).toEqual([])
  })
})
