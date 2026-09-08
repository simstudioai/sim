/** Real PostgreSQL transactions, outbox retries, ownership locks, and local object deletion. */
import { mkdtempSync } from 'node:fs'
import { access, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { db } from '@sim/db'
import {
  document,
  knowledgeBase,
  organization,
  outboxEvent,
  user,
  workspace,
  workspaceFiles,
} from '@sim/db/schema'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { desc, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const fixtureStorage = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/uploads/core/setup.server', () => ({
  get UPLOAD_DIR_SERVER() {
    return fixtureStorage.root
  },
}))

import { processOutboxEventById } from '@/lib/core/outbox/service'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { createSingleDocument, hardDeleteDocuments } from '@/lib/knowledge/documents/service'
import {
  cleanupKnowledgeStorage,
  enqueueKnowledgeStorageCleanup,
  KNOWLEDGE_STORAGE_CLEANUP_EVENT,
} from '@/lib/knowledge/documents/storage-cleanup'
import * as storage from '@/lib/uploads/core/storage-service'
import {
  deleteFileMetadataByIdentity,
  getFileMetadataByKeys,
  insertImmutableFileMetadata,
} from '@/lib/uploads/server/metadata'
import { getWorkspaceFileSize } from '@/lib/uploads/shared/types'

const handlers = { [KNOWLEDGE_STORAGE_CLEANUP_EVENT]: cleanupKnowledgeStorage }

