import { db } from '@sim/db'
import {
  copilotChats,
  member,
  organization,
  permissionGroup,
  permissionGroupWorkspace,
  permissions,
  project,
  user,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import {
  createTrustedCopilotPrincipal,
  createTrustedOrganizationCopilotPrincipal,
} from '@/lib/mothership/auth/application-delegation'
import { MemoryNotesAccessResult } from '@/lib/mothership/generated/memory-notes-access'
import {
  MEMORY_NOTES_ACCESS_AUDIENCE,
  resolveMemoryNotesAccess,
} from '@/lib/mothership/memories/application/resolve-access'
import { executeSimControl } from '@/lib/mothership/transport/control'
import { lockProject, splitForkProject } from '@/lib/projects/membership'
import { POST } from '@/app/api/mothership/memories/access/route'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)

beforeEach(() => {
  featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(async (flag) => flag === 'projects')
})

const actorId = generateId()
const payerId = generateId()
const organizationId = generateId()
const projectId = generateId()
const workspaceId = generateId()
const siblingId = generateId()
const workspaceChatId = generateId()
const organizationChatId = generateId()

function principal(organizationChat = false) {
  const options = { audience: MEMORY_NOTES_ACCESS_AUDIENCE, ttlMs: 60_000 }
  return organizationChat
    ? createTrustedOrganizationCopilotPrincipal(
        { userId: actorId, organizationId, chatId: organizationChatId, delegationId: generateId() },
        options
      )
    : createTrustedCopilotPrincipal(
        { userId: actorId, workspaceId, chatId: workspaceChatId, delegationId: generateId() },
        options
      )
}

