/** Durable pre-upload intent, create-only objects and crash recovery against real PostgreSQL and local storage. */
import { mkdtempSync } from 'node:fs'
import { access, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { db } from '@sim/db'
import {
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
import * as cleanup from '@/lib/knowledge/documents/storage-cleanup'
import * as storage from '@/lib/uploads/core/storage-service'
import { getFileMetadataByKeys } from '@/lib/uploads/server/metadata'

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
