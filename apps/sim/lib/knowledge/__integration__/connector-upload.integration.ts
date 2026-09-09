/** Durable pre-upload intent, create-only objects and crash recovery against real PostgreSQL and local storage. */
import { mkdtempSync } from 'node:fs'
import { access, readFile, rm } from 'node:fs/promises'
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
import { generateId } from '@sim/utils/id'
import { eq, inArray, sql } from 'drizzle-orm'
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
import { uploadConnectorArtifact } from '@/lib/knowledge/connectors/connector-upload'
import { stillHoldsSyncLock } from '@/lib/knowledge/connectors/sync-lock'
import { addDocument, updateDocument } from '@/lib/knowledge/connectors/sync-persistence'
import * as cleanup from '@/lib/knowledge/documents/storage-cleanup'
import * as storage from '@/lib/uploads/core/storage-service'
import { getFileMetadataByKeys } from '@/lib/uploads/server/metadata'
import type { ExternalDocument } from '@/connectors/types'

describe('connector upload crash recovery', () => {
  const ids = createKnowledgeAclFixtureIds()
  const events: string[] = []
  beforeAll(async () => {
    fixtureStorage.root = mkdtempSync(path.join(tmpdir(), 'sim-connector-upload-'))
    await seedKnowledgeAclFixture(ids)
  })
  afterAll(async () => {
    vi.restoreAllMocks()
    if (events.length) await db.delete(outboxEvent).where(inArray(outboxEvent.id, events))
    await db.delete(knowledgeBase).where(eq(knowledgeBase.id, ids.knowledgeBaseId))
    await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
    await db.delete(organization).where(eq(organization.id, ids.organizationId))
    await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
    await rm(fixtureStorage.root, { recursive: true, force: true })
    await db.$client.end()
  })

  function input() {
    return {
      documentId: generateId(),
      key: `kb/${generateId()}.txt`,
      owner: { workspaceId: ids.workspaceId, userId: ids.aliceId },
      artifact: {
        bytes: Buffer.from('Synthetic reserved content'),
        fileName: 'fixture.txt',
        mimeType: 'text/plain',
      },
    }
  }

  async function runCleanup(documentId: string) {
    const [event] = await db
      .select()
      .from(outboxEvent)
      .where(
        sql`${outboxEvent.eventType} = ${cleanup.KNOWLEDGE_STORAGE_CLEANUP_EVENT} AND ${outboxEvent.payload}::jsonb ->> 'documentId' = ${documentId}`
      )
      .limit(1)
    expect(event).toBeDefined()
    events.push(event.id)
    await db
      .update(outboxEvent)
      .set({ availableAt: new Date(0) })
      .where(eq(outboxEvent.id, event.id))
    expect(
      await processOutboxEventById(event.id, {
        [cleanup.KNOWLEDGE_STORAGE_CLEANUP_EVENT]: cleanup.cleanupKnowledgeStorage,
      })
    ).toBe('completed')
  }

  it('rolls back reservation and never writes bytes when the cleanup insert fails', async () => {
    const fixture = input()
    const enqueue = vi
      .spyOn(cleanup, 'enqueueKnowledgeStorageCleanup')
      .mockRejectedValueOnce(new Error('Synthetic outbox failure'))
    const upload = vi.spyOn(storage, 'uploadFile')
    try {
      await expect(uploadConnectorArtifact(fixture)).rejects.toThrow('Synthetic outbox failure')
      expect(upload).not.toHaveBeenCalled()
      expect(
        await db
          .select({ id: workspaceFiles.id })
          .from(workspaceFiles)
          .where(eq(workspaceFiles.key, fixture.key))
      ).toEqual([])
      await expect(access(path.join(fixtureStorage.root, fixture.key))).rejects.toMatchObject({
        code: 'ENOENT',
      })
    } finally {
      enqueue.mockRestore()
      upload.mockRestore()
    }
  })

  it('cleans an upload whose worker dies before the document attachment', async () => {
    const fixture = input()
    const uploaded = await uploadConnectorArtifact(fixture)
    expect((await getFileMetadataByKeys([fixture.key], 'knowledge-base'))[0].id).toBe(
      uploaded.metadataId
    )
    expect(await readFile(path.join(fixtureStorage.root, fixture.key), 'utf8')).toBe(
      fixture.artifact.bytes.toString()
    )
    await runCleanup(fixture.documentId)
    expect(await getFileMetadataByKeys([fixture.key], 'knowledge-base')).toEqual([])
    await expect(access(path.join(fixtureStorage.root, fixture.key))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('cleans a reservation even if the worker dies before writing bytes', async () => {
    const fixture = input()
    const upload = vi
      .spyOn(storage, 'uploadFile')
      .mockRejectedValueOnce(new Error('Synthetic worker stop'))
    try {
      await expect(uploadConnectorArtifact(fixture)).rejects.toThrow('Synthetic worker stop')
    } finally {
      upload.mockRestore()
    }
    expect(await getFileMetadataByKeys([fixture.key], 'knowledge-base')).toHaveLength(1)
    await runCleanup(fixture.documentId)
    expect(await getFileMetadataByKeys([fixture.key], 'knowledge-base')).toEqual([])
  })

  it.each(['add', 'update'] as const)(
    'protects an uploaded artifact while %s waits for the knowledge-base lock',
    async (operation) => {
      const documentId = generateId()
      const source: ExternalDocument = {
        externalId: generateId(),
        title: 'Contended source',
        content: 'Synthetic updated source content',
        mimeType: 'text/plain',
        contentHash: 'updated-content',
      }
      if (operation === 'update') {
        await db.insert(document).values({
          id: documentId,
          knowledgeBaseId: ids.knowledgeBaseId,
          connectorId: ids.connectorId,
          externalId: source.externalId,
          filename: source.title,
          fileUrl: 'data:text/plain,Previous%20content',
          fileSize: 16,
          mimeType: 'text/plain',
          processingStatus: 'completed',
        })
      }

      let releaseKb: (() => void) | undefined
      let announceKbLock: ((pid: number) => void) | undefined
      const kbReleased = new Promise<void>((resolve) => {
        releaseKb = resolve
      })
      const kbLocked = new Promise<number>((resolve) => {
        announceKbLock = resolve
      })
      const blocker = db.transaction(async (tx) => {
        const [row] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
        await tx.execute(
          sql`SELECT id FROM knowledge_base WHERE id = ${ids.knowledgeBaseId} FOR UPDATE`
        )
        announceKbLock?.(row.pid)
        await kbReleased
      })
      const blockerPid = await kbLocked

      let releaseUpload: (() => void) | undefined
      let announceUpload:
        | ((file: Awaited<ReturnType<typeof storage.uploadFile>>) => void)
        | undefined
      const uploadReleased = new Promise<void>((resolve) => {
        releaseUpload = resolve
      })
      const uploaded = new Promise<Awaited<ReturnType<typeof storage.uploadFile>>>((resolve) => {
        announceUpload = resolve
      })
      const originalUpload = storage.uploadFile
      const upload = vi.spyOn(storage, 'uploadFile').mockImplementation(async (options) => {
        const file = await originalUpload(options)
        announceUpload?.(file)
        await uploadReleased
        return file
      })
      const args = [
        ids.knowledgeBaseId,
        ids.connectorId,
        'confluence',
        source,
        { workspaceId: ids.workspaceId, userId: ids.aliceId },
        undefined,
        'workspace',
        { stillHeld: () => stillHoldsSyncLock(ids.connectorId, ids.lockId) },
      ] as const
      const attachment =
        operation === 'add' ? addDocument(...args) : updateDocument(documentId, ...args)
      const settled = attachment.then(
        (value) => ({ value }),
        (error: unknown) => ({ error })
      )
      try {
        const file = await uploaded
        const [event] = await db
          .select()
          .from(outboxEvent)
          .where(
            sql`${outboxEvent.eventType} = ${cleanup.KNOWLEDGE_STORAGE_CLEANUP_EVENT} AND ${outboxEvent.payload}->>'key' = ${file.key}`
          )
          .limit(1)
        events.push(event.id)
        await db
          .update(outboxEvent)
          .set({ availableAt: new Date(0) })
          .where(eq(outboxEvent.id, event.id))
        releaseUpload?.()
        await expect
          .poll(
            async () => {
              const waiting = await db.execute(
                sql`SELECT 1 FROM pg_stat_activity WHERE ${blockerPid} = ANY(pg_blocking_pids(pid)) LIMIT 1`
              )
              return waiting.length > 0
            },
            { interval: 1, timeout: 5000 }
          )
          .toBe(true)

        const handlers = {
          [cleanup.KNOWLEDGE_STORAGE_CLEANUP_EVENT]: cleanup.cleanupKnowledgeStorage,
        }
        expect(await processOutboxEventById(event.id, handlers)).toBe('pending')
        expect(await readFile(path.join(fixtureStorage.root, file.key), 'utf8')).toBe(
          source.content
        )
        releaseKb?.()
        await blocker
        const result = await settled
        expect(result).toHaveProperty('value')
        expect(await processOutboxEventById(event.id, handlers)).toBe('completed')
        expect(await getFileMetadataByKeys([file.key], 'knowledge-base')).toHaveLength(1)
        expect(await readFile(path.join(fixtureStorage.root, file.key), 'utf8')).toBe(
          source.content
        )
      } finally {
        releaseUpload?.()
        releaseKb?.()
        await Promise.allSettled([blocker, settled])
        upload.mockRestore()
      }
    }
  )

  it('preserves an older unbound object when a create-only upload encounters a key collision', async () => {
    const fixture = input()
    await storage.uploadFile({
      file: Buffer.from('Earlier upload content'),
      fileName: 'earlier.txt',
      contentType: 'text/plain',
      context: 'knowledge-base',
      customKey: fixture.key,
      preserveKey: true,
      metadata: { userId: ids.aliceId, workspaceId: ids.workspaceId },
      persistMetadata: false,
      createOnlyUploadId: generateId(),
    })
    await expect(uploadConnectorArtifact(fixture)).rejects.toThrow()
    await runCleanup(fixture.documentId)
    expect(await readFile(path.join(fixtureStorage.root, fixture.key), 'utf8')).toBe(
      'Earlier upload content'
    )
    expect(await getFileMetadataByKeys([fixture.key], 'knowledge-base')).toEqual([])
  })
})
