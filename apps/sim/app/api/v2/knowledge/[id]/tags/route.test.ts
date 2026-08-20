/**
 * @vitest-environment node
 */
import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2GateModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockListTags, mockCreateTag } = vi.hoisted(() => ({
  mockListTags: vi.fn(),
  mockCreateTag: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/app/api/v2/lib/gate', () => v2GateModuleMock)

vi.mock('@/lib/knowledge/application/tags', () => ({
  listKnowledgeTags: { operation: { id: 'knowledge.tags.list' }, execute: mockListTags },
  createKnowledgeTag: { operation: { id: 'knowledge.tags.create' }, execute: mockCreateTag },
}))

import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { GET, POST } from '@/app/api/v2/knowledge/[id]/tags/route'

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

const context = { params: Promise.resolve({ id: 'kb-1' }) }

describe('GET /api/v2/knowledge/[id]/tags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    v2RouteMocks.gate.mockResolvedValue(null)
    v2RouteMocks.authenticate.mockResolvedValue({
      principal: PRINCIPAL,
      rolloutUserId: 'billing-owner',
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

describe('POST /api/v2/knowledge/[id]/tags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    v2RouteMocks.gate.mockResolvedValue(null)
    v2RouteMocks.authenticate.mockResolvedValue({
      principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
      rolloutUserId: 'user-1',
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
