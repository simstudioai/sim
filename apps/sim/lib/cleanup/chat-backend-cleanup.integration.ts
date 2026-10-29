/**
 * Deleting a chat, an account, or a user row directly through `/admin/remove-user` cascades
 * `copilot_chats` rows away, and with them the only rows naming the chats' stored files. The
 * copilot backend keeps its own copy of each chat, so every chat a delete erases must reach
 * `POST /api/tasks/cleanup` and lose its stored files, durably and only once the delete has
 * happened, and no surviving chat may. Runs the production deletion paths and the outbox handler
 * against real PostgreSQL, local file storage, and a local copilot backend stand-in that accepts
 * only the cleanup call the handler is meant to make.
 */
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { db } from '@sim/db'
import {
  copilotChats,
  copilotMessages,
  outboxEvent,
  permissions,
  project,
  user,
  workflow,
  workspace,
  workspaceFiles,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { setUploadDirServer, uploadsSetupMock } from '@sim/testing/mocks/uploads-setup.mock'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const { backend, storageRoot } = await vi.hoisted(async () => {
  const { createServer } = await import('node:http')
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const apiKey = 'chat-cleanup-fixture-key'
  const backend = {
    apiKey,
    /** The chat ids of every accepted cleanup call, in order. */
    purged: [] as string[][],
    /** Requests refused for the wrong method, path, or key. */
    rejected: 0,
    /** Set to answer accepted calls with a 503, as during an outage. */
    unavailable: false,
    server: createServer(async (request, response) => {
      let body = ''
      for await (const chunk of request) body += chunk
      if (
        request.method !== 'POST' ||
        request.url !== '/api/tasks/cleanup' ||
        request.headers['x-api-key'] !== apiKey
      ) {
        backend.rejected++
        response.writeHead(401, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: 'Unauthorized' }))
        return
      }
      if (backend.unavailable) {
        response.writeHead(503, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: 'Unavailable' }))
        return
      }
      const chatIds: unknown = JSON.parse(body).chatIds
      const ids = Array.isArray(chatIds) ? chatIds.map(String) : []
      backend.purged.push(ids)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ deleted: ids.length }))
    }),
  }
  await new Promise<void>((resolve) => backend.server.listen(0, '127.0.0.1', resolve))
  const { port } = backend.server.address() as { port: number }
  process.env.SIM_AGENT_API_URL = `http://127.0.0.1:${port}`
  process.env.COPILOT_API_KEY = apiKey
  return { backend, storageRoot: mkdtempSync(join(tmpdir(), 'sim-chat-cleanup-')) }
})

vi.mock('@/lib/uploads/core/setup.server', () => uploadsSetupMock)

import { enqueueAdminRemovedChatCleanup } from '@/lib/auth/admin-removal-chat-cleanup'
import {
  CHAT_BACKEND_CLEANUP_EVENT,
  CHAT_INLINE_IMAGE_CLEANUP_EVENT,
} from '@/lib/cleanup/chat-backend-cleanup-event'
import { chatBackendCleanupOutboxHandlers } from '@/lib/cleanup/chat-backend-cleanup-outbox'
import { prepareChatCleanup } from '@/lib/cleanup/chat-cleanup'
import { env } from '@/lib/core/config/env'
import { processOutboxEventById } from '@/lib/core/outbox/service'
import { deleteCopilotChat } from '@/lib/mothership/chat/deletion'
import { inlineChatImageKey } from '@/lib/mothership/chat/inline-image-key'
import { deleteUserAccount } from '@/lib/users/account-deletion'

setUploadDirServer(storageRoot)

/** Events queued before this suite started belong to earlier suites sharing the database. */
let suiteStartedAt: string
const userIds: string[] = []
const workspaceIds: string[] = []
const projectIds: string[] = []

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

async function putObject(key: string) {
  await mkdir(dirname(join(storageRoot, key)), { recursive: true })
  await writeFile(join(storageRoot, key), 'x')
}

