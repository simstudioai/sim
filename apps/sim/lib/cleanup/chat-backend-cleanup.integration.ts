/**
 * Deleting an account, or its user row directly through `/admin/remove-user`, cascades
 * `copilot_chats` rows away; the copilot backend keeps its own copy of each chat, so every chat the
 * cascade erases must reach `POST /api/tasks/cleanup`, and no surviving chat may. Runs the
 * production removal paths against real PostgreSQL and a local copilot backend fixture.
 */
import { createServer } from 'node:http'
import { db } from '@sim/db'
import {
  copilotChats,
  outboxEvent,
  permissions,
  project,
  user,
  workflow,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import { toRecord } from '@sim/utils/object'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const userIds: string[] = []
const workspaceIds: string[] = []
const projectIds: string[] = []
const purged: string[][] = []
const server = createServer(async (req, res) => {
  let body = ''
  for await (const chunk of req) body += chunk
  const chatIds = toRecord(JSON.parse(body)).chatIds
  if (Array.isArray(chatIds)) purged.push(chatIds.map(String))
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ deleted: Array.isArray(chatIds) ? chatIds.length : 0 }))
})
let runtime: {
  deletion: typeof import('@/lib/users/account-deletion')
  adminRemoval: typeof import('@/lib/auth/admin-removal-chat-cleanup')
  handlers: typeof import('@/lib/cleanup/chat-backend-cleanup-outbox')
  outbox: typeof import('@/lib/core/outbox/service')
  event: typeof import('@/lib/cleanup/chat-backend-cleanup-event')
}

