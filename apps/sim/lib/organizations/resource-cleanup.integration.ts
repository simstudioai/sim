/**
 * An organization's stored objects outlive its row only until its cleanup runs, against real
 * PostgreSQL. Failure modes: deleting an account deletes its personal organization without queuing
 * that organization's cleanup, orphaning every object the account's own storage sweep leaves to
 * it; and the organization cleanup covering only Knowledge files, orphaning its chats' Copilot
 * uploads and knowledge documents (the admin organization delete shares
 * it); and an organization with more objects than one cleanup batch holds losing every object past
 * the first page. An object a surviving row still names is never deleted.
 */
import { db } from '@sim/db'
import {
  copilotChats,
  document,
  knowledgeBase,
  organization,
  outboxEvent,
  user,
  userStats,
  workspaceFiles,
} from '@sim/db/schema'
import { deleteOutboxEventsNaming } from '@sim/db/testing/outbox-fixtures'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { deleteFile } = vi.hoisted(() => ({ deleteFile: vi.fn() }))
vi.mock('@/lib/uploads/core/storage-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/uploads/core/storage-service')>()),
  deleteFile,
}))

import type { OutboxEventContext } from '@/lib/core/outbox/service'
import { createPersonalOrganization } from '@/lib/organizations/provision-personal'
import { organizationResourceCleanupOutboxHandlers } from '@/lib/organizations/resource-cleanup'
import {
  CLEANUP_BATCH_SIZE,
  ORGANIZATION_RESOURCE_CLEANUP_EVENT,
} from '@/lib/organizations/resource-cleanup-event'
import { deleteUserAccount } from '@/lib/users/account-deletion'

const userIds: string[] = []
/** Every organization the suite created, whose cleanup events and rows `afterAll` removes. */
const organizationIds: string[] = []
const handleCleanup = organizationResourceCleanupOutboxHandlers[ORGANIZATION_RESOURCE_CLEANUP_EVENT]

