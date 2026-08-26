/**
 * @vitest-environment node
 */
import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockListTags, mockCreateTag, mockBulkSave, mockDeleteDefinitions } = vi.hoisted(() => ({
  mockListTags: vi.fn(),
  mockCreateTag: vi.fn(),
  mockBulkSave: vi.fn(),
  mockDeleteDefinitions: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

vi.mock('@/lib/knowledge/application/tags', () => ({
  listKnowledgeTags: { operation: { id: 'knowledge.tags.list' }, execute: mockListTags },
  createKnowledgeTag: { operation: { id: 'knowledge.tags.create' }, execute: mockCreateTag },
  saveKnowledgeDocumentTagDefinitions: {
    operation: { id: 'knowledge.tags.bulk_save' },
    execute: mockBulkSave,
  },
  deleteKnowledgeDocumentTagDefinitions: {
    operation: { id: 'knowledge.tags.cleanup' },
    execute: mockDeleteDefinitions,
  },
}))

import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { DELETE, GET, POST, PUT } from '@/app/api/v2/knowledge/[knowledgeBaseId]/tags/route'

const WORKSPACE_ID = 'workspace-1'
const PRINCIPAL = { kind: 'workspace_api_key', workspaceId: WORKSPACE_ID, keyId: 'key-1' } as const

function buildRequest(query = `?workspaceId=${WORKSPACE_ID}`) {
  return new NextRequest(`http://localhost/api/v2/knowledge/kb-1/tags${query}`, {
    headers: { 'x-api-key': 'secret' },
  })
}

function buildCreateRequest(body: unknown) {
  return new NextRequest('http://localhost/api/v2/knowledge/kb-1/tags', {
    method: 'POST',
    headers: { 'x-api-key': 'secret', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const context = { params: Promise.resolve({ knowledgeBaseId: 'kb-1' }) }

describe('GET /api/v2/knowledge/[knowledgeBaseId]/tags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    v2RouteMocks.authenticate.mockResolvedValue({
      principal: PRINCIPAL,
      rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`],
      rateLimitSubscription: null,
      keyType: 'workspace',
    })
    mockListTags.mockResolvedValue({
      tagDefinitions: [
        {
          id: 'tag-def-1',
          knowledgeBaseId: 'kb-1',
          tagSlot: 'tag1',
          displayName: 'category',
          fieldType: 'text',
          createdAt: new Date('2025-01-10T09:00:00Z'),
          updatedAt: new Date('2025-01-10T09:00:00Z'),
        },
      ],
    })
  })

  it('returns the tag vocabulary as a full-set list', async () => {
    const response = await GET(buildRequest(), context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: [{ id: 'tag-def-1', displayName: 'category', tagSlot: 'tag1', fieldType: 'text' }],
      nextCursor: null,
    })
    expect(mockListTags).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: PRINCIPAL,
        input: { knowledgeBaseId: 'kb-1', assertedWorkspaceId: WORKSPACE_ID },
      })
    )
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  /**
   * The identifier is published; the row's own timestamps and its redundant
   * `knowledgeBaseId` are not. `PATCH` and `DELETE` address a definition by id,
   * so withholding it left both unreachable.
   */
  it('publishes the tag definition identifier but not its timestamps', async () => {
    const response = await GET(buildRequest(), context)

    const [tag] = (await response.json()).data
    expect(Object.keys(tag).sort()).toEqual(['displayName', 'fieldType', 'id', 'tagSlot'])
  })

  it('requires the workspace scope', async () => {
    const response = await GET(buildRequest(''), context)

    expect(response.status).toBe(400)
    expect(mockListTags).not.toHaveBeenCalled()
  })

  it('is reachable by a workspace API key, like its sibling knowledge reads', () => {
    expect(knowledgeOperations.listTags.workspaceApiKey).toBe('allow')
    expect(knowledgeOperations.listTags.principalKinds).toContain('workspace_api_key')
    expect(knowledgeOperations.listTags.workspaceApiKey).toBe(
      knowledgeOperations.listDocuments.workspaceApiKey
    )
  })
})

describe('POST /api/v2/knowledge/[knowledgeBaseId]/tags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    v2RouteMocks.authenticate.mockResolvedValue({
      principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
      rateLimitSubjectIds: ['api-key:key-1'],
      rateLimitSubscription: null,
      keyType: 'personal',
    })
    mockCreateTag.mockResolvedValue({
      knowledgeBaseId: 'kb-1',
      tagDefinition: {
        id: 'tag-def-1',
        tagSlot: 'tag1',
        displayName: 'category',
        fieldType: 'text',
        createdAt: new Date('2025-01-10T09:00:00Z'),
        updatedAt: new Date('2025-01-10T09:00:00Z'),
      },
    })
  })

  it('creates a tag definition and answers 201 with its identifier', async () => {
    const response = await POST(
      buildCreateRequest({ workspaceId: WORKSPACE_ID, displayName: 'category' }),
      context
    )

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({
      data: { id: 'tag-def-1', displayName: 'category', tagSlot: 'tag1', fieldType: 'text' },
    })
    expect(mockCreateTag).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          knowledgeBaseId: 'kb-1',
          assertedWorkspaceId: WORKSPACE_ID,
          displayName: 'category',
          fieldType: 'text',
          tagSlot: undefined,
          source: 'api',
        },
      })
    )
  })

  it('rejects a field type outside the supported set and names the valid ones', async () => {
    const response = await POST(
      buildCreateRequest({ workspaceId: WORKSPACE_ID, displayName: 'category', fieldType: 'uuid' }),
      context
    )

    expect(response.status).toBe(400)
    expect((await response.json()).error.message).toContain('fieldType')
    expect(mockCreateTag).not.toHaveBeenCalled()
  })

  it('rejects a slot that is not a real tag slot', async () => {
    const response = await POST(
      buildCreateRequest({ workspaceId: WORKSPACE_ID, displayName: 'category', tagSlot: 'tag99' }),
      context
    )

    expect(response.status).toBe(400)
    expect(mockCreateTag).not.toHaveBeenCalled()
  })

  it('rejects an unknown body key rather than dropping it', async () => {
    const response = await POST(
      buildCreateRequest({ workspaceId: WORKSPACE_ID, displayName: 'category', slot: 'tag1' }),
      context
    )

    expect(response.status).toBe(400)
    expect(mockCreateTag).not.toHaveBeenCalled()
  })

  /**
   * Reads share the vocabulary with document filtering, which a workspace key
   * may already perform; defining the vocabulary is a write and does not.
   */
  it('denies a workspace API key, unlike the sibling read', () => {
    expect(knowledgeOperations.createTag.workspaceApiKey).toBe('deny')
    expect(knowledgeOperations.createTag.principalKinds).not.toContain('workspace_api_key')
  })
})

/**
 * The vocabulary writes moved here from
 * `/knowledge/{knowledgeBaseId}/documents/{documentId}/tags`, which named a document neither
 * of them ever read: both write `knowledge_base_tag_definitions`, keyed by
 * knowledge base and slot.
 */
describe('PUT /api/v2/knowledge/[knowledgeBaseId]/tags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    v2RouteMocks.authenticate.mockResolvedValue({
      principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
      rateLimitSubjectIds: ['api-key:key-1'],
      rateLimitSubscription: null,
      keyType: 'personal',
    })
    mockBulkSave.mockResolvedValue({
      created: [
        {
          id: 'tag-def-1',
          tagSlot: 'tag1',
          displayName: 'category',
          fieldType: 'text',
          createdAt: new Date('2025-01-10T09:00:00Z'),
          updatedAt: new Date('2025-01-10T09:00:00Z'),
        },
      ],
      updated: [],
      errors: [],
    })
  })

  function buildPutRequest(body: unknown) {
    return new NextRequest('http://localhost/api/v2/knowledge/kb-1/tags', {
      method: 'PUT',
      headers: { 'x-api-key': 'secret', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('upserts definitions against the knowledge base, with no document in the input', async () => {
    const response = await PUT(
      buildPutRequest({
        workspaceId: WORKSPACE_ID,
        definitions: [{ tagSlot: 'tag1', displayName: 'category', fieldType: 'text' }],
      }),
      context
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        created: [{ id: 'tag-def-1', displayName: 'category', tagSlot: 'tag1', fieldType: 'text' }],
        updated: [],
        errors: [],
      },
    })
    expect(mockBulkSave).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          knowledgeBaseId: 'kb-1',
          assertedWorkspaceId: WORKSPACE_ID,
          definitions: [{ tagSlot: 'tag1', displayName: 'category', fieldType: 'text' }],
        },
      })
    )
  })

  it('rejects an empty definition list rather than writing nothing', async () => {
    const response = await PUT(
      buildPutRequest({ workspaceId: WORKSPACE_ID, definitions: [] }),
      context
    )

    expect(response.status).toBe(400)
    expect(mockBulkSave).not.toHaveBeenCalled()
  })

  it('rejects a query param on a body-only write', async () => {
    const request = new NextRequest(
      'http://localhost/api/v2/knowledge/kb-1/tags?documentId=doc-1',
      {
        method: 'PUT',
        headers: { 'x-api-key': 'secret', 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: WORKSPACE_ID,
          definitions: [{ tagSlot: 'tag1', displayName: 'category', fieldType: 'text' }],
        }),
      }
    )

    expect((await PUT(request, context)).status).toBe(400)
    expect(mockBulkSave).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/v2/knowledge/[knowledgeBaseId]/tags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    v2RouteMocks.authenticate.mockResolvedValue({
      principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
      rateLimitSubjectIds: ['api-key:key-1'],
      rateLimitSubscription: null,
      keyType: 'personal',
    })
    mockDeleteDefinitions.mockResolvedValue({ action: 'cleanup', count: 2 })
  })

  function buildDeleteRequest(query: string) {
    return new NextRequest(`http://localhost/api/v2/knowledge/kb-1/tags${query}`, {
      method: 'DELETE',
      headers: { 'x-api-key': 'secret' },
    })
  }

  it('removes only the unused definitions by default', async () => {
    const response = await DELETE(buildDeleteRequest(`?workspaceId=${WORKSPACE_ID}`), context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { unused: true, count: 2 } })
    expect(mockDeleteDefinitions).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          knowledgeBaseId: 'kb-1',
          assertedWorkspaceId: WORKSPACE_ID,
          action: 'cleanup',
        },
      })
    )
  })

  it('deletes the whole vocabulary only when asked in so many words', async () => {
    mockDeleteDefinitions.mockResolvedValue({ action: 'all', count: 7 })

    const response = await DELETE(
      buildDeleteRequest(`?workspaceId=${WORKSPACE_ID}&unused=false`),
      context
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { unused: false, count: 7 } })
    expect(mockDeleteDefinitions).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ action: 'all' }) })
    )
  })

  /**
   * `unused` is a real boolean via `booleanQueryFlagSchema`, not a string enum,
   * so an unrecognised spelling is a 400 rather than a silent truthy read that
   * would delete the wrong half of the vocabulary.
   */
  it('rejects a spelling of unused it does not accept', async () => {
    const response = await DELETE(
      buildDeleteRequest(`?workspaceId=${WORKSPACE_ID}&unused=maybe`),
      context
    )

    expect(response.status).toBe(400)
    expect(mockDeleteDefinitions).not.toHaveBeenCalled()
  })

  it('requires the workspace scope', async () => {
    expect((await DELETE(buildDeleteRequest(''), context)).status).toBe(400)
    expect(mockDeleteDefinitions).not.toHaveBeenCalled()
  })

  /**
   * Both vocabulary writes report themselves against the knowledge base, which
   * is what they act on — the ids no longer name a document.
   */
  it('binds the knowledge-base-scoped semantic operations', () => {
    expect(knowledgeOperations.saveDocumentTagDefinitions.id).toBe('knowledge.tags.bulk_save')
    expect(knowledgeOperations.deleteDocumentTagDefinitions.id).toBe('knowledge.tags.cleanup')
  })
})
