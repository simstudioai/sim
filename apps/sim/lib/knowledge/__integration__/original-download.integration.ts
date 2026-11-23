/**
 * The v2 knowledge document download route against real PostgreSQL and local object storage,
 * through its route handler with a real workspace API key. A download parses nothing, so it serves
 * any stored original up to the stored-document limit, including one past the text-extraction cap
 * that a parsing read refuses.
 */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { db } from '@sim/db'
import { apiKey, document, knowledgeBase, organization, user, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const fixtureStorage = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/uploads/core/setup.server', () => ({
  get UPLOAD_DIR_SERVER() {
    return fixtureStorage.root
  },
}))

import { hashApiKey } from '@/lib/api-key/crypto'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { uploadFile } from '@/lib/uploads/core/storage-service'
import { MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE } from '@/lib/uploads/shared/types'
import { MAX_TEXT_EXTRACTION_BYTES } from '@/lib/uploads/utils/file'
import { GET } from '@/app/api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/content/route'

const ids = createKnowledgeAclFixtureIds()
const key = `sk-sim-fixture-${generateId()}`

async function seedStoredDocument(bytes: Buffer, fileSize = bytes.byteLength) {
  const id = generateId()
  const storageKey = `kb/${id}.bin`
  await uploadFile({
    file: bytes,
    fileName: 'original.bin',
    contentType: 'application/octet-stream',
    context: 'knowledge-base',
    customKey: storageKey,
    preserveKey: true,
    persistMetadata: false,
  })
  await db.insert(document).values({
    id,
    knowledgeBaseId: ids.knowledgeBaseId,
    filename: 'original.bin',
    fileUrl: '',
    storageKey,
    fileSize,
    mimeType: 'application/octet-stream',
    processingStatus: 'completed',
    acl: ['ws'],
    aclRequirements: [],
    aclVerifiedAt: new Date(),
  })
  return id
}

function download(documentId: string) {
  const request = new NextRequest(
    `http://localhost:3000/api/v2/knowledge/${ids.knowledgeBaseId}/documents/${documentId}/content?workspaceId=${ids.workspaceId}`,
    { headers: { 'x-api-key': key, 'x-forwarded-for': '127.0.0.1' } }
  )
  return GET(request, {
    params: Promise.resolve({ knowledgeBaseId: ids.knowledgeBaseId, documentId }),
  })
}

beforeAll(async () => {
  fixtureStorage.root = mkdtempSync(path.join(tmpdir(), 'sim-knowledge-download-'))
  await seedKnowledgeAclFixture(ids)
  await db.insert(apiKey).values({
    id: generateId(),
    userId: ids.aliceId,
    workspaceId: ids.workspaceId,
    createdBy: ids.aliceId,
    name: 'Download fixture',
    key,
    keyHash: hashApiKey(key),
    type: 'workspace',
    access: 'read',
  })
})

afterAll(async () => {
  await db.delete(knowledgeBase).where(eq(knowledgeBase.id, ids.knowledgeBaseId))
  await deleteWorkspaceFixture(db, eq(workspace.id, ids.workspaceId))
  await db.delete(organization).where(eq(organization.id, ids.organizationId))
  await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
  await rm(fixtureStorage.root, { recursive: true, force: true })
  await db.$client.end()
})

describe('GET /api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/content', () => {
  it('downloads an original larger than the text-extraction cap', async () => {
    const bytes = Buffer.alloc(MAX_TEXT_EXTRACTION_BYTES + 1024 * 1024, 'k')
    const documentId = await seedStoredDocument(bytes)

    const response = await download(documentId)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBe(String(bytes.byteLength))
    expect(Buffer.from(await response.arrayBuffer()).equals(bytes)).toBe(true)
  })

  it('refuses a document recorded past the stored-document limit', async () => {
    const documentId = await seedStoredDocument(
      Buffer.from('small'),
      MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE + 1
    )

    const response = await download(documentId)

    expect(response.status).toBe(413)
  })
})