async function createUser(): Promise<string> {
  const id = `org-cleanup-user-${generateId()}`
  const now = new Date()
  await db.insert(user).values({
    id,
    name: 'Org Cleanup Test',
    email: `${id}@org-cleanup.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(userStats).values({ id: generateId(), userId: id, storageUsedBytes: 0 })
  userIds.push(id)
  return id
}

async function createKnowledgeFile(
  ownerId: string,
  organizationId: string
): Promise<{ id: string; key: string }> {
  const id = generateId()
  const key = `kb/org-cleanup-test/${id}.txt`
  await db.insert(workspaceFiles).values({
    id,
    key,
    userId: ownerId,
    organizationId,
    context: 'knowledge-base',
    originalName: 'file.txt',
    contentType: 'text/plain',
    sizeBytes: 4,
  })
  return { id, key }
}

/** An upload to an organization-level chat, which the chat's cascade removes with the organization. */
async function createChatUpload(
  ownerId: string,
  chatId: string,
  context: 'copilot'
): Promise<{ id: string; key: string }> {
  const id = generateId()
  const key = `${context}/org-cleanup-test/${id}.txt`
  await db.insert(workspaceFiles).values({
    id,
    key,
    userId: ownerId,
    chatId,
    context,
    originalName: 'upload.txt',
    contentType: 'text/plain',
    sizeBytes: 4,
  })
  return { id, key }
}

async function createOrganizationChat(ownerId: string, organizationId: string): Promise<string> {
  const [chat] = await db
    .insert(copilotChats)
    .values({ userId: ownerId, organizationId, title: 'Organization chat' })
    .returning({ id: copilotChats.id })
  return chat.id
}

async function personalOrganization(ownerId: string) {
  const organizationId = await createPersonalOrganization(ownerId)
  if (organizationId) organizationIds.push(organizationId)
  return organizationId
}

function context(eventId: string): OutboxEventContext {
  return {
    eventId,
    eventType: ORGANIZATION_RESOURCE_CLEANUP_EVENT,
    attempts: 0,
    maxAttempts: 10,
    signal: new AbortController().signal,
    checkpointPayload: vi.fn(),
  }
}

/** The organization's storage cleanup events; its chat events reach the Copilot backend instead. */
async function cleanupEventsFor(organizationId: string) {
  return db
    .select({ id: outboxEvent.id, payload: outboxEvent.payload })
    .from(outboxEvent)
    .where(
      and(
        eq(outboxEvent.eventType, ORGANIZATION_RESOURCE_CLEANUP_EVENT),
        sql`${outboxEvent.payload}->>'organizationId' = ${organizationId}`,
        sql`${outboxEvent.payload}->>'kind' <> 'chats'`
      )
    )
}

beforeEach(() => {
  deleteFile.mockReset().mockResolvedValue(undefined)
})

afterAll(async () => {
  await deleteOutboxEventsNaming(db, [...userIds, ...organizationIds])
  if (organizationIds.length > 0) {
    await db.delete(organization).where(inArray(organization.id, organizationIds))
  }
  if (userIds.length > 0) await db.delete(user).where(inArray(user.id, userIds))
})

describe("deleting an account with a personal organization's stored objects", () => {
  it("queues and runs the organization's cleanup for every object it owned", async () => {
    const ownerId = await createUser()
    const organizationId = await personalOrganization(ownerId)
    if (!organizationId) throw new Error('expected a personal organization')

    const chatId = await createOrganizationChat(ownerId, organizationId)
    const knowledgeFile = await createKnowledgeFile(ownerId, organizationId)
    const copilotFile = await createChatUpload(ownerId, chatId, 'copilot')
    const knowledgeBaseId = generateId()
    await db.insert(knowledgeBase).values({
      id: knowledgeBaseId,
      organizationId,
      name: 'Notes',
      userId: ownerId,
      isSearchIndex: true,
    })
    const documentKey = `kb/org-cleanup-test/${generateId()}.txt`
    await db.insert(document).values({
      id: generateId(),
      knowledgeBaseId,
      filename: 'notes.txt',
      fileUrl: `/api/files/serve/${documentKey}`,
      storageKey: documentKey,
      fileSize: 4,
      mimeType: 'text/plain',
      uploadedBy: ownerId,
    })

    await deleteUserAccount(ownerId, { recordIdentity: false })

    const events = await cleanupEventsFor(organizationId)
    for (const event of events) await handleCleanup(event.payload, context(event.id))

    const deleted = deleteFile.mock.calls.map(([options]) => options)
    expect(deleted).toEqual(
      expect.arrayContaining([
        { key: knowledgeFile.key, context: 'knowledge-base' },
        { key: copilotFile.key, context: 'copilot' },
        { key: documentKey, context: 'knowledge-base' },
      ])
    )
  })

  it('keeps an object that a surviving row still names', async () => {
    const ownerId = await createUser()
    const keeperId = await createUser()
    const organizationId = await personalOrganization(ownerId)
    const keeperOrganizationId = await personalOrganization(keeperId)
    if (!organizationId || !keeperOrganizationId) throw new Error('expected personal organizations')
    const shared = await createKnowledgeFile(ownerId, organizationId)
    const ownOnly = await createKnowledgeFile(ownerId, organizationId)
    const keeperKnowledgeBaseId = generateId()
    await db.insert(knowledgeBase).values({
      id: keeperKnowledgeBaseId,
      organizationId: keeperOrganizationId,
      name: 'Kept',
      userId: keeperId,
      isSearchIndex: true,
    })
    await db.insert(document).values({
      id: generateId(),
      knowledgeBaseId: keeperKnowledgeBaseId,
      filename: 'copy.txt',
      fileUrl: `/api/files/serve/${shared.key}`,
      storageKey: shared.key,
      fileSize: 4,
      mimeType: 'text/plain',
      uploadedBy: keeperId,
    })

    await deleteUserAccount(ownerId, { recordIdentity: false })
    const events = await cleanupEventsFor(organizationId)
    for (const event of events) await handleCleanup(event.payload, context(event.id))

    expect(events.length).toBeGreaterThan(0)
    const deletedKeys = deleteFile.mock.calls.map(([options]) => options.key)
    expect(deletedKeys).toContain(ownOnly.key)
    expect(deletedKeys).not.toContain(shared.key)
  })

  it('pages an organization with more objects than one batch into events of at most a batch each', async () => {
    const ownerId = await createUser()
    const organizationId = await personalOrganization(ownerId)
    if (!organizationId) throw new Error('expected a personal organization')
    const files = Array.from({ length: CLEANUP_BATCH_SIZE + 1 }, () => {
      const id = generateId()
      return {
        id,
        key: `kb/org-cleanup-test/${id}.txt`,
        userId: ownerId,
        organizationId,
        context: 'knowledge-base',
        originalName: 'file.txt',
        contentType: 'text/plain',
        sizeBytes: 4,
      }
    })
    await db.insert(workspaceFiles).values(files)

    await deleteUserAccount(ownerId, { recordIdentity: false })

    const events = await cleanupEventsFor(organizationId)
    const batches = events.map((event) =>
      (event.payload as { objects: { key: string }[] }).objects.map(({ key }) => key)
    )
    expect(batches.length).toBeGreaterThanOrEqual(2)
    for (const batch of batches) expect(batch.length).toBeLessThanOrEqual(CLEANUP_BATCH_SIZE)
    expect(new Set(batches.flat())).toEqual(new Set(files.map(({ key }) => key)))
  })
})
