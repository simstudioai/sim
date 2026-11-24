/**
 * Inviting a directory-provisioned member when the organization has locked
 * managed membership: the directory owns workspaces a group is mapped to, and
 * nothing else, so an unmapped workspace stays shareable by hand.
 */

import { db } from '@sim/db'
import {
  auditLog,
  invitation,
  member,
  organization,
  permissions,
  scimConnection,
  scimGroupMapping,
  user,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { envFlagsMock } from '@sim/testing/mocks/env-flags.mock'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { withWorkspaceInvocationScope } from '@/lib/core/application/workspace-invocation-scope'
import { createScopedCliTransport } from '@/lib/mothership/agent-cli/scoped-transport'
import { addGroupMember, insertScimGroup } from '@/ee/scim/lib/repository/groups'
import { insertScimUser } from '@/ee/scim/lib/repository/users'
import '@/app/api/v2/workspaces/[workspaceId]/invitations/route'

/** Directory provisioning on a self-hosted deployment, so a locked connection is enforced. */
vi.mock('@/lib/core/config/env-flags', () => ({ ...envFlagsMock, isScimEnabled: true }))

const ORIGIN = 'http://localhost:3000'
const organizationId = generateId()
const connectionId = generateId()
const unmappedWorkspaceId = generateId()
const mappedWorkspaceId = generateId()
const adminId = generateId()
const managedMemberId = generateId()
/** Provisioned and in the organization, but in no group mapped to anything. */
const ungroupedMemberId = generateId()
const managedOutsiderId = generateId()
const fixtureDomain = `${generateId()}.scim-invite.test`
const emailOf = (id: string) => `${id}@${fixtureDomain}`

function invite(workspaceId: string, email: string) {
  const transport = createScopedCliTransport(ORIGIN, {
    userId: adminId,
    workspaceId,
    chatId: generateId(),
  })
  return withWorkspaceInvocationScope({ workspaceId, organizationId }, () =>
    transport(`${ORIGIN}/api/v2/workspaces/${workspaceId}/invitations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ emails: [email], permission: 'write', membership: 'member' }),
    })
  )
}

async function permissionOf(userId: string, workspaceId: string) {
  const [row] = await db
    .select({ permission: permissions.permissionType })
    .from(permissions)
    .where(
      and(
        eq(permissions.entityType, 'workspace'),
        eq(permissions.entityId, workspaceId),
        eq(permissions.userId, userId)
      )
    )
  return row?.permission ?? null
}

/** The batch route answers 200 and lists each refused email with its reason. */
async function refusalOf(response: Response) {
  expect(response.status).toBe(200)
  const body = (await response.json()) as {
    data: { successful: string[]; failed: { error: string }[] }
  }
  expect(body.data.successful).toEqual([])
  return body.data.failed[0]?.error
}

async function provision(userId: string) {
  const { id } = await insertScimUser(db, {
    connectionId,
    userId,
    active: true,
    attributes: {
      userName: emailOf(userId),
      active: true,
      displayName: 'Provisioned',
      name: { formatted: 'Provisioned' },
      emails: [{ value: emailOf(userId), primary: true, type: 'work' }],
    },
  })
  return id
}

describe('workspace invitations under a locked directory connection', () => {
  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values(
      [adminId, managedMemberId, ungroupedMemberId, managedOutsiderId].map((id) => ({
        id,
        name: 'SCIM invitation fixture',
        email: emailOf(id),
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      }))
    )
    await db.insert(organization).values({
      id: organizationId,
      name: 'SCIM invitation fixture',
      slug: organizationId,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(member).values(
      [adminId, managedMemberId, ungroupedMemberId].map((userId) => ({
        id: generateId(),
        userId,
        organizationId,
        role: 'member',
        createdAt: now,
      }))
    )
    for (const id of [unmappedWorkspaceId, mappedWorkspaceId]) {
      await insertWorkspaceFixture(db, {
        id,
        name: 'SCIM invitation fixture',
        ownerId: adminId,
        billedAccountUserId: adminId,
        organizationId,
        workspaceMode: 'organization',
      })
      await db.insert(permissions).values({
        id: generateId(),
        userId: adminId,
        entityType: 'workspace',
        entityId: id,
        permissionType: 'admin',
      })
    }
    await db.insert(scimConnection).values({
      id: connectionId,
      organizationId,
      status: 'active',
      settings: { lockManualMembership: true },
    })
    const group = await insertScimGroup(db, { connectionId, displayName: 'Mapped group' })
    await db.insert(scimGroupMapping).values({
      id: generateId(),
      groupId: group.id,
      targetKind: 'workspace',
      workspaceId: mappedWorkspaceId,
      permissionType: 'read',
    })
    await addGroupMember(db, { groupId: group.id, scimUserId: await provision(managedMemberId) })
    await provision(ungroupedMemberId)
    await provision(managedOutsiderId)
  })

  afterAll(async () => {
    const workspaceIds = [unmappedWorkspaceId, mappedWorkspaceId]
    await db.delete(invitation).where(eq(invitation.organizationId, organizationId))
    await db.delete(auditLog).where(inArray(auditLog.workspaceId, workspaceIds))
    await db.delete(scimConnection).where(eq(scimConnection.id, connectionId))
    await deleteWorkspaceFixture(db, inArray(workspace.id, workspaceIds))
    await db.delete(organization).where(eq(organization.id, organizationId))
    await db
      .delete(user)
      .where(inArray(user.id, [adminId, managedMemberId, ungroupedMemberId, managedOutsiderId]))
  })

  it('grants a provisioned member access to a workspace no group is mapped to', async () => {
    const response = await invite(unmappedWorkspaceId, emailOf(managedMemberId))

    expect(response.status).toBe(200)
    expect(await permissionOf(managedMemberId, unmappedWorkspaceId)).toBe('write')
  })

  it('refuses a manual grant on a workspace the member’s directory group is mapped to', async () => {
    const response = await invite(mappedWorkspaceId, emailOf(managedMemberId))

    expect(await refusalOf(response)).toMatch(/identity provider/)
    expect(await permissionOf(managedMemberId, mappedWorkspaceId)).toBeNull()
  })

  it('grants a mapped workspace to a provisioned member outside its mapped group', async () => {
    const response = await invite(mappedWorkspaceId, emailOf(ungroupedMemberId))

    expect(response.status).toBe(200)
    expect(await permissionOf(ungroupedMemberId, mappedWorkspaceId)).toBe('write')
  })

  it('refuses inviting a provisioned person who is not an organization member', async () => {
    const response = await invite(unmappedWorkspaceId, emailOf(managedOutsiderId))

    expect(await refusalOf(response)).toMatch(/identity provider/)
    const pending = await db
      .select({ id: invitation.id })
      .from(invitation)
      .where(eq(invitation.email, emailOf(managedOutsiderId)))
    expect(pending).toEqual([])
    expect(await permissionOf(managedOutsiderId, unmappedWorkspaceId)).toBeNull()
  })
})
