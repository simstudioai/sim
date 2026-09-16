/**
 * @vitest-environment node
 */
import {
  MockV2ApiKeyUnauthenticatedError,
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  exportBundle: vi.fn(),
  authorizeExport: vi.fn(),
  buildKnowledgeBundleArchive: vi.fn(),
  knowledgeBundleFileName: vi.fn(),
}))

vi.mock('@/lib/knowledge/application/exports', () => ({
  exportKnowledgeBase: {
    operation: { id: 'knowledge.export', minimumRole: 'read', workspaceApiKey: 'allow' },
    execute: mocks.exportBundle,
    authorize: mocks.authorizeExport,
  },
}))

vi.mock('@/lib/knowledge/transfer/export-archive', () => ({
  buildKnowledgeBundleArchive: mocks.buildKnowledgeBundleArchive,
  knowledgeBundleFileName: mocks.knowledgeBundleFileName,
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

import { Readable } from 'node:stream'
import { NoWorkspaceAccessError } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { GET } from '@/app/api/v2/knowledge/[knowledgeBaseId]/export/route'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'
const KNOWLEDGE_BASE_ID = 'e0d2c0c8-3b4c-4a9f-9a3e-2f1d5c7b8a90'
const FILE_NAME = 'Support docs.simkb.zip'
const context = { params: Promise.resolve({ knowledgeBaseId: KNOWLEDGE_BASE_ID }) }

const AUTH = {
  principal: { kind: 'workspace_api_key' as const, workspaceId: WORKSPACE_ID, keyId: 'key-1' },
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}

const BUNDLE = {
  knowledgeBase: { name: 'Support docs', description: null, chunkingConfig: null },
  embedding: { model: 'text-embedding-3-small', dimension: 1536 },
  tags: [],
  documents: [],
  chunks: () => Readable.from([]),
}

function exportRequest(query = `workspaceId=${WORKSPACE_ID}`) {
  return new NextRequest(
    `http://localhost:3000/api/v2/knowledge/${KNOWLEDGE_BASE_ID}/export?${query}`,
    { headers: { 'x-api-key': 'secret' } }
  )
}

describe('GET /api/v2/knowledge/[knowledgeBaseId]/export', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.authorizeExport.mockResolvedValue(undefined)
    mocks.exportBundle.mockResolvedValue(BUNDLE)
    mocks.buildKnowledgeBundleArchive.mockImplementation(() => Readable.from([Buffer.from('zip')]))
    mocks.knowledgeBundleFileName.mockReturnValue(FILE_NAME)
  })

  it('streams the knowledge base as a zip bundle', async () => {
    const response = await GET(exportRequest(), context)

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/zip')
    expect(response.headers.get('Content-Disposition')).toBe(`attachment; filename="${FILE_NAME}"`)
    expect(response.headers.get('Cache-Control')).toContain('no-store')
    expect(await response.text()).toBe('zip')
    expect(mocks.buildKnowledgeBundleArchive).toHaveBeenCalledWith(BUNDLE)
    expect(mocks.knowledgeBundleFileName).toHaveBeenCalledWith('Support docs')
  })

  it('maps the knowledge base id and asserted workspace into the use case input', async () => {
    await GET(exportRequest(), context)

    expect(mocks.exportBundle).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: AUTH.principal,
        input: {
          knowledgeBaseId: KNOWLEDGE_BASE_ID,
          assertedWorkspaceId: WORKSPACE_ID,
          vectors: true,
        },
      })
    )
  })

  it('defaults the vectors flag to true when omitted', async () => {
    await GET(exportRequest(), context)

    expect(mocks.exportBundle).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ vectors: true }) })
    )
  })

  it('passes vectors=false through to the use case', async () => {
    await GET(exportRequest(`workspaceId=${WORKSPACE_ID}&vectors=false`), context)

    expect(mocks.exportBundle).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ vectors: false }) })
    )
  })

  it('rejects a request without a workspaceId', async () => {
    const response = await GET(exportRequest(''), context)

    expect(response.status).toBe(400)
    expect(mocks.exportBundle).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated request', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await GET(exportRequest(), context)

    expect(response.status).toBe(401)
    expect(mocks.exportBundle).not.toHaveBeenCalled()
  })

  it('answers 404 for a missing knowledge base', async () => {
    mocks.exportBundle.mockRejectedValueOnce(
      new OrchestrationError('not_found', 'Knowledge base not found')
    )

    const response = await GET(exportRequest(), context)

    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('NOT_FOUND')
  })

  it('answers 413 when the bundle exceeds the export ceiling', async () => {
    mocks.exportBundle.mockRejectedValueOnce(
      new OrchestrationError('payload_too_large', 'Knowledge base is too large to export')
    )

    const response = await GET(exportRequest(), context)

    expect(response.status).toBe(413)
    expect((await response.json()).error.code).toBe('PAYLOAD_TOO_LARGE')
  })

  /** Cross-tenant denials are concealed as an absent knowledge base. */
  it('conceals a cross-tenant workspace as 404', async () => {
    mocks.exportBundle.mockRejectedValueOnce(new NoWorkspaceAccessError())

    const response = await GET(exportRequest(), context)

    expect(response.status).toBe(404)
    expect((await response.json()).error.message).toBe('Knowledge base not found')
  })
})