describe('knowledge backing storage cleanup in PostgreSQL', () => {
  const fixtures: ReturnType<typeof createKnowledgeAclFixtureIds>[] = []
  const events: string[] = []
  beforeAll(() => {
    fixtureStorage.root = mkdtempSync(path.join(tmpdir(), 'sim-storage-cleanup-'))
  })
  afterAll(async () => {
    vi.restoreAllMocks()
    if (events.length) await db.delete(outboxEvent).where(inArray(outboxEvent.id, events))
    for (const ids of fixtures) {
      await db.delete(knowledgeBase).where(eq(knowledgeBase.id, ids.knowledgeBaseId))
      await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
      await db.delete(organization).where(eq(organization.id, ids.organizationId))
      await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
    }
    await rm(fixtureStorage.root, { recursive: true, force: true })
    await db.$client.end()
  })

  async function seed() {
    const ids = createKnowledgeAclFixtureIds()
    fixtures.push(ids)
    await seedKnowledgeAclFixture(ids)
    const docId = generateId()
    const key = `kb/${generateId()}.txt`
    const uploaded = await storage.uploadFile({
      file: Buffer.from('Immutable cleanup fixture'),
      fileName: 'fixture.txt',
      contentType: 'text/plain',
      context: 'knowledge-base',
      customKey: key,
      preserveKey: true,
      metadata: { userId: ids.aliceId, workspaceId: ids.workspaceId, originalName: 'fixture.txt' },
    })
    const [binding] = await getFileMetadataByKeys([key], 'knowledge-base')
    const fileUrl = `http://localhost:3000${uploaded.path}?context=knowledge-base`
    await db.insert(document).values({
      id: docId,
      knowledgeBaseId: ids.knowledgeBaseId,
      connectorId: ids.connectorId,
      filename: 'fixture.txt',
      fileUrl,
      storageKey: key,
      fileSize: 25,
      mimeType: 'text/plain',
      processingStatus: 'completed',
    })
    return { ...ids, docId, key, fileUrl, binding, filePath: path.join(fixtureStorage.root, key) }
  }

  async function cleanupEvent(docId: string) {
    const [event] = await db
      .select()
      .from(outboxEvent)
      .where(
        sql`${outboxEvent.eventType} = ${KNOWLEDGE_STORAGE_CLEANUP_EVENT} AND ${outboxEvent.payload}::jsonb ->> 'documentId' = ${docId}`
      )
      .orderBy(desc(outboxEvent.createdAt))
      .limit(1)
    expect(event).toBeDefined()
    events.push(event.id)
    return event
  }

  it('reproduces the raw Date encoding failure and deletes a microsecond timestamp through the shared boundary', async () => {
    const fixture = await seed()
    await db.execute(
      sql`UPDATE workspace_files SET content_updated_at = '2026-09-08 01:02:03.123456'::timestamp WHERE id = ${fixture.binding.id}`
    )
    const [binding] = await getFileMetadataByKeys([fixture.key], 'knowledge-base')
    await expect(
      db.execute(
        sql`SELECT date_trunc('milliseconds', content_updated_at) = ${binding.contentUpdatedAt} FROM workspace_files WHERE id = ${binding.id}`
      )
    ).rejects.toThrow()
    await expect(
      deleteFileMetadataByIdentity({ ...binding, context: 'knowledge-base' })
    ).resolves.toBe(true)
    await expect(
      deleteFileMetadataByIdentity({ ...binding, context: 'knowledge-base' })
    ).resolves.toBe(false)
  })

  it('keeps failed deletion durable after the document is gone, then completes object and metadata cleanup on retry', async () => {
    const fixture = await seed()
    await expect(hardDeleteDocuments([fixture.docId], 'cleanup-integration')).resolves.toBe(1)
    const event = await cleanupEvent(fixture.docId)
    expect(
      await db.select({ id: document.id }).from(document).where(eq(document.id, fixture.docId))
    ).toEqual([])
    const deletion = vi
      .spyOn(storage, 'deleteFile')
      .mockRejectedValueOnce(new Error('Synthetic storage outage'))
    try {
      expect(await processOutboxEventById(event.id, handlers)).toBe('pending')
      const [active] = await getFileMetadataByKeys([fixture.key], 'knowledge-base')
      expect(active.id).toBe(fixture.binding.id)
      await expect(access(fixture.filePath)).resolves.toBeUndefined()
    } finally {
      deletion.mockRestore()
    }
    await db
      .update(outboxEvent)
      .set({ availableAt: new Date(0) })
      .where(eq(outboxEvent.id, event.id))
    expect(await processOutboxEventById(event.id, handlers)).toBe('completed')
    expect(await getFileMetadataByKeys([fixture.key], 'knowledge-base')).toEqual([])
    await expect(access(fixture.filePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rolls back the cleanup intent when document deletion rolls back', async () => {
    const fixture = await seed()
    await expect(
      db.transaction(async (tx) => {
        await tx.delete(document).where(eq(document.id, fixture.docId))
        await enqueueKnowledgeStorageCleanup(
          tx,
          [{ id: fixture.docId, fileUrl: fixture.fileUrl, workspaceId: fixture.workspaceId }],
          'cleanup-rollback'
        )
        throw new Error('Rollback fixture')
      })
    ).rejects.toThrow('Rollback fixture')
    expect(
      await db
        .select({ id: outboxEvent.id })
        .from(outboxEvent)
        .where(sql`${outboxEvent.payload}::jsonb ->> 'documentId' = ${fixture.docId}`)
    ).toEqual([])
    expect(
      await db.select({ id: document.id }).from(document).where(eq(document.id, fixture.docId))
    ).toHaveLength(1)
    await expect(access(fixture.filePath)).resolves.toBeUndefined()
  })

  it('preserves replacement bytes and metadata when an old cleanup intent is replayed', async () => {
    const fixture = await seed()
    await hardDeleteDocuments([fixture.docId], 'cleanup-replacement')
    const event = await cleanupEvent(fixture.docId)
    await deleteFileMetadataByIdentity({ ...fixture.binding, context: 'knowledge-base' })
    await insertImmutableFileMetadata({
      key: fixture.key,
      userId: fixture.aliceId,
      workspaceId: fixture.workspaceId,
      context: 'knowledge-base',
      originalName: fixture.binding.originalName,
      contentType: fixture.binding.contentType,
      size: getWorkspaceFileSize(fixture.binding),
    })
    await writeFile(fixture.filePath, 'replacement bytes')
    expect(await processOutboxEventById(event.id, handlers)).toBe('completed')
    expect(await readFile(fixture.filePath, 'utf8')).toBe('replacement bytes')
    expect(await getFileMetadataByKeys([fixture.key], 'knowledge-base')).toHaveLength(1)
  })

  it('serializes a concurrent document attachment against the cleanup claim', async () => {
    const fixture = await seed()
    await hardDeleteDocuments([fixture.docId], 'cleanup-race')
    const event = await cleanupEvent(fixture.docId)
    let releaseAttachment: (() => void) | undefined
    let announceLock: (() => void) | undefined
    const locked = new Promise<void>((resolve) => {
      announceLock = resolve
    })
    const release = new Promise<void>((resolve) => {
      releaseAttachment = resolve
    })
    const attachment = db.transaction(async (tx) => {
      const [binding] = await getFileMetadataByKeys([fixture.key], 'knowledge-base', tx, {
        lock: 'share',
      })
      expect(binding).toBeDefined()
      announceLock?.()
      await release
      await tx.insert(document).values({
        id: generateId(),
        knowledgeBaseId: fixture.knowledgeBaseId,
        filename: 'shared.txt',
        fileUrl: fixture.fileUrl,
        storageKey: fixture.key,
        fileSize: 25,
        mimeType: 'text/plain',
        processingStatus: 'completed',
      })
    })
    await locked
    const cleanup = processOutboxEventById(event.id, handlers)
    try {
      releaseAttachment?.()
      await attachment
      expect(await cleanup).toBe('completed')
      await expect(access(fixture.filePath)).resolves.toBeUndefined()
      expect(await getFileMetadataByKeys([fixture.key], 'knowledge-base')).toHaveLength(1)
    } finally {
      releaseAttachment?.()
      await Promise.allSettled([attachment, cleanup])
    }
  })

  it('cleans a legacy personal KB document using its canonical user-owned binding', async () => {
    const fixture = await seed()
    await db
      .update(knowledgeBase)
      .set({ workspaceId: null })
      .where(eq(knowledgeBase.id, fixture.knowledgeBaseId))
    await db
      .update(workspaceFiles)
      .set({ workspaceId: null })
      .where(eq(workspaceFiles.id, fixture.binding.id))
    expect(await hardDeleteDocuments([fixture.docId], 'personal-cleanup')).toBe(1)
    const event = await cleanupEvent(fixture.docId)
    expect(event.payload).toMatchObject({
      userId: fixture.aliceId,
      workspaceId: null,
      organizationId: null,
    })
    expect(await processOutboxEventById(event.id, handlers)).toBe('completed')
    expect(await getFileMetadataByKeys([fixture.key], 'knowledge-base')).toEqual([])
    await expect(access(fixture.filePath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(
      createSingleDocument(
        {
          filename: 'expired.txt',
          fileUrl: fixture.fileUrl,
          fileSize: 25,
          mimeType: 'text/plain',
        },
        fixture.knowledgeBaseId,
        'personal-expired-upload',
        fixture.aliceId
      )
    ).rejects.toThrow('not owned')
  })

  it('rolls back personal document deletion when the file belongs to a different user', async () => {
    const fixture = await seed()
    await db
      .update(knowledgeBase)
      .set({ workspaceId: null })
      .where(eq(knowledgeBase.id, fixture.knowledgeBaseId))
    await db
      .update(workspaceFiles)
      .set({ workspaceId: null, userId: fixture.bobId })
      .where(eq(workspaceFiles.id, fixture.binding.id))
    await expect(hardDeleteDocuments([fixture.docId], 'personal-mismatch')).rejects.toThrow(
      'ownership binding'
    )
    expect(
      await db.select({ id: document.id }).from(document).where(eq(document.id, fixture.docId))
    ).toHaveLength(1)
    await expect(access(fixture.filePath)).resolves.toBeUndefined()
  })

  it('allows a create-only re-upload to register a new version after cleanup tombstones its old binding', async () => {
    const fixture = await seed()
    await hardDeleteDocuments([fixture.docId], 'cleanup-register-race')
    const event = await cleanupEvent(fixture.docId)
    let announceDeletion: () => void = () => undefined
    const deleted = new Promise<void>((resolve) => {
      announceDeletion = resolve
    })
    let releaseCleanup: () => void = () => undefined
    const release = new Promise<void>((resolve) => {
      releaseCleanup = resolve
    })
    const deleteFile = storage.deleteFile
    const deletion = vi.spyOn(storage, 'deleteFile').mockImplementationOnce(async (options) => {
      await deleteFile(options)
      announceDeletion()
      await release
    })
    const cleanup = processOutboxEventById(event.id, handlers)
    await deleted
    let registered = false
    const replacement = storage
      .uploadFile({
        file: Buffer.from('Immutable cleanup fixture'),
        fileName: fixture.binding.originalName,
        contentType: fixture.binding.contentType,
        context: 'knowledge-base',
        customKey: fixture.key,
        preserveKey: true,
        metadata: {
          userId: fixture.aliceId,
          workspaceId: fixture.workspaceId,
          originalName: fixture.binding.originalName,
        },
      })
      .then((result) => {
        registered = true
        return result
      })
    try {
      let registrationWaiting = false
      for (let attempt = 0; attempt < 100 && !registered; attempt++) {
        const [row] = await db.execute<{ waiting: boolean }>(sql`SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%workspace_files%'
        ) AS waiting`)
        if (row?.waiting) {
          registrationWaiting = true
          break
        }
        await sleep(10)
      }
      expect(registrationWaiting).toBe(true)
      expect(registered).toBe(false)
      releaseCleanup()
      expect(await cleanup).toBe('completed')
      await replacement
      const [binding] = await getFileMetadataByKeys([fixture.key], 'knowledge-base')
      expect(binding.id).toBe(fixture.binding.id)
      expect(binding.contentUpdatedAt.getTime()).toBeGreaterThan(
        fixture.binding.contentUpdatedAt.getTime()
      )
      await expect(readFile(fixture.filePath, 'utf8')).resolves.toBe('Immutable cleanup fixture')
    } finally {
      releaseCleanup()
      await Promise.allSettled([cleanup, replacement])
      deletion.mockRestore()
    }
  })

  it('queues the final release after a recreated document previously shared its unchanged object', async () => {
    const fixture = await seed()
    const sharedId = generateId()
    const doc = {
      knowledgeBaseId: fixture.knowledgeBaseId,
      connectorId: fixture.connectorId,
      filename: 'shared.txt',
      fileUrl: fixture.fileUrl,
      storageKey: fixture.key,
      fileSize: 25,
      mimeType: 'text/plain',
      processingStatus: 'completed',
    }
    await db.insert(document).values({ ...doc, id: sharedId })
    await hardDeleteDocuments([fixture.docId], 'first-release')
    const firstEvent = await cleanupEvent(fixture.docId)
    expect(await processOutboxEventById(firstEvent.id, handlers)).toBe('completed')
    await db.insert(document).values({ ...doc, id: fixture.docId })
    await hardDeleteDocuments([sharedId], 'shared-release')
    const sharedEvent = await cleanupEvent(sharedId)
    expect(await processOutboxEventById(sharedEvent.id, handlers)).toBe('completed')
    await hardDeleteDocuments([fixture.docId], 'final-release')
    const finalEvent = await cleanupEvent(fixture.docId)
    expect(finalEvent.id).not.toBe(firstEvent.id)
    expect(await processOutboxEventById(finalEvent.id, handlers)).toBe('completed')
    expect(await getFileMetadataByKeys([fixture.key], 'knowledge-base')).toEqual([])
    await expect(access(fixture.filePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
