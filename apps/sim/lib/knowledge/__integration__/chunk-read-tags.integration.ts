/**
 * A chunk read loads the full stored row, typed tag slots included, and both read surfaces present
 * it from that row: the internal route keeps every stored field and serializes the date slots,
 * while v2 and the chunk listing project only their own fields. Runs the real use cases against
 * PostgreSQL.
 */
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { document, embedding, organization, user, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getKnowledgeChunkContract } from '@/lib/api/contracts/knowledge'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { toInternalKnowledgeChunk } from '@/lib/knowledge/api/internal-route'
import { listKnowledgeChunks, readKnowledgeChunk } from '@/lib/knowledge/application/chunks'
import { embeddingVectorValues } from '@/lib/knowledge/vector-columns'
import { toV2KnowledgeChunk } from '@/app/api/v2/knowledge/utils'

afterAll(async () => {
  await db.$client.end()
})

describe('reading a chunk whose document carries date tags', () => {
  const ids = createKnowledgeAclFixtureIds()
  const documentId = generateId()
  const chunkId = generateId()
  const taggedAt = new Date('2026-03-04T05:06:07.000Z')
  const createdAt = new Date('2026-01-02T03:04:05.000Z')
  const reader: Principal = { kind: 'session', userId: ids.aliceId, sessionId: 'fixture-session' }
  const input = { knowledgeBaseId: ids.knowledgeBaseId, documentId, chunkId }

  beforeAll(async () => {
    await seedKnowledgeAclFixture(ids)
    await db.insert(document).values({
      id: documentId,
      knowledgeBaseId: ids.knowledgeBaseId,
      filename: 'dated.txt',
      fileUrl: `https://fixture.invalid/${documentId}`,
      fileSize: 12,
      mimeType: 'text/plain',
      processingStatus: 'completed',
      acl: ['ws'],
      date1: taggedAt,
    })
    await db.insert(embedding).values({
      id: chunkId,
      documentId,
      knowledgeBaseId: ids.knowledgeBaseId,
      chunkIndex: 0,
      chunkHash: chunkId,
      content: 'Dated chunk',
      contentLength: 11,
      tokenCount: 2,
      startOffset: 0,
      endOffset: 11,
      date1: taggedAt,
      createdAt,
      updatedAt: createdAt,
      ...embeddingVectorValues(1536, [1, ...Array<number>(1535).fill(0)]),
    })
  })

  afterAll(async () => {
    await deleteWorkspaceFixture(db, eq(workspace.id, ids.workspaceId))
    await db.delete(organization).where(eq(organization.id, ids.organizationId))
    await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
  })

  it('presents the date slots as ISO strings on the internal route', async () => {
    const { chunk } = await readKnowledgeChunk.execute({ principal: reader, input })
    const body = { success: true as const, data: toInternalKnowledgeChunk(chunk) }

    expect(body.data).toMatchObject({
      id: chunkId,
      content: 'Dated chunk',
      date1: taggedAt.toISOString(),
      date2: null,
      createdAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
    })
    expect(getKnowledgeChunkContract.response.schema.parse(body)).toEqual(body)
  })

  it('leaves the projected listing without date slots', async () => {
    const { chunks } = await listKnowledgeChunks.execute({
      principal: reader,
      input: { knowledgeBaseId: ids.knowledgeBaseId, documentId },
    })
    const [listed] = chunks.map(toInternalKnowledgeChunk)

    expect(listed.id).toBe(chunkId)
    expect(Object.keys(listed)).not.toContain('date1')
    expect(Object.keys(listed)).not.toContain('date2')
  })

  it('keeps the v2 projection to its own fields', async () => {
    const { chunk } = await readKnowledgeChunk.execute({ principal: reader, input })

    expect(toV2KnowledgeChunk(chunk)).toEqual({
      id: chunkId,
      chunkIndex: 0,
      content: 'Dated chunk',
      contentLength: 11,
      tokenCount: 2,
      enabled: true,
      startOffset: 0,
      endOffset: 11,
      tag1: null,
      tag2: null,
      tag3: null,
      tag4: null,
      tag5: null,
      tag6: null,
      tag7: null,
      createdAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
    })
  })
})
