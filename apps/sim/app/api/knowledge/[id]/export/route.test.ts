/**
 * @vitest-environment node
 */
import { Readable } from 'node:stream'
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockExportBundle,
  mockBuildKnowledgeBundleArchive,
  mockKnowledgeBundleFileName,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockExportBundle: vi.fn(),
  mockBuildKnowledgeBundleArchive: vi.fn(),
  mockKnowledgeBundleFileName: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))

vi.mock('@/lib/knowledge/application/exports', () => ({
  exportKnowledgeBase: {
    operation: { id: 'knowledge.export', minimumRole: 'read', workspaceApiKey: 'allow' },
    execute: mockExportBundle,
  },
}))

vi.mock('@/lib/knowledge/transfer/export-archive', () => ({
  buildKnowledgeBundleArchive: mockBuildKnowledgeBundleArchive,
  knowledgeBundleFileName: mockKnowledgeBundleFileName,
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { GET } from '@/app/api/knowledge/[id]/export/route'

const KNOWLEDGE_BASE_ID = 'kb-1'
const FILE_NAME = 'Support docs.simkb.zip'
const context = { params: Promise.resolve({ id: KNOWLEDGE_BASE_ID }) }

const BUNDLE = {
  knowledgeBase: { name: 'Support docs', description: null, chunkingConfig: null },
  embedding: { model: 'text-embedding-3-small', dimension: 1536 },
  tags: [],
  documents: [],
  chunks: () => Readable.from([]),
}

function requestFor(query = '') {
  return createMockRequest(
    'GET',
    undefined,
    {},
    `http://localhost:3000/api/knowledge/${KNOWLEDGE_BASE_ID}/export${query ? `?${query}` : ''}`
  )
}

describe('GET /api/knowledge/[id]/export', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' }, session: { id: 'session-1' } })
    mockExportBundle.mockResolvedValue(BUNDLE)
    mockBuildKnowledgeBundleArchive.mockImplementation(() => Readable.from([Buffer.from('zip')]))
    mockKnowledgeBundleFileName.mockReturnValue(FILE_NAME)
  })

  it('streams the bundle the use case returns as a zip', async () => {
    const response = await GET(requestFor(), context)

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/zip')
    expect(response.headers.get('Content-Disposition')).toBe(`attachment; filename="${FILE_NAME}"`)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.text()).toBe('zip')
    expect(mockBuildKnowledgeBundleArchive).toHaveBeenCalledWith(BUNDLE)
    expect(mockKnowledgeBundleFileName).toHaveBeenCalledWith('Support docs')
  })

  it('maps the route param and defaults vectors to true', async () => {
    await GET(requestFor(), context)

    expect(mockExportBundle).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { knowledgeBaseId: KNOWLEDGE_BASE_ID, vectors: true },
      })
    )
  })

  it('passes vectors=false through to the use case', async () => {
    await GET(requestFor('vectors=false'), context)

    expect(mockExportBundle).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ vectors: false }) })
    )
  })

  it('authenticates before dispatching the use case', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await GET(requestFor(), context)

    expect(response.status).toBe(401)
    expect(mockExportBundle).not.toHaveBeenCalled()
  })

  it('answers 404 for a missing knowledge base', async () => {
    mockExportBundle.mockRejectedValue(
      new OrchestrationError('not_found', 'Knowledge base not found')
    )

    const response = await GET(requestFor(), context)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Knowledge base not found' })
  })

  it('answers 413 when the bundle exceeds the export ceiling', async () => {
    mockExportBundle.mockRejectedValue(
      new OrchestrationError('payload_too_large', 'Knowledge base is too large to export')
    )

    const response = await GET(requestFor(), context)

    expect(response.status).toBe(413)
  })
})
