/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockValidateWorkspaceAccess,
  mockGetWorkspaceFile,
  mockDownloadWorkspaceFileStream,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockValidateWorkspaceAccess: vi.fn(),
  mockGetWorkspaceFile: vi.fn(),
  mockDownloadWorkspaceFileStream: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  createRateLimitResponse: () => new Response('rate limited', { status: 429 }),
  requireRateLimitPrincipal: (rateLimit: { principal: unknown }) => rateLimit.principal,
  validateWorkspaceAccess: mockValidateWorkspaceAccess,
  v1ValidationErrorResponse: (e: { issues: unknown[] }) =>
    NextResponse.json({ error: 'Validation error', details: e.issues }, { status: 400 }),
}))
vi.mock('@/lib/uploads/contexts/workspace', () => ({
  getWorkspaceFile: mockGetWorkspaceFile,
}))
vi.mock('@/lib/workspace-files/application/download-workspace-file', () => ({
  downloadWorkspaceFileStream: { execute: mockDownloadWorkspaceFileStream },
}))
vi.mock('@/lib/workspace-files/orchestration', () => ({
  performDeleteWorkspaceFileItems: vi.fn(),
}))
vi.mock('@sim/audit', () => ({
  recordAudit: vi.fn(),
  AuditAction: { FILE_DOWNLOADED: 'file.downloaded', FILE_DELETED: 'file.deleted' },
  AuditResourceType: { FILE: 'file' },
}))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: vi.fn() }))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { GET } from '@/app/api/v1/files/[fileId]/route'

const WORKSPACE_ID = 'ws-1'
const FILE_ID = 'file-1'
const context = { params: Promise.resolve({ fileId: FILE_ID }) }

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const PRINCIPAL = {
  kind: 'personal_api_key' as const,
  userId: 'user-1',
  keyId: 'key-1',
}

function request() {
  return createMockRequest(
    'GET',
    undefined,
    {},
    `http://localhost:3000/api/v1/files/${FILE_ID}?workspaceId=${WORKSPACE_ID}`
  )
}

/** A generated document: the name carries the target extension, the type the source. */
function generatedDocument(name = 'report.docx') {
  return {
    id: FILE_ID,
    workspaceId: WORKSPACE_ID,
    name,
    key: `workspace/${WORKSPACE_ID}/${FILE_ID}`,
    path: `/serve/${FILE_ID}`,
    size: 6_242,
    type: 'text/x-docxjs',
    uploadedBy: 'user-1',
    uploadedAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  }
}

function renderedDownload(buffer: Buffer) {
  return {
    file: generatedDocument(),
    stream: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(buffer)
        controller.close()
      },
    }),
    contentLength: buffer.length,
    contentType: DOCX_MIME,
  }
}

describe('v1 file download', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue({
      allowed: true,
      userId: 'user-1',
      principal: PRINCIPAL,
    })
    mockValidateWorkspaceAccess.mockResolvedValue(null)
    mockGetWorkspaceFile.mockResolvedValue(generatedDocument())
    mockDownloadWorkspaceFileStream.mockResolvedValue(renderedDownload(Buffer.from('PKrendered')))
  })

  it('serves the rendered bytes and the rendered content type', async () => {
    const response = await GET(request(), context)

    expect(response.status).toBe(200)
    // Not the record's `text/x-docxjs`, which describes the stored source.
    expect(response.headers.get('Content-Type')).toBe(DOCX_MIME)
    expect(Buffer.from(await response.arrayBuffer()).toString()).toContain('rendered')
  })

  it('names the download with an extension matching the served content type', async () => {
    // The renderer picks its output format from the file name, so the two cannot
    // disagree: a `.docx` renders to a docx. This pins that invariant.
    const response = await GET(request(), context)

    const disposition = response.headers.get('Content-Disposition') ?? ''
    expect(disposition).toContain('report.docx')
    expect(response.headers.get('Content-Type')).toBe(DOCX_MIME)
  })

  it('reports Content-Length from the rendered bytes, not the declared source size', async () => {
    const rendered = Buffer.alloc(50_000)
    mockDownloadWorkspaceFileStream.mockResolvedValue(renderedDownload(rendered))

    const response = await GET(request(), context)

    expect(response.headers.get('Content-Length')).toBe(String(rendered.length))
  })

  it('returns a retryable 409 while the artifact is still compiling', async () => {
    mockDownloadWorkspaceFileStream.mockRejectedValue(
      new OrchestrationError('conflict', 'Document is still being generated')
    )

    const response = await GET(request(), context)

    // A 500 would give the caller no reason to try again.
    expect(response.status).toBe(409)
    expect((await response.json()).error).toContain('still being generated')
  })

  it('404s a file that does not exist', async () => {
    mockDownloadWorkspaceFileStream.mockRejectedValue(
      new OrchestrationError('not_found', 'File not found')
    )

    const response = await GET(request(), context)

    expect(response.status).toBe(404)
    expect(mockDownloadWorkspaceFileStream).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: { fileId: FILE_ID, assertedWorkspaceId: WORKSPACE_ID },
      request: expect.anything(),
    })
  })
})