async function objectExists(key: string) {
  return stat(join(storageRoot, key)).then(
    () => true,
    () => false
  )
}

/**
 * A chat holding two stored objects whose naming rows its delete cascades away: an upload linked
 * by its `workspace_files` row, and an attachment named only inside a message.
 */
async function seedChatWithFiles(userId: string, workspaceId: string) {
  const chatId = await seedChat(userId, workspaceId)
  const keys = {
    upload: `copilot/${generateId()}/upload.txt`,
    attachment: `copilot/${generateId()}/attachment.txt`,
  }
  await db.insert(workspaceFiles).values({
    id: generateId(),
    key: keys.upload,
    userId,
    workspaceId,
    context: 'copilot',
    chatId,
    originalName: 'upload.txt',
    contentType: 'text/plain',
    sizeBytes: 1,
  })
  await db.insert(copilotMessages).values({
    chatId,
    messageId: generateId(),
    role: 'user',
    content: {
      role: 'user',
      content: 'see attached',
      fileAttachments: [{ key: keys.attachment, filename: 'attachment.txt' }],
    },
  })
  await putObject(keys.upload)
  await putObject(keys.attachment)
  return { chatId, keys }
}

const queuedBySuite = () =>
  and(
    inArray(outboxEvent.eventType, [CHAT_BACKEND_CLEANUP_EVENT, CHAT_INLINE_IMAGE_CLEANUP_EVENT]),
    sql`${outboxEvent.createdAt} >= ${suiteStartedAt}::timestamp`
  )

async function queuedCleanups() {
  return db
    .select({ id: outboxEvent.id, availableAt: outboxEvent.availableAt })
    .from(outboxEvent)
    .where(queuedBySuite())
}

/**
 * Delivers every queued chat cleanup the way the outbox worker does once each is due, and returns
 * each event's outcome and the chat ids the backend purged.
 */
async function deliverCleanups() {
  await db.update(outboxEvent).set({ availableAt: new Date() }).where(queuedBySuite())
  backend.purged.length = 0
  const outcomes: string[] = []
  for (const { id } of await queuedCleanups()) {
    outcomes.push(await processOutboxEventById(id, chatBackendCleanupOutboxHandlers))
  }
  return { outcomes: outcomes.sort(), purged: new Set(backend.purged.flat()) }
}

/** Whether the fixture trigger's exception is the failure, however the driver or Better Auth wraps it. */
function refusedByFixture(error: unknown): boolean {
  for (let cause = error; cause instanceof Error; cause = cause.cause) {
    if (cause.message.includes('refused by fixture')) return true
  }
  return false
}

async function refuseWith(table: string, when: string, run: () => Promise<unknown>) {
  const name = sql.identifier(`chat_cleanup_refuse_${generateId().replaceAll('-', '')}`)
  const operation = table === 'outbox_event' ? sql`INSERT` : sql`DELETE`
  await db.execute(sql`
    CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'refused by fixture'; END $$`)
  await db.execute(sql`
    CREATE TRIGGER ${name} BEFORE ${operation} ON ${sql.identifier(table)}
    FOR EACH ROW WHEN (${sql.raw(when)}) EXECUTE FUNCTION ${name}()`)
  try {
    const error = await run().then(
      () => undefined,
      (reason: unknown) => reason
    )
    expect(refusedByFixture(error)).toBe(true)
  } finally {
    await db.execute(sql`DROP TRIGGER ${name} ON ${sql.identifier(table)}`)
    await db.execute(sql`DROP FUNCTION ${name}()`)
  }
}

async function existingChats(chatIds: string[]) {
  const rows = await db
    .select({ id: copilotChats.id })
    .from(copilotChats)
    .where(inArray(copilotChats.id, chatIds))
  return new Set(rows.map(({ id }) => id))
}

beforeAll(async () => {
  const [{ now }] = await db.execute<{ now: string }>(
    sql`SELECT clock_timestamp()::timestamp::text AS now`
  )
  suiteStartedAt = now
})

