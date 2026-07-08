/**
 * Tests for the v1 knowledge document upload route's bounded multipart read.
 *
 * @vitest-environment node
 */
import { getErrorMessage } from '@sim/utils/errors'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAuthenticateRequest,
  mockResolveKnowledgeBase,
  mockCheckActorUsageLimits,
  mockUploadWorkspaceFile,
  mockCreateSingleDocument,
  mockProcessDocumentsWithQueue,
  mockValidateFileType,
} = vi.hoisted(() => ({
  mockAuthenticateRequest: vi.fn(),
  mockResolveKnowledgeBase: vi.fn(),
  mockCheckActorUsageLimits: vi.fn(),
  mockUploadWorkspaceFile: vi.fn(),
  mockCreateSingleDocument: vi.fn(),
  mockProcessDocumentsWithQueue: vi.fn(),
  mockValidateFileType: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  authenticateRequest: mockAuthenticateRequest,
}))

vi.mock('@/app/api/v1/knowledge/utils', () => ({
  resolveKnowledgeBase: mockResolveKnowledgeBase,
  serializeDate: (date: unknown) => (date instanceof Date ? date.toISOString() : date),
  handleError: (_requestId: string, error: unknown) =>
    new Response(JSON.stringify({ error: getErrorMessage(error, 'error') }), {
      status: 500,
    }),
}))

vi.mock('@/lib/billing/calculations/usage-monitor', () => ({
  checkActorUsageLimits: mockCheckActorUsageLimits,
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  uploadWorkspaceFile: mockUploadWorkspaceFile,
}))

vi.mock('@/lib/uploads/utils/validation', () => ({
  validateFileType: mockValidateFileType,
}))

vi.mock('@/lib/knowledge/documents/service', () => ({
  createSingleDocument: mockCreateSingleDocument,
  getDocuments: vi.fn(),
  processDocumentsWithQueue: mockProcessDocumentsWithQueue,
}))

import { POST } from '@/app/api/v1/knowledge/[id]/documents/route'

const routeContext = { params: Promise.resolve({ id: 'kb-1' }) }

function buildFormData(file: File, workspaceId = 'ws-1'): FormData {
  const formData = new FormData()
  formData.append('workspaceId', workspaceId)
  formData.append('file', file)
  return formData
}

/**
 * Builds a pull-based stream that emits fixed-size chunks on demand, so the
 * size-capped reader's `reader.cancel()` simply stops future `pull` calls
 * instead of racing an external (e.g. undici FormData) chunk producer.
 */
function makeChunkedOverLimitBody(
  chunkBytes: number,
  chunkCount: number
): ReadableStream<Uint8Array> {
  let emitted = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (emitted >= chunkCount) {
        controller.close()
        return
      }
      emitted++
      controller.enqueue(new Uint8Array(chunkBytes))
    },
  })
}

describe('v1 knowledge document upload route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthenticateRequest.mockResolvedValue({
      requestId: 'req-1',
      userId: 'user-1',
      rateLimit: {},
    })
    mockResolveKnowledgeBase.mockResolvedValue({ kb: { id: 'kb-1', workspaceId: 'ws-1' } })
    mockCheckActorUsageLimits.mockResolvedValue({ isExceeded: false })
    mockValidateFileType.mockReturnValue(null)
    mockUploadWorkspaceFile.mockResolvedValue({
      url: 'https://example.com/file.txt',
    })
    mockCreateSingleDocument.mockResolvedValue({
      id: 'doc-1',
      filename: 'file.txt',
      fileSize: 100,
      mimeType: 'text/plain',
      enabled: true,
      uploadedAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    mockProcessDocumentsWithQueue.mockResolvedValue(undefined)
  })

  it('rejects a declared content-length above the limit before reading the body', async () => {
    const formData = buildFormData(new File(['x'.repeat(10)], 'file.txt', { type: 'text/plain' }))
    const req = new NextRequest('http://localhost:3000/api/v1/knowledge/kb-1/documents', {
      method: 'POST',
      headers: { 'content-length': String(200 * 1024 * 1024) },
      body: formData,
    })

    const response = await POST(req, routeContext)
    const data = await response.json()

    expect(response.status).toBe(413)
    expect(data.error).toContain('exceeds maximum size')
    expect(mockUploadWorkspaceFile).not.toHaveBeenCalled()
  })

  it('rejects a chunked body without content-length once the streamed size trips the cap', async () => {
    const body = makeChunkedOverLimitBody(1024 * 1024, 200)
    const req = new NextRequest('http://localhost:3000/api/v1/knowledge/kb-1/documents', {
      method: 'POST',
      body,
      // @ts-expect-error - duplex is required by undici for streamed bodies but missing from NextRequestInit types
      duplex: 'half',
    })
    expect(req.headers.get('content-length')).toBeNull()

    const response = await POST(req, routeContext)
    const data = await response.json()

    expect(response.status).toBe(413)
    expect(data.error).toContain('exceeds maximum size')
    expect(mockUploadWorkspaceFile).not.toHaveBeenCalled()
  })

  it('uploads a normal, well-under-limit document successfully', async () => {
    const file = new File(['hello world'], 'file.txt', { type: 'text/plain' })
    const formData = buildFormData(file)
    const req = new NextRequest('http://localhost:3000/api/v1/knowledge/kb-1/documents', {
      method: 'POST',
      headers: { 'content-length': '1024' },
      body: formData,
    })

    const response = await POST(req, routeContext)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(mockUploadWorkspaceFile).toHaveBeenCalledTimes(1)
    expect(mockCreateSingleDocument).toHaveBeenCalledTimes(1)
  })
})
