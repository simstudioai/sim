/**
 * A personal organization's chats when its owner joins a team, against real PostgreSQL and Redis,
 * with a local HTTP server standing in for the worker. Failure modes: the chats moving into the
 * team (exported by its data drain, lost when the owner leaves); the worker keeping the old scope,
 * so every later turn is refused; a run live during the join continuing under the old scope; the
 * attachments the chats name becoming unreadable, or swept away with the organization; an owner
 * without a personal workspace losing the chats; and a worker without the route dropping the move.
 */
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { afterAll, describe, expect, it, vi } from 'vitest'

const { inheritedEnv, worker } = await vi.hoisted(async () => {
  const { readTestRedisUrl } = await import('@sim/db/testing/test-infrastructure')
  const { createServer } = await import('node:http')
  const worker = {
    requests: [] as Array<{ url: string; apiKey: unknown; body: Record<string, unknown> }>,
    rescopeStatus: 200,
    /** Overrides the refusal body, as a proxy in front of the worker answers its own 404. */
    rescopeBody: null as string | null,
  }
  const server = createServer(async (request, response) => {
    let raw = ''
    for await (const chunk of request) raw += chunk
    const body = raw ? JSON.parse(raw) : {}
    worker.requests.push({ url: request.url ?? '', apiKey: request.headers['x-api-key'], body })
    response.setHeader('content-type', 'application/json')
    if (request.url === '/api/streams/explicit-abort') {
      response.writeHead(200)
      response.end(JSON.stringify({ settled: true }))
    } else if (request.url === '/api/chats/rescope' && worker.rescopeStatus === 200) {
      response.writeHead(200)
      response.end(JSON.stringify({ rescoped: body.chatIds.length }))
    } else {
      response.writeHead(request.url === '/api/chats/rescope' ? worker.rescopeStatus : 404)
      response.end(
        (request.url === '/api/chats/rescope' && worker.rescopeBody) ||
          JSON.stringify({ error: 'Not found' })
      )
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  const inheritedEnv = {
    REDIS_URL: process.env.REDIS_URL,
    SIM_AGENT_API_URL: process.env.SIM_AGENT_API_URL,
    COPILOT_API_KEY: process.env.COPILOT_API_KEY,
  }
  const redisUrl = readTestRedisUrl()
  if (redisUrl) process.env.REDIS_URL = redisUrl
  process.env.SIM_AGENT_API_URL = `http://127.0.0.1:${port}`
  process.env.COPILOT_API_KEY = 'personal-chats-fixture-key'
  return { inheritedEnv, worker: Object.assign(worker, { server }) }
})

import { db } from '@sim/db'
import {
  copilotChats,
  copilotMessages,
  copilotRequestStops,
  copilotRuns,
  member,
  organization,
  outboxEvent,
  permissions,
  project,
  uploadSession,
  user,
  userStats,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { createOrganizationWithOwner } from '@/lib/billing/organizations/create-organization'
import {
  addUserToOrganization,
  removeUserFromOrganization,
} from '@/lib/billing/organizations/membership'
import { closeRedisConnection } from '@/lib/core/config/redis'
import { processOutboxEventById } from '@/lib/core/outbox/service'
import { copilotChatsSource } from '@/lib/data-drains/sources/copilot-chats'
import { resolveOwnedChatContext } from '@/lib/mothership/chat/application/context'
import { CHAT_RESCOPE_EVENT, enqueueChatRescopeTx } from '@/lib/mothership/chat/rescope-event'
import { chatRescopeOutboxHandlers } from '@/lib/mothership/chat/rescope-outbox'
import {
  createPersonalOrganization,
  provisionPersonalOrganization,
} from '@/lib/organizations/provision-personal'
import { authorizeOrganizationChatAttachment } from '@/lib/uploads/contexts/organization-assistant/application'
import { cleanupExpiredUploadSessions } from '@/lib/uploads/upload-session/service'
import { createWorkspaceInTransaction } from '@/lib/workspaces/create'

const userIds: string[] = []
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z')

async function createUser(): Promise<string> {
  const id = `personal-chats-${generateId()}`
  const now = new Date()
  await db.insert(user).values({
    id,
    name: 'Personal Chats',
    email: `${id}@personal-chats.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(userStats).values({ id: generateId(), userId: id, storageUsedBytes: 0 })
  userIds.push(id)
  return id
}

async function personalWorkspace(userId: string, name: string): Promise<string> {
  const created = await db.transaction((tx) =>
    createWorkspaceInTransaction(tx, {
      userId,
      name,
      organizationId: null,
      observedOrganizationId: null,
      governingPermissionGroupOrganizationId: null,
      workspaceMode: 'personal',
      billedAccountUserId: userId,
      skipDefaultWorkflow: true,
    })
  )
  return created.id
}

/** A backfilled account: two personal workspaces (the first the oldest) in a personal organization. */
async function backfilledOwner() {
  const userId = await createUser()
  const oldestWorkspaceId = await personalWorkspace(userId, 'Oldest')
  await db.update(workspace).set({ createdAt: LONG_AGO }).where(eq(workspace.id, oldestWorkspaceId))
  const newerWorkspaceId = await personalWorkspace(userId, 'Newer')
  const provisioned = await provisionPersonalOrganization(userId)
  if (provisioned.status !== 'provisioned') throw new Error('expected provisioning')
  return { userId, oldestWorkspaceId, newerWorkspaceId, organizationId: provisioned.organizationId }
}

async function team(): Promise<{ teamId: string; teamOwnerId: string }> {
  const teamOwnerId = await createUser()
  const { organizationId } = await createOrganizationWithOwner({
    actor: { type: 'system', name: 'Test' },
    ownerUserId: teamOwnerId,
    name: 'Team',
    slug: `team-${generateId()}`.toLowerCase(),
  })
  return { teamId: organizationId, teamOwnerId }
}

async function organizationChat(userId: string, organizationId: string): Promise<string> {
  const [chat] = await db
    .insert(copilotChats)
    .values({
      userId,
      organizationId,
      type: 'mothership',
      title: 'Private chat',
      createdAt: LONG_AGO,
    })
    .returning({ id: copilotChats.id })
  return chat.id
}

function join(userId: string, organizationId: string) {
  return addUserToOrganization({
    actor: { type: 'system', name: 'Test' },
    userId,
    organizationId,
    role: 'member',
    skipBillingLogic: true,
    skipSeatValidation: true,
  })
}

async function chatScope(chatId: string) {
  const [row] = await db
    .select({ workspaceId: copilotChats.workspaceId, organizationId: copilotChats.organizationId })
    .from(copilotChats)
    .where(eq(copilotChats.id, chatId))
  return row
}

async function rescopeEvents(organizationId: string) {
  return db
    .select({ id: outboxEvent.id, payload: outboxEvent.payload, status: outboxEvent.status })
    .from(outboxEvent)
    .where(
      and(
        eq(outboxEvent.eventType, CHAT_RESCOPE_EVENT),
        sql`${outboxEvent.payload}->>'fromOrganizationId' = ${organizationId}`
      )
    )
}

afterAll(async () => {
  await new Promise<void>((resolve) => worker.server.close(() => resolve()))
  if (userIds.length > 0) {
    await db
      .delete(outboxEvent)
      .where(
        and(
          eq(outboxEvent.eventType, CHAT_RESCOPE_EVENT),
          inArray(sql`${outboxEvent.payload}->>'userId'`, userIds)
        )
      )
    await db.delete(uploadSession).where(inArray(uploadSession.userId, userIds))
    const workspaces = await db
      .select({ id: workspace.id, projectId: workspace.projectId })
      .from(workspace)
      .where(inArray(workspace.ownerId, userIds))
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
    const organizations = await db
      .select({ id: member.organizationId })
      .from(member)
      .where(inArray(member.userId, userIds))
    if (organizations.length > 0) {
      await db.delete(organization).where(
        inArray(
          organization.id,
          organizations.map((row) => row.id)
        )
      )
    }
    await db.delete(user).where(inArray(user.id, userIds))
  }
  await closeRedisConnection()
  for (const [key, value] of Object.entries(inheritedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('a personal organization’s chats when its owner joins a team', () => {
  it('move into the owner’s oldest personal workspace, private and out of the team’s drain, and queue the worker’s move', async () => {
    const owner = await backfilledOwner()
    const { teamId, teamOwnerId } = await team()
    const chatId = await organizationChat(owner.userId, owner.organizationId)

    expect(await join(owner.userId, teamId)).toMatchObject({ success: true })

    expect(await chatScope(chatId)).toEqual({
      workspaceId: owner.oldestWorkspaceId,
      organizationId: null,
    })
    await expect(
      resolveOwnedChatContext(createSessionPrincipal({ userId: teamOwnerId }), chatId)
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(
      await resolveOwnedChatContext(createSessionPrincipal({ userId: owner.userId }), chatId)
    ).toMatchObject({ workspaceId: owner.oldestWorkspaceId })
    const drained: string[] = []
    for await (const rows of copilotChatsSource.pages({
      organizationId: teamId,
      cursor: null,
      chunkSize: 100,
      signal: new AbortController().signal,
    }))
      drained.push(...rows.map((row) => row.id))
    expect(drained).not.toContain(chatId)
    expect((await rescopeEvents(owner.organizationId)).map((event) => event.payload)).toEqual([
      {
        userId: owner.userId,
        fromOrganizationId: owner.organizationId,
        toWorkspaceId: owner.oldestWorkspaceId,
        chatIds: [chatId],
        stoppedRuns: [],
      },
    ])
  })

  it('stop a run live during the join, then deliver its Stop and move the worker’s copy', async () => {
    const owner = await backfilledOwner()
    const { teamId } = await team()
    const chatId = await organizationChat(owner.userId, owner.organizationId)
    const runId = generateId()
    const streamId = generateId()
    await db.insert(copilotRuns).values({
      id: runId,
      executionId: generateId(),
      chatId,
      userId: owner.userId,
      streamId,
      organizationId: owner.organizationId,
      status: 'active',
    })

    expect(await join(owner.userId, teamId)).toMatchObject({ success: true })

    const [run] = await db
      .select({ workspaceId: copilotRuns.workspaceId, organizationId: copilotRuns.organizationId })
      .from(copilotRuns)
      .where(eq(copilotRuns.id, runId))
    expect(run).toEqual({ workspaceId: owner.oldestWorkspaceId, organizationId: null })
    const stops = await db
      .select({ workspaceId: copilotRequestStops.workspaceId })
      .from(copilotRequestStops)
      .where(
        and(
          eq(copilotRequestStops.userId, owner.userId),
          eq(copilotRequestStops.streamId, streamId)
        )
      )
    expect(stops).toEqual([{ workspaceId: owner.oldestWorkspaceId }])
    const [event] = await rescopeEvents(owner.organizationId)
    expect(event.payload).toMatchObject({
      stoppedRuns: [{ id: runId, streamId, userId: owner.userId, chatId, desktopDeviceId: null }],
    })

    worker.requests.length = 0
    expect(await processOutboxEventById(event.id, chatRescopeOutboxHandlers)).toBe('completed')

    expect(worker.requests.map((request) => request.url)).toEqual(
      expect.arrayContaining(['/api/streams/explicit-abort', '/api/chats/rescope'])
    )
    expect(
      worker.requests.find((request) => request.url === '/api/streams/explicit-abort')?.body
    ).toMatchObject({ messageId: streamId })
    expect(worker.requests.find((request) => request.url === '/api/chats/rescope')).toEqual({
      url: '/api/chats/rescope',
      apiKey: 'personal-chats-fixture-key',
      body: {
        chatIds: [chatId],
        from: { organizationId: owner.organizationId },
        to: { workspaceId: owner.oldestWorkspaceId },
      },
    })
  })

  it('keep the attachments they name readable by their uploader, and kept by the upload sweeper', async () => {
    const owner = await backfilledOwner()
    const { teamId, teamOwnerId } = await team()
    const chatId = await organizationChat(owner.userId, owner.organizationId)
    const sessionId = generateId()
    const key = `assistant/${owner.organizationId}/${owner.userId}/${sessionId}/notes.pdf`
    const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    await db.insert(uploadSession).values({
      id: sessionId,
      tokenHash: generateId(),
      userId: owner.userId,
      purpose: 'mothership_attachment',
      method: 'put',
      storageContext: 'mothership',
      finalKey: key,
      storageProvider: 'local',
      fileName: 'notes.pdf',
      contentType: 'application/pdf',
      fileSize: 12,
      status: 'completed',
      metadata: {
        organizationAttachment: {
          requestMode: 'agent',
          organizationId: owner.organizationId,
          userId: owner.userId,
          sessionId: 'login-session',
        },
      },
      expiresAt: longAgo,
      completedAt: longAgo,
    })
    await db.insert(copilotMessages).values({
      chatId,
      messageId: generateId(),
      role: 'user',
      content: {
        role: 'user',
        content: 'Summarize this',
        fileAttachments: [
          {
            id: sessionId,
            key,
            filename: 'notes.pdf',
            media_type: 'application/pdf',
            size: 12,
          },
        ],
      },
    })

    expect(await join(owner.userId, teamId)).toMatchObject({ success: true })

    const reader = createSessionPrincipal({ userId: owner.userId })
    expect(
      await authorizeOrganizationChatAttachment({
        principal: reader,
        workspaceId: owner.oldestWorkspaceId,
        key,
      })
    ).toMatchObject({ binding: { workspaceId: owner.oldestWorkspaceId, organizationId: null } })
    await expect(
      authorizeOrganizationChatAttachment({
        principal: reader,
        organizationId: owner.organizationId,
        key,
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    await expect(
      authorizeOrganizationChatAttachment({
        principal: createSessionPrincipal({ userId: teamOwnerId }),
        key,
      })
    ).rejects.toMatchObject({ code: 'not_found' })

    await cleanupExpiredUploadSessions()
    const kept = await db
      .select({ id: uploadSession.id })
      .from(uploadSession)
      .where(eq(uploadSession.id, sessionId))
    expect(kept).toEqual([{ id: sessionId }])
  })

  it('stay with their owner after the owner leaves the team', async () => {
    const owner = await backfilledOwner()
    const { teamId } = await team()
    const chatId = await organizationChat(owner.userId, owner.organizationId)
    expect(await join(owner.userId, teamId)).toMatchObject({ success: true })
    const [membership] = await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.userId, owner.userId), eq(member.organizationId, teamId)))

    expect(
      await removeUserFromOrganization({
        actor: { type: 'system', name: 'Test' },
        userId: owner.userId,
        organizationId: teamId,
        memberId: membership.id,
        skipBillingLogic: true,
      })
    ).toMatchObject({ success: true })

    expect(await chatScope(chatId)).toEqual({
      workspaceId: owner.oldestWorkspaceId,
      organizationId: null,
    })
    expect(
      await resolveOwnedChatContext(createSessionPrincipal({ userId: owner.userId }), chatId)
    ).toMatchObject({ workspaceId: owner.oldestWorkspaceId })
  })

  it('move into a default personal workspace created for an owner who has none', async () => {
    const userId = await createUser()
    const personalId = await createPersonalOrganization(userId)
    if (!personalId) throw new Error('expected a personal organization')
    const { teamId } = await team()
    const chatId = await organizationChat(userId, personalId)

    expect(await join(userId, teamId)).toMatchObject({ success: true })

    const scope = await chatScope(chatId)
    expect(scope.organizationId).toBeNull()
    const [created] = await db
      .select({ ownerId: workspace.ownerId, organizationId: workspace.organizationId })
      .from(workspace)
      .where(eq(workspace.id, scope.workspaceId ?? ''))
    expect(created).toEqual({ ownerId: userId, organizationId: null })
    const grants = await db
      .select({ permissionType: permissions.permissionType })
      .from(permissions)
      .where(and(eq(permissions.userId, userId), eq(permissions.entityId, scope.workspaceId ?? '')))
    expect(grants).toEqual([{ permissionType: 'admin' }])
  })
})

describe('moving the worker’s copy of moved chats', () => {
  async function queuedMove() {
    const userId = await createUser()
    const [eventId] = await db.transaction((tx) =>
      enqueueChatRescopeTx(tx, {
        userId,
        fromOrganizationId: `org_${generateId()}`,
        toWorkspaceId: generateId(),
        chatIds: [generateId()],
        stoppedRuns: [],
      })
    )
    return eventId
  }

  async function eventState(eventId: string) {
    const [row] = await db
      .select({
        status: outboxEvent.status,
        attempts: outboxEvent.attempts,
        availableAt: outboxEvent.availableAt,
      })
      .from(outboxEvent)
      .where(eq(outboxEvent.id, eventId))
    return row
  }

  it('waits, without spending an attempt, while the worker has no rescope route', async () => {
    worker.rescopeStatus = 404
    try {
      const eventId = await queuedMove()

      expect(await processOutboxEventById(eventId, chatRescopeOutboxHandlers)).toBe('pending')

      const state = await eventState(eventId)
      expect(state).toMatchObject({ status: 'pending', attempts: 0 })
      expect(state.availableAt.getTime()).toBeGreaterThan(Date.now() + 5 * 60 * 1000)
    } finally {
      worker.rescopeStatus = 200
    }
  })

  it('retries, spending an attempt, on a 404 that is not the worker’s missing route', async () => {
    worker.rescopeStatus = 404
    worker.rescopeBody = '<html><body>404 Not Found</body></html>'
    try {
      const eventId = await queuedMove()

      expect(await processOutboxEventById(eventId, chatRescopeOutboxHandlers)).toBe('pending')

      expect(await eventState(eventId)).toMatchObject({ status: 'pending', attempts: 1 })
    } finally {
      worker.rescopeStatus = 200
      worker.rescopeBody = null
    }
  })

  it('retries, spending an attempt, when the worker refuses the move', async () => {
    worker.rescopeStatus = 503
    try {
      const eventId = await queuedMove()

      expect(await processOutboxEventById(eventId, chatRescopeOutboxHandlers)).toBe('pending')

      expect(await eventState(eventId)).toMatchObject({ status: 'pending', attempts: 1 })
    } finally {
      worker.rescopeStatus = 200
    }
  })
})