afterEach(async () => {
  await db.delete(outboxEvent).where(queuedBySuite())
  backend.unavailable = false
  backend.rejected = 0
  Object.assign(env, { COPILOT_API_KEY: backend.apiKey })
})

afterAll(async () => {
  await deleteWorkspaceFixture(db, inArray(workspace.id, workspaceIds))
  await db.delete(project).where(inArray(project.id, projectIds))
  await db.delete(permissions).where(inArray(permissions.userId, userIds))
  await db.delete(user).where(inArray(user.id, userIds))
  await rm(storageRoot, { recursive: true, force: true })
  await new Promise<void>((resolve, reject) =>
    backend.server.close((error) => (error ? reject(error) : resolve()))
  )
})

describe('cleanup of a permanently deleted chat', () => {
  it('purges the backend data and stored files of the chat it deletes', async () => {
    const ownerId = await seedUser()
    const workspaceId = await seedWorkspace(ownerId)
    const { chatId, keys } = await seedChatWithFiles(ownerId, workspaceId)
    const bystander = await seedChatWithFiles(ownerId, workspaceId)

    expect(await deleteCopilotChat({ chatId, userId: ownerId })).toEqual({
      workspaceId,
      organizationId: null,
    })

    expect(await existingChats([chatId])).toEqual(new Set())
    const delivered = await deliverCleanups()
    expect(delivered.outcomes).toEqual(['completed', 'completed', 'completed'])
    expect(delivered.purged).toEqual(new Set([chatId]))
    expect(await objectExists(keys.upload)).toBe(false)
    expect(await objectExists(keys.attachment)).toBe(false)
    expect(await objectExists(bystander.keys.upload)).toBe(true)
    expect(await objectExists(bystander.keys.attachment)).toBe(true)
    expect(backend.rejected).toBe(0)
  })

  /**
   * A fork whose copy of an upload failed keeps naming the source's key in its messages, while
   * the upload's `workspace_files` row cascades away with the source chat.
   */
  it('keeps a deleted chat’s upload that a fork in its workspace still references', async () => {
    const ownerId = await seedUser()
    const workspaceId = await seedWorkspace(ownerId)
    const uploadIn = async (chatId: string) => {
      const key = `workspace/${workspaceId}/1700000000000-${generateId().slice(0, 8)}-shot.png`
      await db.insert(workspaceFiles).values({
        id: generateId(),
        key,
        userId: ownerId,
        workspaceId,
        context: 'mothership',
        chatId,
        originalName: 'shot.png',
        contentType: 'image/png',
        sizeBytes: 1,
      })
      await putObject(key)
      return key
    }
    const forkedSource = await seedChat(ownerId, workspaceId)
    const sharedKey = await uploadIn(forkedSource)
    const fork = await seedChat(ownerId, workspaceId)
    await db.insert(copilotMessages).values({
      chatId: fork,
      messageId: generateId(),
      role: 'user',
      content: {
        role: 'user',
        content: 'see attached',
        fileAttachments: [{ key: sharedKey, filename: 'shot.png' }],
      },
    })
    const unforkedSource = await seedChat(ownerId, workspaceId)
    const ownKey = await uploadIn(unforkedSource)

    await deleteCopilotChat({ chatId: forkedSource, userId: ownerId })
    await deleteCopilotChat({ chatId: unforkedSource, userId: ownerId })

    expect(new Set((await deliverCleanups()).outcomes)).toEqual(new Set(['completed']))
    expect(await objectExists(sharedKey)).toBe(true)
    expect(await objectExists(ownKey)).toBe(false)
  })

  it('deletes a forked upload once the last chat attaching it is deleted', async () => {
    const ownerId = await seedUser()
    const workspaceId = await seedWorkspace(ownerId)
    const source = await seedChat(ownerId, workspaceId)
    const key = `workspace/${workspaceId}/1700000000000-${generateId().slice(0, 8)}-shot.png`
    await db.insert(workspaceFiles).values({
      id: generateId(),
      key,
      userId: ownerId,
      workspaceId,
      context: 'mothership',
      chatId: source,
      originalName: 'shot.png',
      contentType: 'image/png',
      sizeBytes: 1,
    })
    await putObject(key)
    const fork = await seedChat(ownerId, workspaceId)
    await db.insert(copilotMessages).values({
      chatId: fork,
      messageId: generateId(),
      role: 'user',
      content: { role: 'user', content: 'see attached', fileAttachments: [{ key }] },
    })

    await deleteCopilotChat({ chatId: source, userId: ownerId })
    await deliverCleanups()
    expect(await objectExists(key)).toBe(true)

    await deleteCopilotChat({ chatId: fork, userId: ownerId })
    await deliverCleanups()
    expect(await objectExists(key)).toBe(false)
  })

  it('never deletes an attached workspace upload whose row is live or only soft-deleted', async () => {
    const ownerId = await seedUser()
    const workspaceId = await seedWorkspace(ownerId)
    const chatId = await seedChat(ownerId, workspaceId)
    const upload = (name: string) =>
      `workspace/${workspaceId}/1700000000000-${generateId().slice(0, 8)}-${name}`
    const live = upload('live.png')
    const restorable = upload('restorable.png')
    await db.insert(workspaceFiles).values(
      [live, restorable].map((key) => ({
        id: generateId(),
        key,
        userId: ownerId,
        workspaceId,
        context: 'workspace',
        originalName: 'file.png',
        contentType: 'image/png',
        sizeBytes: 1,
        ...(key === restorable ? { deletedAt: new Date() } : {}),
      }))
    )
    for (const key of [live, restorable]) await putObject(key)
    await db.insert(copilotMessages).values({
      chatId,
      messageId: generateId(),
      role: 'user',
      content: {
        role: 'user',
        content: 'x',
        fileAttachments: [{ key: live }, { key: restorable }],
      },
    })

    await deleteCopilotChat({ chatId, userId: ownerId })
    await deliverCleanups()

    expect(await objectExists(live)).toBe(true)
    expect(await objectExists(restorable)).toBe(true)
  })

  it('places a legacy upload ref by its workspace key, keeping one a remaining chat attaches', async () => {
    const ownerId = await seedUser()
    const workspaceId = await seedWorkspace(ownerId)
    const deletedChat = await seedChat(ownerId, workspaceId)
    const remainingChat = await seedChat(ownerId, workspaceId)
    const referenced = `workspace/${workspaceId}/1700000000000-abcd1234-kept.png`
    const unreferenced = `workspace/${workspaceId}/1700000000000-abcd1234-gone.png`
    for (const key of [referenced, unreferenced]) await putObject(key)
    await db.insert(copilotMessages).values({
      chatId: remainingChat,
      messageId: generateId(),
      role: 'user',
      content: { role: 'user', content: 'x', fileAttachments: [{ key: referenced }] },
    })
    await db.delete(copilotChats).where(eq(copilotChats.id, deletedChat))
    await db.insert(outboxEvent).values({
      id: generateId(),
      eventType: CHAT_BACKEND_CLEANUP_EVENT,
      payload: {
        chatIds: [],
        files: [referenced, unreferenced].map((key) => ({
          key,
          context: 'mothership',
          chatId: deletedChat,
        })),
      },
    })

    expect((await deliverCleanups()).outcomes).toEqual(['completed'])
    expect(await objectExists(referenced)).toBe(true)
    expect(await objectExists(unreferenced)).toBe(false)
  })

  it('accepts the payloads queued before refs carried their scope', async () => {
    const ownerId = await seedUser()
    const workspaceId = await seedWorkspace(ownerId)
    const deletedChat = await seedChat(ownerId, workspaceId)
    const organizationAttachment = `copilot/${generateId()}/org-attachment.png`
    await putObject(organizationAttachment)
    await db.delete(copilotChats).where(eq(copilotChats.id, deletedChat))
    const organizationId = generateId()
    await db.insert(outboxEvent).values([
      {
        id: generateId(),
        eventType: CHAT_BACKEND_CLEANUP_EVENT,
        payload: { chatIds: [deletedChat], files: [] },
      },
      {
        id: generateId(),
        eventType: CHAT_BACKEND_CLEANUP_EVENT,
        payload: {
          chatIds: [],
          files: [
            {
              key: organizationAttachment,
              context: 'copilot',
              chatId: deletedChat,
              organizationId,
            },
          ],
        },
      },
    ])

    const delivered = await deliverCleanups()
    expect(delivered.outcomes).toEqual(['completed', 'completed'])
    expect(delivered.purged).toEqual(new Set([deletedChat]))
    // Its legacy `organizationId` places it, and no chat of that organization still names it.
    expect(await objectExists(organizationAttachment)).toBe(false)
  })

  it('sweeps the inline images of the chats whose rows are gone, never a surviving chat’s', async () => {
    const ownerId = await seedUser()
    const workspaceId = await seedWorkspace(ownerId)
    const gone = await seedChat(ownerId, workspaceId)
    const survivor = await seedChat(ownerId, workspaceId)
    const goneImages = [
      inlineChatImageKey(gone, 'req-1', 'files/a.png'),
      inlineChatImageKey(gone, 'req-2', 'files/b.png'),
    ]
    const survivorImage = inlineChatImageKey(survivor, 'req-1', 'files/a.png')
    for (const key of [...goneImages, survivorImage]) await putObject(key)
    await db.delete(copilotChats).where(eq(copilotChats.id, gone))
    await db.insert(outboxEvent).values({
      id: generateId(),
      eventType: CHAT_INLINE_IMAGE_CLEANUP_EVENT,
      payload: { chatIds: [gone, survivor] },
    })

    expect((await deliverCleanups()).outcomes).toEqual(['completed'])
    for (const key of goneImages) expect(await objectExists(key)).toBe(false)
    expect(await objectExists(survivorImage)).toBe(true)
  })

  it('queues the inline image sweep of the chats a cleanup job purges', async () => {
    const ownerId = await seedUser()
    const workspaceId = await seedWorkspace(ownerId)
    const chatId = await seedChat(ownerId, workspaceId)
    const image = inlineChatImageKey(chatId, 'req-1', 'files/a.png')
    await putObject(image)

    const cleanup = await prepareChatCleanup([chatId], 'test')
    await db.delete(copilotChats).where(eq(copilotChats.id, chatId))
    await cleanup.execute()

    expect(backend.purged).toEqual([[chatId]])
    expect((await deliverCleanups()).outcomes).toEqual(['completed'])
    expect(await objectExists(image)).toBe(false)
  })

  it('records no cleanup when the delete rolls back', async () => {
    const ownerId = await seedUser()
    const workspaceId = await seedWorkspace(ownerId)
    const { chatId, keys } = await seedChatWithFiles(ownerId, workspaceId)

    await refuseWith('copilot_chats', `OLD.id = '${chatId}'::uuid`, () =>
      deleteCopilotChat({ chatId, userId: ownerId })
    )

    expect(await existingChats([chatId])).toEqual(new Set([chatId]))
    expect(await queuedCleanups()).toEqual([])
    expect(await objectExists(keys.upload)).toBe(true)
    expect(await objectExists(keys.attachment)).toBe(true)
  })

  it('retries a cleanup whose backend call or object delete failed until both succeed', async () => {
    const ownerId = await seedUser()
    const workspaceId = await seedWorkspace(ownerId)
    const { chatId, keys } = await seedChatWithFiles(ownerId, workspaceId)
    await deleteCopilotChat({ chatId, userId: ownerId })
    backend.unavailable = true
    /** A directory where the object is: its delete fails with something other than ENOENT. */
    await rm(join(storageRoot, keys.upload))
    await mkdir(join(storageRoot, keys.upload, 'blocker'), { recursive: true })

    expect((await deliverCleanups()).outcomes).toEqual(['completed', 'pending', 'pending'])
    expect(await objectExists(keys.attachment)).toBe(false)

    backend.unavailable = false
    await rm(join(storageRoot, keys.upload), { recursive: true })
    await putObject(keys.upload)
    const retried = await deliverCleanups()
    expect(retried.outcomes).toEqual(['completed', 'completed', 'completed'])
    expect(retried.purged).toEqual(new Set([chatId]))
    expect(await objectExists(keys.upload)).toBe(false)
  })

  it('holds a queued backend purge while COPILOT_API_KEY is unset, still deleting the files', async () => {
    const ownerId = await seedUser()
    const workspaceId = await seedWorkspace(ownerId)
    const { chatId, keys } = await seedChatWithFiles(ownerId, workspaceId)
    await deleteCopilotChat({ chatId, userId: ownerId })
    Object.assign(env, { COPILOT_API_KEY: undefined })

    expect((await deliverCleanups()).outcomes).toEqual(['completed', 'completed', 'pending'])
    expect(backend.purged).toEqual([])
    expect(await objectExists(keys.upload)).toBe(false)
    expect(await objectExists(keys.attachment)).toBe(false)
    const [held] = await db
      .select({ lastError: outboxEvent.lastError })
      .from(outboxEvent)
      .where(and(queuedBySuite(), eq(outboxEvent.status, 'pending')))
    expect(held.lastError).toBe('Copilot cleanup is not configured')

    Object.assign(env, { COPILOT_API_KEY: backend.apiKey })
    const retried = await deliverCleanups()
    expect(retried.outcomes).toEqual(['completed', 'completed', 'completed'])
    expect(retried.purged).toEqual(new Set([chatId]))
  })
})

