/**
 * Knowledge-base document totals against real PostgreSQL: the public v1 list and detail count
 * only the documents their caller can read, and the internal list reads no document at all
 * unless the caller asks for totals. A request without the flag is counted, since a page loaded
 * before the flag existed requires both totals on every row.
 */
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { document, organization, user, workspace } from '@sim/db/schema'
import { authMock, authMockFns, createMockRequest } from '@sim/testing'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const caller = vi.hoisted(() => ({ userId: '' }))

vi.mock('@/lib/auth', () => authMock)

vi.mock('@/app/api/v1/middleware', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/api/v1/middleware')>()),
  authenticateRequest: async () => ({
    requestId: 'fixture-request',
    userId: caller.userId,
    rateLimit: {
      allowed: true,
      remaining: 1,
      limit: 1,
      resetAt: new Date(),
      userId: caller.userId,
      keyType: 'personal',
    },
  }),
}))

import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { listInternalKnowledgeBases } from '@/lib/knowledge/application/knowledge-bases'
import { GET as listInternalKnowledgeBasesRoute } from '@/app/api/knowledge/route'
import { GET as getKnowledgeBase } from '@/app/api/v1/knowledge/[id]/route'
import { GET as listKnowledgeBases } from '@/app/api/v1/knowledge/route'

const ids = createKnowledgeAclFixtureIds()
const reader: Principal = { kind: 'session', userId: ids.bobId, sessionId: 'fixture-reader' }

describe('knowledge-base document totals in PostgreSQL', () => {
  beforeAll(async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('Unexpected provider request in knowledge-base count tests')
    })
    caller.userId = ids.bobId
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: ids.bobId },
      session: { id: 'fixture-reader' },
    })
    await seedKnowledgeAclFixture(ids, { connectorType: 'google_drive' })
    await db.insert(document).values([
      {
        id: generateId(),
        knowledgeBaseId: ids.knowledgeBaseId,
        filename: 'Uploaded handbook',
        fileUrl: 'https://fixture.test/uploaded',
        fileSize: 10,
        mimeType: 'text/plain',
        tokenCount: 10,
        processingStatus: 'completed',
      },
      {
        id: generateId(),
        knowledgeBaseId: ids.knowledgeBaseId,
        filename: 'Private source document',
        fileUrl: 'https://fixture.test/private',
        fileSize: 20,
        mimeType: 'text/plain',
        tokenCount: 20,
        processingStatus: 'completed',
        connectorId: ids.connectorId,
        externalId: 'private-fixture',
        contentHash: 'fixture',
        acl: [`u:${ids.aliceId}@fixture.test`],
        aclVerifiedAt: new Date(),
      },
    ])
  })

  afterAll(async () => {
    await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
    await db.delete(organization).where(eq(organization.id, ids.organizationId))
    await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
    vi.unstubAllGlobals()
  })

  it('lists only the documents a v1 caller can read', async () => {
    const response = await listKnowledgeBases(
      createMockRequest(
        'GET',
        undefined,
        {},
        `http://localhost/api/v1/knowledge?workspaceId=${ids.workspaceId}`
      ),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(200)
    const { data } = await response.json()
    expect(data.knowledgeBases).toEqual([
      expect.objectContaining({ id: ids.knowledgeBaseId, docCount: 1, tokenCount: 10 }),
    ])
  })

  it('details only the documents a v1 caller can read', async () => {
    const response = await getKnowledgeBase(
      createMockRequest(
        'GET',
        undefined,
        {},
        `http://localhost/api/v1/knowledge/${ids.knowledgeBaseId}?workspaceId=${ids.workspaceId}`
      ),
      { params: Promise.resolve({ id: ids.knowledgeBaseId }) }
    )
    expect(response.status).toBe(200)
    const { data } = await response.json()
    expect(data.knowledgeBase).toMatchObject({
      id: ids.knowledgeBaseId,
      docCount: 1,
      tokenCount: 10,
    })
  })

  it('omits totals from the internal list unless the caller asks for them', async () => {
    const input = { workspaceId: ids.workspaceId, scope: 'active' } as const
    const [plain] = (await listInternalKnowledgeBases.execute({ principal: reader, input }))
      .knowledgeBases
    expect(plain).not.toHaveProperty('docCount')
    expect(plain).not.toHaveProperty('tokenCount')

    const [counted] = (
      await listInternalKnowledgeBases.execute({
        principal: reader,
        input: { ...input, includeCounts: true },
      })
    ).knowledgeBases
    expect(counted).toMatchObject({ docCount: 1, tokenCount: 10 })
  })

  it('counts an internal list request that omits the flag', async () => {
    const list = async (query: string) => {
      const response = await listInternalKnowledgeBasesRoute(
        createMockRequest('GET', undefined, {}, `http://localhost/api/knowledge?${query}`),
        { params: Promise.resolve({}) }
      )
      expect(response.status).toBe(200)
      return (await response.json()).data
    }
    const workspaceQuery = `workspaceId=${ids.workspaceId}&scope=active`
    expect(await list(workspaceQuery)).toEqual([
      expect.objectContaining({ id: ids.knowledgeBaseId, docCount: 1, tokenCount: 10 }),
    ])
    const [uncounted] = await list(`${workspaceQuery}&includeCounts=false`)
    expect(uncounted).not.toHaveProperty('tokenCount')
  })
})
