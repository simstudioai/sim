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
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' }, session: { id: 'session-1' } })
    mockExportBundle.mockResolvedValue(BUNDLE)
    mockBuildKnowledgeBundleArchive.mockImplementation(() => Readable.from([Buffer.from('zip')]))
    mockKnowledgeBundleFileName.mockReturnValue(FILE_NAME)
  })

  it('answers 413 when the bundle exceeds the export ceiling', async () => {
    mockExportBundle.mockRejectedValue(
      new OrchestrationError('payload_too_large', 'Knowledge base is too large to export')
    )

    const response = await GET(requestFor(), context)

    expect(response.status).toBe(413)
  })
})