describe('cleanup of the chats a removal cascades away', () => {
  it('purges the chats an account deletion erases and their files, and only those', async () => {
    const departingId = await seedUser()
    const bystanderId = await seedUser()
    const doomedWorkspaceId = await seedWorkspace(departingId)
    const keptWorkspaceId = await seedWorkspace(bystanderId)
    /** Chats outlive their author's membership: both were written by a member who since left. */
    const ownChatElsewhere = await seedChatWithFiles(departingId, keptWorkspaceId)
    const formerMembersChat = await seedChat(bystanderId, doomedWorkspaceId)
    const bystandersChat = await seedChatWithFiles(bystanderId, keptWorkspaceId)

    await deleteUserAccount(departingId, { recordIdentity: false })

    expect(
      await existingChats([ownChatElsewhere.chatId, formerMembersChat, bystandersChat.chatId])
    ).toEqual(new Set([bystandersChat.chatId]))
    const delivered = await deliverCleanups()
    expect(new Set(delivered.outcomes)).toEqual(new Set(['completed']))
    expect(delivered.purged).toEqual(new Set([ownChatElsewhere.chatId, formerMembersChat]))
    expect(await objectExists(ownChatElsewhere.keys.attachment)).toBe(false)
    expect(await objectExists(bystandersChat.keys.attachment)).toBe(true)
    expect(await objectExists(bystandersChat.keys.upload)).toBe(true)
  })

  /** Drives the hook Better Auth runs before its bare user delete; a throw there aborts the delete. */
  it('queues a direct user delete’s cleanup before the delete, due only after it', async () => {
    const removedId = await seedUser()
    const bystanderId = await seedUser()
    const sharedWorkspaceId = await seedWorkspace(bystanderId, [removedId])
    const ownChat = await seedChatWithFiles(removedId, sharedWorkspaceId)
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

    const queuedAt = Date.now()
    await enqueueAdminRemovedChatCleanup({ id: removedId })
    const queued = await queuedCleanups()
    expect(queued.length).toBeGreaterThan(0)
    for (const { id, availableAt } of queued) {
      expect(availableAt.getTime()).toBeGreaterThan(queuedAt + 10 * 60_000)
      expect(await processOutboxEventById(id, chatBackendCleanupOutboxHandlers)).toBe('pending')
    }
    await db.delete(user).where(eq(user.id, removedId))

    expect(
      await existingChats([ownChat.chatId, chatOnRemovedUsersWorkflow, bystandersChat])
    ).toEqual(new Set([bystandersChat]))
    const delivered = await deliverCleanups()
    expect(new Set(delivered.outcomes)).toEqual(new Set(['completed']))
    expect(delivered.purged).toEqual(new Set([ownChat.chatId, chatOnRemovedUsersWorkflow]))
    expect(await objectExists(ownChat.keys.upload)).toBe(false)
    expect(await objectExists(ownChat.keys.attachment)).toBe(false)
  })

  /**
   * Inline images have no row, and the hook reads the transcript before Better Auth deletes the
   * user, so an image a turn publishes in between was never collected by key.
   */
  it('purges inline images a removed user’s chat published after the cleanup read it', async () => {
    const removedId = await seedUser()
    const bystanderId = await seedUser()
    const workspaceId = await seedWorkspace(bystanderId, [removedId])
    const chatId = await seedChat(removedId, workspaceId)
    const bystandersChat = await seedChat(bystanderId, workspaceId)
    const read = inlineChatImageKey(chatId, 'req-1', 'files/chart.png')
    await db.insert(copilotMessages).values({
      chatId,
      messageId: generateId(),
      role: 'assistant',
      content: { role: 'assistant', requestId: 'req-1', content: '![chart](files/chart.png)' },
    })
    await putObject(read)
    const bystanders = inlineChatImageKey(bystandersChat, 'req-1', 'files/chart.png')
    await putObject(bystanders)

    await enqueueAdminRemovedChatCleanup({ id: removedId })
    const late = [
      inlineChatImageKey(chatId, 'req-2', 'files/later.png'),
      inlineChatImageKey(chatId, 'req-2', 'files/another.png'),
    ]
    for (const key of late) await putObject(key)
    await db.delete(user).where(eq(user.id, removedId))

    const delivered = await deliverCleanups()
    expect(new Set(delivered.outcomes)).toEqual(new Set(['completed']))
    for (const key of [read, ...late]) expect(await objectExists(key)).toBe(false)
    expect(await objectExists(bystanders)).toBe(true)
  })

  it('still deletes the inline image keys an event queued before prefix sweeps names', async () => {
    const ownerId = await seedUser()
    const workspaceId = await seedWorkspace(ownerId)
    const chatId = await seedChat(ownerId, workspaceId)
    const key = inlineChatImageKey(chatId, 'req-1', 'files/chart.png')
    await putObject(key)
    await db.delete(copilotChats).where(eq(copilotChats.id, chatId))
    await db.insert(outboxEvent).values({
      id: generateId(),
      eventType: CHAT_BACKEND_CLEANUP_EVENT,
      payload: { chatIds: [], files: [{ key, context: 'mothership', chatId }] },
    })

    expect((await deliverCleanups()).outcomes).toEqual(['completed'])
    expect(await objectExists(key)).toBe(false)
  })

  it('purges nothing for a direct user delete that never happened', async () => {
    const keptId = await seedUser()
    const workspaceId = await seedWorkspace(keptId)
    const chat = await seedChatWithFiles(keptId, workspaceId)

    await enqueueAdminRemovedChatCleanup({ id: keptId })

    const delivered = await deliverCleanups()
    expect(new Set(delivered.outcomes)).toEqual(new Set(['completed']))
    expect(delivered.purged).toEqual(new Set())
    expect(await objectExists(chat.keys.upload)).toBe(true)
    expect(await objectExists(chat.keys.attachment)).toBe(true)
  })

  it('refuses a direct user delete whose cleanup cannot be queued', async () => {
    const removedId = await seedUser()
    const workspaceId = await seedWorkspace(removedId)
    await seedChat(removedId, workspaceId)

    await refuseWith('outbox_event', `NEW.event_type = '${CHAT_BACKEND_CLEANUP_EVENT}'`, () =>
      enqueueAdminRemovedChatCleanup({ id: removedId })
    )
  })
})