async function seedUser() {
  const id = generateId()
  userIds.push(id)
  await db.insert(user).values({
    id,
    name: 'Chat cleanup fixture',
    email: `${id}@chat-cleanup.test`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  return id
}

async function seedWorkspace(ownerId: string, writers: string[] = []) {
  const id = generateId()
  const projectId = generateId()
  workspaceIds.push(id)
  projectIds.push(projectId)
  await insertWorkspaceFixture(db, {
    id,
    projectId,
    name: 'Chat cleanup fixture',
    ownerId,
    billedAccountUserId: ownerId,
  })
  await db.insert(permissions).values(
    [ownerId, ...writers].map((userId) => ({
      id: generateId(),
      userId,
      entityType: 'workspace',
      entityId: id,
      permissionType: userId === ownerId ? ('admin' as const) : ('write' as const),
    }))
  )
  return id
}

async function seedWorkflow(userId: string, workspaceId: string) {
  const id = generateId()
  const now = new Date()
  await db.insert(workflow).values({
    id,
    userId,
    workspaceId,
    name: `Chat cleanup fixture ${id}`,
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
  return id
}

async function seedChat(userId: string, workspaceId: string, workflowId?: string) {
  const [chat] = await db
    .insert(copilotChats)
    .values({ userId, workspaceId, workflowId, type: 'copilot' })
    .returning({ id: copilotChats.id })
  return chat.id
}

/** Delivers every queued chat cleanup the way the outbox worker does; returns the chat ids purged. */
async function runOutboxWorker() {
  const events = await db
    .select({ id: outboxEvent.id })
    .from(outboxEvent)
    .where(eq(outboxEvent.eventType, runtime.event.CHAT_BACKEND_CLEANUP_EVENT))
  purged.length = 0
  for (const { id } of events) {
    expect(
      await runtime.outbox.processOutboxEventById(
        id,
        runtime.handlers.chatBackendCleanupOutboxHandlers
      )
    ).toBe('completed')
  }
  await db.delete(outboxEvent).where(
    inArray(
      outboxEvent.id,
      events.map(({ id }) => id)
    )
  )
  return new Set(purged.flat())
}

async function existingChats(chatIds: string[]) {
  const rows = await db
    .select({ id: copilotChats.id })
    .from(copilotChats)
    .where(inArray(copilotChats.id, chatIds))
  return new Set(rows.map(({ id }) => id))
}

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  process.env.SIM_AGENT_API_URL = `http://127.0.0.1:${address.port}`
  process.env.COPILOT_API_KEY = 'chat-cleanup-fixture-key'
  const [deletion, adminRemoval, handlers, outbox, event] = await Promise.all([
    import('@/lib/users/account-deletion'),
    import('@/lib/auth/admin-removal-chat-cleanup'),
    import('@/lib/cleanup/chat-backend-cleanup-outbox'),
    import('@/lib/core/outbox/service'),
    import('@/lib/cleanup/chat-backend-cleanup-event'),
  ])
  runtime = { deletion, adminRemoval, handlers, outbox, event }
}, 60_000)

afterAll(async () => {
  await db
    .delete(outboxEvent)
    .where(eq(outboxEvent.eventType, runtime.event.CHAT_BACKEND_CLEANUP_EVENT))
  await deleteWorkspaceFixture(db, inArray(workspace.id, workspaceIds))
  await db.delete(project).where(inArray(project.id, projectIds))
  await db.delete(permissions).where(inArray(permissions.userId, userIds))
  await db.delete(user).where(inArray(user.id, userIds))
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
})

describe('copilot backend cleanup of chats a removal cascades away', () => {
  it('purges the chats an account deletion erases, and only those', async () => {
    const departingId = await seedUser()
    const bystanderId = await seedUser()
    const doomedWorkspaceId = await seedWorkspace(departingId)
    const keptWorkspaceId = await seedWorkspace(bystanderId)
    /** Chats outlive their author's membership: both were written by a member who since left. */
    const ownChatElsewhere = await seedChat(departingId, keptWorkspaceId)
    const formerMembersChat = await seedChat(bystanderId, doomedWorkspaceId)
    const bystandersChat = await seedChat(bystanderId, keptWorkspaceId)

    await runtime.deletion.deleteUserAccount(departingId, { recordIdentity: false })

    expect(await existingChats([ownChatElsewhere, formerMembersChat, bystandersChat])).toEqual(
      new Set([bystandersChat])
    )
    expect(await runOutboxWorker()).toEqual(new Set([ownChatElsewhere, formerMembersChat]))
  })

  /** Drives the handlers Better Auth runs as the user delete's hooks around its bare delete. */
  it('purges the chats a direct user delete erases, and only those', async () => {
    const removedId = await seedUser()
    const bystanderId = await seedUser()
    const sharedWorkspaceId = await seedWorkspace(bystanderId, [removedId])
    const ownChat = await seedChat(removedId, sharedWorkspaceId)
    const chatOnRemovedUsersWorkflow = await seedChat(
      bystanderId,
      sharedWorkspaceId,
      await seedWorkflow(removedId, sharedWorkspaceId)
    )
    const bystandersChat = await seedChat(
      bystanderId,
      sharedWorkspaceId,
      await seedWorkflow(bystanderId, sharedWorkspaceId)
    )

    const removed = { id: removedId }
    await runtime.adminRemoval.holdAdminRemovedChats(removed)
    await db.delete(user).where(eq(user.id, removedId))
    await runtime.adminRemoval.enqueueAdminRemovedChatCleanup(removed)

    expect(await existingChats([ownChat, chatOnRemovedUsersWorkflow, bystandersChat])).toEqual(
      new Set([bystandersChat])
    )
    expect(await runOutboxWorker()).toEqual(new Set([ownChat, chatOnRemovedUsersWorkflow]))
  })

  it('leaves the backend data of a chat whose delete rolled back', async () => {
    const ownerId = await seedUser()
    const workspaceId = await seedWorkspace(ownerId)
    const chatId = await seedChat(ownerId, workspaceId)
    const { enqueueChatBackendCleanup } = await import('@/lib/cleanup/chat-backend-cleanup')

    await expect(
      db.transaction(async (tx) => {
        await enqueueChatBackendCleanup(tx, [chatId])
        await tx.delete(copilotChats).where(eq(copilotChats.id, chatId))
        throw new Error('rolled back')
      })
    ).rejects.toThrow('rolled back')
    await enqueueChatBackendCleanup(db, [chatId])

    expect(await runOutboxWorker()).toEqual(new Set())
    expect(await existingChats([chatId])).toEqual(new Set([chatId]))
  })
})
