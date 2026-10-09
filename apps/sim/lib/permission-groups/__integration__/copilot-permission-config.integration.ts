/** Chat's in-process CLI reading the delegating member's own permission-group restrictions. */

import { db } from '@sim/db'
import {
  member,
  organization,
  permissionGroup,
  permissionGroupMember,
  permissionGroupWorkspace,
  permissions,
  user,
  workspace,
} from '@sim/db/schema'
import { envFlagsMock } from '@sim/testing/mocks/env-flags.mock'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/env-flags', () => ({ ...envFlagsMock, isAccessControlEnabled: true }))

import { withWorkspaceInvocationScope } from '@/lib/core/application/workspace-invocation-scope'
import { createScopedCliTransport } from '@/lib/mothership/agent-cli/scoped-transport'
import '@/app/api/v2/workspaces/[workspaceId]/permission-config/route'

const ORIGIN = 'http://localhost:3000'
const organizationId = generateId()
const workspaceId = generateId()
const otherWorkspaceId = generateId()
const restrictedId = generateId()
const defaultMemberId = generateId()
const outsiderId = generateId()
const restrictedGroupId = generateId()
const defaultGroupId = generateId()

function readConfigFromChat(userId: string, chatWorkspaceId = workspaceId) {
  const transport = createScopedCliTransport(ORIGIN, {
    userId,
    workspaceId: chatWorkspaceId,
    chatId: generateId(),
  })
  return withWorkspaceInvocationScope({ workspaceId: chatWorkspaceId, organizationId }, () =>
    transport(`${ORIGIN}/api/v2/workspaces/${workspaceId}/permission-config`)
  )
}

describe('chat-delegated permission configuration', () => {
  beforeAll(async () => {
    const now = new Date()
    const userIds = [restrictedId, defaultMemberId, outsiderId]
    await db.insert(user).values(
      userIds.map((id) => ({
        id,
        name: 'Permission config fixture',
        email: `${id}@permission-config.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      }))
    )
    await db.insert(organization).values({
      id: organizationId,
      name: 'Permission config fixture',
      slug: organizationId,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(member).values(
      userIds.map((userId) => ({
        id: generateId(),
        userId,
        organizationId,
        role: 'member',
        createdAt: now,
      }))
    )
    await db.insert(workspace).values(
      [workspaceId, otherWorkspaceId].map((id) => ({
        id,
        name: 'Permission config fixture',
        ownerId: restrictedId,
        billedAccountUserId: restrictedId,
        organizationId,
        workspaceMode: 'organization' as const,
      }))
    )
    await db.insert(permissions).values([
      ...[restrictedId, defaultMemberId].map((userId) => ({
        id: generateId(),
        userId,
        entityType: 'workspace',
        entityId: workspaceId,
        permissionType: 'read' as const,
      })),
      {
        id: generateId(),
        userId: outsiderId,
        entityType: 'workspace',
        entityId: otherWorkspaceId,
        permissionType: 'admin' as const,
      },
    ])
    await db.insert(permissionGroup).values([
      {
        id: defaultGroupId,
        organizationId,
        name: 'Everyone',
        createdBy: restrictedId,
        isDefault: true,
        config: {},
      },
      {
        id: restrictedGroupId,
        organizationId,
        name: 'Contractors',
        createdBy: restrictedId,
        config: { disableInvitations: true },
      },
    ])
    await db.insert(permissionGroupWorkspace).values({
      id: generateId(),
      permissionGroupId: restrictedGroupId,
      workspaceId,
      organizationId,
    })
    await db.insert(permissionGroupMember).values({
      id: generateId(),
      permissionGroupId: restrictedGroupId,
      organizationId,
      userId: restrictedId,
    })
  })

  afterAll(async () => {
    await db.delete(workspace).where(inArray(workspace.id, [workspaceId, otherWorkspaceId]))
    await db.delete(organization).where(eq(organization.id, organizationId))
    await db.delete(user).where(inArray(user.id, [restrictedId, defaultMemberId, outsiderId]))
  })

  it("answers with the delegating member's own group", async () => {
    const restricted = await readConfigFromChat(restrictedId)
    expect(restricted.status).toBe(200)
    expect(await restricted.json()).toMatchObject({
      data: {
        permissionGroupId: restrictedGroupId,
        groupName: 'Contractors',
        config: { disableInvitations: true },
        entitled: true,
        organizationId,
        isOrgAdmin: false,
      },
    })

    const unrestricted = await readConfigFromChat(defaultMemberId)
    expect(unrestricted.status).toBe(200)
    expect(await unrestricted.json()).toMatchObject({
      data: {
        permissionGroupId: defaultGroupId,
        groupName: 'Everyone',
        config: { disableInvitations: false },
      },
    })
  })

  it('refuses a chat pinned to another workspace', async () => {
    const response = await readConfigFromChat(outsiderId, otherWorkspaceId)

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({
      error: { code: 'NOT_FOUND', message: 'Resource not found in the selected workspace' },
    })
  })

  it('refuses a delegating user who holds no role in the workspace', async () => {
    const response = await readConfigFromChat(outsiderId)

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({
      error: { code: 'NOT_FOUND', message: 'Workspace not found' },
    })
  })
})
