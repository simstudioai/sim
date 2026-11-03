/** Organization Chat reviewing access requests through the generic settings tool. */

import { db } from '@sim/db'
import {
  auditLog,
  copilotChats,
  member,
  organization,
  outboxEvent,
  permissionAccessRequest,
  permissionGroup,
  permissionGroupWorkspace,
  permissions,
  user,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { envFlagsMock } from '@sim/testing/mocks/env-flags.mock'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/env-flags', () => ({ ...envFlagsMock, isAccessControlEnabled: true }))

import { settingsServerTool } from '@/lib/mothership/tools/server/settings'
import { createAccessRequest } from '@/ee/access-requests/lib/application/requests'
import { PERMISSION_ACCESS_REQUEST_DECIDED_EVENT } from '@/ee/access-requests/lib/notification-events'

const organizationId = generateId()
const workspaceId = generateId()
const adminId = generateId()
const memberId = generateId()
const requesterId = generateId()
const groupId = generateId()
const chats = new Map<string, string>()
const requestIds: Record<'tables' | 'files', string> = { tables: '', files: '' }

function chatContext(userId: string) {
  const chatId = chats.get(userId)
  if (!chatId) throw new Error('Fixture chat missing')
  return {
    userId,
    organizationId,
    chatId,
    toolCallId: generateId(),
    requestMode: 'agent',
    copilotToolExecution: true,
  }
}

function asChat(userId: string) {
  return (operation: string, input: Record<string, unknown>) =>
    settingsServerTool.execute(
      { scope: 'organization', action: 'execute', section: 'requests', operation, input },
      chatContext(userId)
    ) as Promise<{ result: Record<string, unknown> }>
}

function readRequest(id: string) {
  return db
    .select({
      status: permissionAccessRequest.status,
      decidedBy: permissionAccessRequest.decidedBy,
      decisionReason: permissionAccessRequest.decisionReason,
    })
    .from(permissionAccessRequest)
    .where(eq(permissionAccessRequest.id, id))
    .then(([row]) => row)
}

async function readGroupConfig() {
  const [group] = await db
    .select({ config: permissionGroup.config })
    .from(permissionGroup)
    .where(eq(permissionGroup.id, groupId))
  return group.config
}

function decidedEvents(id: string) {
  return db
    .select({ id: outboxEvent.id })
    .from(outboxEvent)
    .where(
      and(
        eq(outboxEvent.eventType, PERMISSION_ACCESS_REQUEST_DECIDED_EVENT),
        sql`${outboxEvent.payload}->>'requestId' = ${id}`
      )
    )
}

async function waitForAudit(resourceId: string, action: string) {
  await vi.waitFor(async () => {
    const [audit] = await db
      .select({ actorId: auditLog.actorId, metadata: auditLog.metadata })
      .from(auditLog)
      .where(and(eq(auditLog.resourceId, resourceId), eq(auditLog.action, action)))
    expect(audit).toMatchObject({
      actorId: adminId,
      metadata: {
        operation: 'access_requests.resolve',
        actor: { kind: 'organization_delegated', serviceId: 'copilot', subjectUserId: adminId },
      },
    })
  })
}

describe('organization Chat review of access requests', () => {
  beforeAll(async () => {
    const now = new Date()
    const people = [adminId, memberId, requesterId]
    await db.insert(user).values(
      people.map((id) => ({
        id,
        name: 'Access review fixture',
        email: `${id}@access-review.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      }))
    )
    await db.insert(organization).values({
      id: organizationId,
      name: 'Access review fixture',
      slug: organizationId,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(member).values(
      people.map((userId) => ({
        id: generateId(),
        userId,
        organizationId,
        role: userId === adminId ? 'admin' : 'member',
        createdAt: now,
      }))
    )
    await insertWorkspaceFixture(db, [
      {
        id: workspaceId,
        name: 'Access review fixture',
        ownerId: adminId,
        billedAccountUserId: adminId,
        organizationId,
        workspaceMode: 'organization' as const,
      },
    ])
    await db.insert(permissions).values({
      id: generateId(),
      userId: requesterId,
      entityType: 'workspace',
      entityId: workspaceId,
      permissionType: 'write' as const,
    })
    await db.insert(permissionGroup).values({
      id: groupId,
      organizationId,
      name: 'Tables and files withheld',
      createdBy: adminId,
      config: { hideTablesTab: true, hideFilesTab: true },
    })
    await db.insert(permissionGroupWorkspace).values({
      id: generateId(),
      permissionGroupId: groupId,
      workspaceId,
      organizationId,
    })
    for (const userId of [adminId, memberId]) {
      const [chat] = await db
        .insert(copilotChats)
        .values({
          userId,
          organizationId,
          type: 'mothership',
          config: { conversationMode: 'agent' },
          model: 'fixture-model',
        })
        .returning({ id: copilotChats.id })
      chats.set(userId, chat.id)
    }
    const requester = { kind: 'session', userId: requesterId, sessionId: 'fixture' } as const
    for (const [key, configKey] of [
      ['tables', 'hideTablesTab'],
      ['files', 'hideFilesTab'],
    ] as const) {
      const { request } = await createAccessRequest.execute({
        principal: requester,
        input: {
          scope: { kind: 'workspace', workspaceId },
          target: { kind: 'feature', configKey },
          reason: 'Need it for a report',
        },
      })
      requestIds[key] = request.id
    }
  })

  afterAll(async () => {
    const ids = Object.values(requestIds)
    await db.delete(outboxEvent).where(inArray(sql`${outboxEvent.payload}->>'requestId'`, ids))
    await db
      .delete(permissionAccessRequest)
      .where(eq(permissionAccessRequest.organizationId, organizationId))
    await db.delete(auditLog).where(inArray(auditLog.resourceId, [...ids, groupId]))
    await db.delete(copilotChats).where(eq(copilotChats.organizationId, organizationId))
    await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
    await db.delete(organization).where(eq(organization.id, organizationId))
    await db.delete(user).where(inArray(user.id, [adminId, memberId, requesterId]))
  })

  it("refuses a non-admin member's Chat every review operation", async () => {
    const asMember = asChat(memberId)
    const fingerprint = 'f'.repeat(64)

    await expect(asMember('list', {})).rejects.toMatchObject({ code: 'forbidden' })
    await expect(asMember('preview', { requestId: requestIds.tables })).rejects.toMatchObject({
      code: 'forbidden',
    })
    await expect(
      asMember('approve', { requestId: requestIds.tables, expectedFingerprint: fingerprint })
    ).rejects.toMatchObject({ code: 'forbidden' })
    await expect(
      asMember('deny', { requestId: requestIds.files, reason: 'No' })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(await readRequest(requestIds.tables)).toMatchObject({ status: 'pending' })
    expect(await readRequest(requestIds.files)).toMatchObject({ status: 'pending' })
    expect(await readGroupConfig()).toMatchObject({ hideTablesTab: true, hideFilesTab: true })
  })

  it("lets an admin's Chat list, preview and approve a request, granting it", async () => {
    const asAdmin = asChat(adminId)

    const section = (await settingsServerTool.execute(
      { scope: 'organization', action: 'get', section: 'requests' },
      chatContext(adminId)
    )) as { value: { requests: { id: string; status: string }[] } }
    expect(section.value.requests.map(({ id }) => id).sort()).toEqual(
      Object.values(requestIds).sort()
    )

    const { result: preview } = await asAdmin('preview', { requestId: requestIds.tables })
    expect(preview).toMatchObject({ canApply: true, resolutionKind: 'permission' })

    const { result } = await asAdmin('approve', {
      requestId: requestIds.tables,
      expectedFingerprint: preview.fingerprint,
    })

    expect(result).toMatchObject({ changed: true, request: { status: 'fulfilled' } })
    expect(await readRequest(requestIds.tables)).toMatchObject({
      status: 'fulfilled',
      decidedBy: adminId,
    })
    expect(await readGroupConfig()).toMatchObject({ hideTablesTab: false, hideFilesTab: true })
    expect(await decidedEvents(requestIds.tables)).toHaveLength(1)
    await waitForAudit(requestIds.tables, 'permission_access_request.fulfilled')
  })

  it("lets an admin's Chat deny a request with a reason, changing no policy", async () => {
    const { result } = await asChat(adminId)('deny', {
      requestId: requestIds.files,
      reason: 'Files stay restricted this quarter',
    })

    expect(result).toMatchObject({ changed: true, request: { status: 'declined' } })
    expect(await readRequest(requestIds.files)).toEqual({
      status: 'declined',
      decidedBy: adminId,
      decisionReason: 'Files stay restricted this quarter',
    })
    expect(await readGroupConfig()).toMatchObject({ hideTablesTab: false, hideFilesTab: true })
    expect(await decidedEvents(requestIds.files)).toHaveLength(1)
    await waitForAudit(requestIds.files, 'permission_access_request.declined')
  })
})