beforeAll(async () => {
  await db.insert(user).values(
    [actorId, payerId].map((id) => ({
      id,
      name: 'Memory access fixture',
      email: `${id}@memory.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
  )
  await db.insert(organization).values({
    id: organizationId,
    name: 'Memory fixture',
    slug: organizationId,
    createdAt: new Date(),
  })
  await db.insert(member).values([
    { id: generateId(), organizationId, userId: payerId, role: 'owner', createdAt: new Date() },
    { id: generateId(), organizationId, userId: actorId, role: 'member', createdAt: new Date() },
  ])
  await insertWorkspaceFixture(
    db,
    [workspaceId, siblingId].map((id) => ({
      id,
      name: 'Environment',
      ownerId: payerId,
      billedAccountUserId: payerId,
      organizationId,
      workspaceMode: 'organization' as const,
      projectId,
    }))
  )
  await db.insert(permissions).values({
    id: generateId(),
    userId: actorId,
    entityType: 'workspace',
    entityId: workspaceId,
    permissionType: 'read',
  })
  await db.insert(copilotChats).values([
    {
      id: workspaceChatId,
      userId: actorId,
      workspaceId,
      type: 'mothership',
      config: { conversationMode: 'agent' },
    },
    {
      id: organizationChatId,
      userId: actorId,
      organizationId,
      type: 'mothership',
      config: { conversationMode: 'agent' },
    },
  ])
})

afterAll(async () => {
  await db
    .delete(copilotChats)
    .where(inArray(copilotChats.id, [workspaceChatId, organizationChatId]))
  await deleteWorkspaceFixture(db, inArray(workspace.id, [workspaceId, siblingId]))
  await db.delete(project).where(eq(project.id, projectId))
  await db.delete(organization).where(eq(organization.id, organizationId))
  await db.delete(user).where(inArray(user.id, [actorId, payerId]))
  await db.$client.end()
})

it('denies every Project memory action on both transports when projects is disabled', async () => {
  featureFlagsMockFns.mockIsFeatureEnabled.mockResolvedValue(false)
  for (const organizationChat of [false, true]) {
    const chatId = organizationChat ? organizationChatId : workspaceChatId
    for (const action of ['read', 'private_mutation', 'shared_mutation'] as const) {
      const input = { target: { scope: 'project' as const, projectId }, action }
      const response = await POST(
        new NextRequest('http://localhost/api/mothership/memories/access', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': 'isolated-integration-fixture-internal-secret',
            'x-mothership-user-id': actorId,
            'x-mothership-chat-id': chatId,
            ...(organizationChat
              ? { 'x-mothership-organization-id': organizationId }
              : { 'x-mothership-workspace-id': workspaceId }),
          },
          body: JSON.stringify(input),
        })
      )
      expect(response.status).toBe(503)
      const checkpoint = await executeSimControl({
        id: generateId(),
        expiresAt: Date.now() + 60_000,
        scope: {
          userId: actorId,
          chatId,
          ...(organizationChat ? { organizationId } : { workspaceId }),
        },
        operation: { kind: 'memory_notes_access', input },
      })
      expect(checkpoint.status).toBe(503)
      expect(JSON.parse(checkpoint.body)).toEqual({
        error: 'Projects are not enabled on this deployment',
      })
    }
  }
})

it('keeps personal and workspace memories usable without Project context when projects is disabled', async () => {
  featureFlagsMockFns.mockIsFeatureEnabled.mockResolvedValue(false)
  for (const organizationChat of [false, true]) {
    for (const action of ['read', 'private_mutation'] as const) {
      const personal = await resolveMemoryNotesAccess.execute({
        principal: principal(organizationChat),
        input: { target: { scope: 'personal' }, action },
      })
      expect(personal.target).toEqual({
        scope: 'personal',
        permissions: { read: true, privateMutation: true, sharedMutation: false },
      })
      const result = await resolveMemoryNotesAccess.execute({
        principal: principal(organizationChat),
        input: { target: { scope: 'workspace', workspaceId }, action },
      })
      expect(MemoryNotesAccessResult.parse(result).target).toEqual({
        scope: 'workspace',
        id: workspaceId,
        name: 'Environment',
        permissions: { read: true, privateMutation: true, sharedMutation: false },
        currentProject: null,
      })
    }
    await expect(
      resolveMemoryNotesAccess.execute({
        principal: principal(organizationChat),
        input: { target: { scope: 'workspace', workspaceId }, action: 'shared_mutation' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
  }
  await db
    .update(permissions)
    .set({ permissionType: 'write' })
    .where(and(eq(permissions.userId, actorId), eq(permissions.entityId, workspaceId)))
  try {
    for (const organizationChat of [false, true]) {
      const result = await resolveMemoryNotesAccess.execute({
        principal: principal(organizationChat),
        input: { target: { scope: 'workspace', workspaceId }, action: 'shared_mutation' },
      })
      expect(result.target).toMatchObject({
        currentProject: null,
        permissions: { sharedMutation: true },
      })
    }
  } finally {
    await db
      .update(permissions)
      .set({ permissionType: 'read' })
      .where(and(eq(permissions.userId, actorId), eq(permissions.entityId, workspaceId)))
  }
})

it('lets a read-only end user mutate private notes through either chat and keeps Project shared writes denied', async () => {
  for (const organizationChat of [false, true]) {
    const result = await resolveMemoryNotesAccess.execute({
      principal: principal(organizationChat),
      input: { target: { scope: 'workspace', workspaceId }, action: 'private_mutation' },
    })
    expect(result.actor.userId).toBe(actorId)
    expect(result.target).toMatchObject({
      scope: 'workspace',
      id: workspaceId,
      permissions: { privateMutation: true, sharedMutation: false },
      currentProject: { id: projectId, permissions: { read: true, sharedMutation: false } },
    })
    await expect(
      resolveMemoryNotesAccess.execute({
        principal: principal(organizationChat),
        input: { target: { scope: 'project', projectId }, action: 'shared_mutation' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
  }
})

it('resolves overlapping workspace checks that share one Project without deadlocking', async () => {
  const results = await Promise.all(
    Array.from({ length: 6 }, (_, index) =>
      resolveMemoryNotesAccess.execute({
        principal: principal(index % 2 === 1),
        input: { target: { scope: 'workspace', workspaceId }, action: 'read' },
      })
    )
  )
  for (const result of results)
    expect(result.target).toMatchObject({ scope: 'workspace', currentProject: { id: projectId } })
})

it('answers while a writer holds the account row and the Project exclusively', async () => {
  let release = () => {}
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  let held = () => {}
  const holding = new Promise<void>((resolve) => {
    held = resolve
  })
  const writer = db.transaction(async (tx) => {
    await tx.select({ id: user.id }).from(user).where(eq(user.id, actorId)).for('update')
    await lockProject(tx, projectId)
    held()
    await released
  })
  await holding
  try {
    for (const organizationChat of [false, true]) {
      const result = await Promise.race([
        resolveMemoryNotesAccess.execute({
          principal: principal(organizationChat),
          input: { target: { scope: 'workspace', workspaceId }, action: 'read' },
        }),
        sleep(2_000).then(() => {
          throw new Error('Memory access waited on a writer')
        }),
      ])
      expect(result.target).toMatchObject({ currentProject: { id: projectId } })
    }
  } finally {
    release()
    await writer
  }
})

it('does not turn write in one environment into shared Project write', async () => {
  await db
    .update(permissions)
    .set({ permissionType: 'write' })
    .where(and(eq(permissions.userId, actorId), eq(permissions.entityId, workspaceId)))
  try {
    const result = await resolveMemoryNotesAccess.execute({
      principal: principal(),
      input: { target: { scope: 'workspace', workspaceId }, action: 'shared_mutation' },
    })
    expect(result.target).toMatchObject({
      permissions: { sharedMutation: true },
      currentProject: { permissions: { sharedMutation: false } },
    })
    await db.insert(permissions).values({
      id: generateId(),
      userId: actorId,
      entityType: 'workspace',
      entityId: siblingId,
      permissionType: 'write',
    })
    const shared = await resolveMemoryNotesAccess.execute({
      principal: principal(true),
      input: { target: { scope: 'project', projectId }, action: 'shared_mutation' },
    })
    expect(shared.target.permissions.sharedMutation).toBe(true)
  } finally {
    await db
      .delete(permissions)
      .where(and(eq(permissions.userId, actorId), eq(permissions.entityId, siblingId)))
    await db
      .update(permissions)
      .set({ permissionType: 'read' })
      .where(and(eq(permissions.userId, actorId), eq(permissions.entityId, workspaceId)))
  }
})

it('rejects wrong actor, audience, expired delegation and another workspace target', async () => {
  const input = { target: { scope: 'workspace' as const, workspaceId }, action: 'read' as const }
  for (const altered of [
    { ...principal(), subjectUserId: payerId },
    { ...principal(), audience: 'sim:workspaces' },
    { ...principal(), expiresAt: new Date(0) },
  ])
    await expect(
      resolveMemoryNotesAccess.execute({ principal: altered, input })
    ).rejects.toBeInstanceOf(Error)
  await expect(
    resolveMemoryNotesAccess.execute({
      principal: principal(),
      input: { ...input, target: { scope: 'workspace', workspaceId: siblingId } },
    })
  ).rejects.toMatchObject({ code: 'not_found' })
})

it('denies a lost scoped grant while personal-only organization context remains usable', async () => {
  await db
    .delete(permissions)
    .where(and(eq(permissions.userId, actorId), eq(permissions.entityId, workspaceId)))
  try {
    await expect(
      resolveMemoryNotesAccess.execute({
        principal: principal(true),
        input: { target: { scope: 'project', projectId }, action: 'private_mutation' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    const result = await resolveMemoryNotesAccess.execute({
      principal: principal(true),
      input: { target: { scope: 'personal' }, action: 'private_mutation' },
    })
    expect(result.actor.userId).toBe(actorId)
    expect(result.target.scope).toBe('personal')
  } finally {
    await db.insert(permissions).values({
      id: generateId(),
      userId: actorId,
      entityType: 'workspace',
      entityId: workspaceId,
      permissionType: 'read',
    })
  }
})

it('applies the Files capability to shared Project writes without blocking private notes', async () => {
  const groupId = generateId()
  await db
    .update(permissions)
    .set({ permissionType: 'write' })
    .where(and(eq(permissions.userId, actorId), eq(permissions.entityId, workspaceId)))
  await db.insert(permissions).values({
    id: generateId(),
    userId: actorId,
    entityType: 'workspace',
    entityId: siblingId,
    permissionType: 'write',
  })
  await db.insert(permissionGroup).values({
    id: groupId,
    organizationId,
    createdBy: payerId,
    name: 'Files denied',
    config: { hideFilesTab: true },
    membershipMode: 'inherit',
  })
  await db.insert(permissionGroupWorkspace).values({
    id: generateId(),
    permissionGroupId: groupId,
    workspaceId: siblingId,
    organizationId,
  })
  try {
    const result = await resolveMemoryNotesAccess.execute({
      principal: principal(true),
      input: { target: { scope: 'project', projectId }, action: 'private_mutation' },
    })
    expect(result.target.permissions).toEqual({
      read: true,
      privateMutation: true,
      sharedMutation: false,
    })
    await expect(
      resolveMemoryNotesAccess.execute({
        principal: principal(true),
        input: { target: { scope: 'project', projectId }, action: 'shared_mutation' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
  } finally {
    await db.delete(permissionGroup).where(eq(permissionGroup.id, groupId))
    await db
      .delete(permissions)
      .where(and(eq(permissions.userId, actorId), eq(permissions.entityId, siblingId)))
    await db
      .update(permissions)
      .set({ permissionType: 'read' })
      .where(and(eq(permissions.userId, actorId), eq(permissions.entityId, workspaceId)))
  }
})

it('rejects cross-organization authority and organization non-agent mode', async () => {
  const otherId = generateId()
  await db
    .insert(organization)
    .values({ id: otherId, name: 'Other organization', slug: otherId, createdAt: new Date() })
  await db.update(member).set({ organizationId: otherId }).where(eq(member.userId, actorId))
  await db
    .update(copilotChats)
    .set({ organizationId: otherId })
    .where(eq(copilotChats.id, organizationChatId))
  try {
    const otherPrincipal = { ...principal(true), organizationId: otherId }
    await expect(
      resolveMemoryNotesAccess.execute({
        principal: otherPrincipal,
        input: { target: { scope: 'project', projectId }, action: 'read' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    await expect(
      resolveMemoryNotesAccess.execute({
        principal: otherPrincipal,
        input: { target: { scope: 'workspace', workspaceId }, action: 'read' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
  } finally {
    await db
      .update(copilotChats)
      .set({ organizationId })
      .where(eq(copilotChats.id, organizationChatId))
    await db.update(member).set({ organizationId }).where(eq(member.userId, actorId))
    await db.delete(organization).where(eq(organization.id, otherId))
  }
  await db
    .update(copilotChats)
    .set({ config: { conversationMode: 'assistant' } })
    .where(eq(copilotChats.id, organizationChatId))
  try {
    await expect(
      resolveMemoryNotesAccess.execute({
        principal: principal(true),
        input: { target: { scope: 'project', projectId }, action: 'read' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
  } finally {
    await db
      .update(copilotChats)
      .set({ config: { conversationMode: 'agent' } })
      .where(eq(copilotChats.id, organizationChatId))
  }
})

it('serves the typed route using authenticated headers and rejects body identity overrides', async () => {
  const input = { target: { scope: 'workspace', workspaceId }, action: 'private_mutation' }
  const request = (body: unknown, authenticated = true) =>
    new NextRequest('http://localhost/api/mothership/memories/access', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(authenticated ? { 'x-api-key': 'isolated-integration-fixture-internal-secret' } : {}),
        'x-mothership-user-id': actorId,
        'x-mothership-workspace-id': workspaceId,
        'x-mothership-chat-id': workspaceChatId,
      },
      body: JSON.stringify(body),
    })
  expect((await POST(request(input, false))).status).toBe(401)
  expect((await POST(request({ ...input, userId: payerId }))).status).toBe(400)
  expect(
    (await POST(request({ ...input, target: { scope: 'workspace', workspaceId, projectId } })))
      .status
  ).toBe(400)
  for (const projectsEnabled of [true, false, true]) {
    featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(
      async (flag) => flag === 'projects' && projectsEnabled
    )
    const response = await POST(request(input))
    expect(response.status).toBe(200)
    expect(MemoryNotesAccessResult.parse(await response.json())).toMatchObject({
      success: true,
      version: 1,
      actor: { userId: actorId, chatId: workspaceChatId },
      target: { currentProject: projectsEnabled ? { id: projectId } : null },
    })
  }
})

it('resolves detach to the new Project and rejects the former Project from the workspace chat', async () => {
  const detachedProject = await db.transaction(async (tx) => {
    const id = await splitForkProject(tx, workspaceId)
    await tx
      .update(workspace)
      .set({ forkedFromWorkspaceId: null })
      .where(eq(workspace.id, workspaceId))
    return id
  })
  try {
    const result = await resolveMemoryNotesAccess.execute({
      principal: principal(),
      input: { target: { scope: 'workspace', workspaceId }, action: 'read' },
    })
    expect(result.target).toMatchObject({ currentProject: { id: detachedProject } })
    await expect(
      resolveMemoryNotesAccess.execute({
        principal: principal(),
        input: { target: { scope: 'project', projectId }, action: 'read' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
  } finally {
    await db.transaction(async (tx) => {
      await tx.update(workspace).set({ projectId }).where(eq(workspace.id, workspaceId))
      await tx.delete(project).where(eq(project.id, detachedProject))
    })
  }
})

it('uses identical current authority over checkpoint transport for workspace and organization chats', async () => {
  for (const [organizationChat, projectsEnabled] of [
    [false, true],
    [false, false],
    [true, true],
    [true, false],
  ]) {
    featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(
      async (flag) => flag === 'projects' && projectsEnabled
    )
    const scope = {
      userId: actorId,
      chatId: organizationChat ? organizationChatId : workspaceChatId,
      ...(organizationChat ? { organizationId } : { workspaceId }),
    }
    const result = await executeSimControl({
      id: generateId(),
      expiresAt: Date.now() + 60_000,
      scope,
      operation: {
        kind: 'memory_notes_access',
        input: { target: { scope: 'workspace', workspaceId }, action: 'private_mutation' },
      },
    })
    expect(result.status).toBe(200)
    expect(MemoryNotesAccessResult.parse(JSON.parse(result.body))).toMatchObject({
      actor: { userId: actorId, chatId: scope.chatId },
      target: { id: workspaceId, currentProject: projectsEnabled ? { id: projectId } : null },
    })
    const denied = await executeSimControl({
      id: generateId(),
      expiresAt: Date.now() + 60_000,
      scope,
      operation: {
        kind: 'memory_notes_access',
        input: { target: { scope: 'project', projectId }, action: 'shared_mutation' },
      },
    })
    expect(denied.status).toBe(projectsEnabled ? 403 : 503)
  }
})
