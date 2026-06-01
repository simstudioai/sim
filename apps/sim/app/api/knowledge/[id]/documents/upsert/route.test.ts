/**
 * Tests for knowledge base document upsert API route
 *
 * @vitest-environment node
 */
import {
  auditMock,
  createMockRequest,
  hybridAuthMock,
  hybridAuthMockFns,
  knowledgeApiUtilsMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDbChain } = vi.hoisted(() => {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  }
  return { mockDbChain: chain }
})

vi.mock('@sim/db', () => ({ db: mockDbChain }))
vi.mock('@/lib/auth/hybrid', () => hybridAuthMock)
vi.mock('@/app/api/knowledge/utils', () => knowledgeApiUtilsMock)
vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/knowledge/documents/service', () => ({
  createDocumentRecords: vi.fn(),
  deleteDocument: vi.fn(),
  getProcessingConfig: vi.fn().mockReturnValue({ maxConcurrentDocuments: 1, batchSize: 1 }),
  processDocumentsWithQueue: vi.fn(),
  KnowledgeBaseFileOwnershipError: class KnowledgeBaseFileOwnershipError extends Error {},
}))

import { createDocumentRecords, processDocumentsWithQueue } from '@/lib/knowledge/documents/service'
import { POST } from '@/app/api/knowledge/[id]/documents/upsert/route'
import { checkKnowledgeBaseWriteAccess } from '@/app/api/knowledge/utils'

describe('POST /api/knowledge/[id]/documents/upsert', () => {
  const params = Promise.resolve({ id: 'kb-123' })

  beforeEach(() => {
    vi.clearAllMocks()
    mockDbChain.select.mockReturnThis()
    mockDbChain.from.mockReturnThis()
    mockDbChain.where.mockReturnThis()
    mockDbChain.limit.mockResolvedValue([])

    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'session',
      userName: 'Test User',
      userEmail: 'test@example.com',
    })

    vi.mocked(checkKnowledgeBaseWriteAccess).mockResolvedValue({
      hasAccess: true,
      knowledgeBase: { id: 'kb-123', userId: 'user-1', workspaceId: 'ws-1', name: 'KB' },
    } as any)

    vi.mocked(createDocumentRecords).mockResolvedValue([
      { documentId: 'doc-new', filename: 'note.txt' },
    ] as any)
    vi.mocked(processDocumentsWithQueue).mockResolvedValue(undefined as any)
  })

  const baseBody = {
    filename: 'note.txt',
    fileSize: 11,
    mimeType: 'text/plain',
  }

  it('accepts a data: URI', async () => {
    const req = createMockRequest('POST', {
      ...baseBody,
      fileUrl: 'data:text/plain;base64,SGVsbG8gd29ybGQ=',
    })
    const res = await POST(req, { params })
    expect(res.status).toBe(200)
    expect(createDocumentRecords).toHaveBeenCalled()
  })

  it('accepts an https URL', async () => {
    const req = createMockRequest('POST', {
      ...baseBody,
      fileUrl: 'https://example.com/note.txt',
    })
    const res = await POST(req, { params })
    expect(res.status).toBe(200)
    expect(createDocumentRecords).toHaveBeenCalled()
  })

  it.each([
    ['absolute local path', '/etc/passwd'],
    ['app config path', '/app/.env'],
    ['file:// URL', 'file:///etc/passwd'],
    ['relative serve path', '/api/files/serve/kb/foo.pdf'],
    ['ftp URL', 'ftp://example.com/file.pdf'],
    ['parent traversal', '../../etc/passwd'],
    ['windows path', 'C:\\Windows\\System32\\config\\SAM'],
  ])('rejects %s with 400 and never invokes the pipeline', async (_label, fileUrl) => {
    const req = createMockRequest('POST', { ...baseBody, fileUrl })
    const res = await POST(req, { params })
    expect(res.status).toBe(400)
    expect(createDocumentRecords).not.toHaveBeenCalled()
    expect(processDocumentsWithQueue).not.toHaveBeenCalled()
  })
})
