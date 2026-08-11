/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import JSZip from 'jszip'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'

const {
  mockCheckAuth,
  mockGetFileMetadataById,
  mockVerifyFileAccess,
  mockDownloadFile,
  mockExtractEmbeddedImageIds,
  mockExtractEmbeddedFileRefs,
  mockResolveWorkspaceInlineImage,
  mockEnforceUserRateLimit,
  mockRenderMarkdownPdf,
  mockRecordAudit,
  mockCaptureServerEvent,
  MockMarkdownPdfLimitError,
} = vi.hoisted(() => ({
  mockCheckAuth: vi.fn(),
  mockGetFileMetadataById: vi.fn(),
  mockVerifyFileAccess: vi.fn(),
  mockDownloadFile: vi.fn(),
  mockExtractEmbeddedImageIds: vi.fn(),
  mockExtractEmbeddedFileRefs: vi.fn(),
  mockResolveWorkspaceInlineImage: vi.fn(),
  mockEnforceUserRateLimit: vi.fn(),
  mockRenderMarkdownPdf: vi.fn(),
  mockRecordAudit: vi.fn(),
  mockCaptureServerEvent: vi.fn(),
  MockMarkdownPdfLimitError: class extends Error {},
}))

vi.mock('@/lib/auth/hybrid', () => ({ checkSessionOrInternalAuth: mockCheckAuth }))
vi.mock('@/lib/uploads/server/metadata', () => ({
  getFileMetadataById: mockGetFileMetadataById,
}))
vi.mock('@/app/api/files/authorization', () => ({ verifyFileAccess: mockVerifyFileAccess }))
vi.mock('@/lib/uploads/core/storage-service', () => ({ downloadFile: mockDownloadFile }))
vi.mock('@/lib/copilot/tools/server/files/embedded-image-refs', () => ({
  extractEmbeddedImageIds: mockExtractEmbeddedImageIds,
}))
vi.mock('@/lib/uploads/utils/embedded-image-ref', () => ({
  extractEmbeddedFileRefs: mockExtractEmbeddedFileRefs,
}))
vi.mock('@/lib/uploads/server/inline-image', () => ({
  resolveWorkspaceInlineImage: mockResolveWorkspaceInlineImage,
}))
vi.mock('@/lib/core/rate-limiter/route-helpers', () => ({
  enforceUserRateLimit: mockEnforceUserRateLimit,
}))
vi.mock('@/app/api/files/export/[id]/markdown-pdf', () => ({
  MarkdownPdfLimitError: MockMarkdownPdfLimitError,
  markdownPdfImageKey: (ref: { key?: string; fileId?: string }) =>
    ref.key ? `key:${ref.key}` : `id:${ref.fileId}`,
  renderMarkdownPdf: mockRenderMarkdownPdf,
}))
vi.mock('@sim/audit', () => ({
  recordAudit: mockRecordAudit,
  AuditAction: { FILE_DOWNLOADED: 'file.downloaded' },
  AuditResourceType: { FILE: 'file' },
}))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mockCaptureServerEvent }))

import { GET } from '@/app/api/files/export/[id]/route'

const MB = 1024 * 1024
const DOC_ID = 'doc-1'
const context = { params: Promise.resolve({ id: DOC_ID }) }

function request(format?: 'pdf') {
  const query = format ? '?format=pdf' : ''
  return createMockRequest(
    'GET',
    undefined,
    {},
    `http://localhost:3000/api/files/export/${DOC_ID}${query}`
  )
}

function assetRecord(id: string, size: number) {
  return {
    id,
    key: `workspace/ws-1/${id}`,
    originalName: `${id}.png`,
    contentType: 'image/png',
    context: 'workspace',
    size,
    workspaceId: 'ws-1',
  }
}

describe('markdown export bundling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckAuth.mockResolvedValue({ success: true, userId: 'user-1' })
    mockVerifyFileAccess.mockResolvedValue(true)
    mockGetFileMetadataById.mockImplementation(async (id: string) =>
      id === DOC_ID
        ? {
            id: DOC_ID,
            key: 'workspace/ws-1/doc.md',
            originalName: 'doc.md',
            contentType: 'text/markdown',
            context: 'workspace',
            size: 1024,
            workspaceId: 'ws-1',
          }
        : assetRecord(id, 1 * MB)
    )
    mockDownloadFile.mockResolvedValue(Buffer.from('# Doc\n'))
    mockExtractEmbeddedImageIds.mockReturnValue([])
    mockExtractEmbeddedFileRefs.mockReturnValue({ keys: [], ids: [] })
    mockResolveWorkspaceInlineImage.mockResolvedValue(null)
    mockEnforceUserRateLimit.mockResolvedValue(null)
    mockRenderMarkdownPdf.mockResolvedValue(Buffer.from('%PDF-generated'))
  })

  it('returns stored Markdown unchanged when no embedded image IDs exist', async () => {
    const markdown = '# Doc\n![editor image](/api/files/serve/workspace%2Fws-1%2Fimage.png)\n'
    mockDownloadFile.mockResolvedValue(Buffer.from(markdown))

    const response = await GET(request(), context)

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8')
    expect(response.headers.get('Content-Disposition')).toContain('doc.md')
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe(markdown)
    expect(mockExtractEmbeddedFileRefs).not.toHaveBeenCalled()
    expect(mockResolveWorkspaceInlineImage).not.toHaveBeenCalled()
    expect(mockRenderMarkdownPdf).not.toHaveBeenCalled()
    expect(mockEnforceUserRateLimit).not.toHaveBeenCalled()
  })

  it('preserves image-ID ZIP rewriting and bulk telemetry without a format', async () => {
    mockExtractEmbeddedImageIds.mockReturnValue(['image-1'])
    mockDownloadFile.mockImplementation(async ({ key }: { key: string }) =>
      key.endsWith('doc.md')
        ? Buffer.from('![image](/api/files/view/image-1)')
        : Buffer.from('png-bytes')
    )

    const response = await GET(request(), context)

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/zip')
    const zip = await JSZip.loadAsync(Buffer.from(await response.arrayBuffer()))
    expect(await zip.file('doc.md')?.async('string')).toBe('![image](./assets/image-1.png)')
    expect(zip.file('assets/image-1.png')).not.toBeNull()
    expect(mockCaptureServerEvent).toHaveBeenCalledWith(
      'user-1',
      'file_downloaded',
      expect.objectContaining({ file_count: 2, is_bulk: true }),
      { groups: { workspace: 'ws-1' } }
    )
    expect(mockExtractEmbeddedFileRefs).not.toHaveBeenCalled()
  })

  it('preserves the non-Markdown serve redirect without a format', async () => {
    mockGetFileMetadataById.mockResolvedValue({
      id: DOC_ID,
      key: 'workspace/ws-1/image.png',
      originalName: 'image.png',
      contentType: 'image/png',
      context: 'workspace',
      size: 1024,
      workspaceId: 'ws-1',
    })

    const response = await GET(request(), context)

    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toContain('/api/files/serve/')
    expect(mockDownloadFile).not.toHaveBeenCalled()
    expect(mockEnforceUserRateLimit).not.toHaveBeenCalled()
    expect(mockRenderMarkdownPdf).not.toHaveBeenCalled()
  })

  it('rejects on declared asset bytes before downloading any of them', async () => {
    mockExtractEmbeddedImageIds.mockReturnValue(['a', 'b', 'c'])
    mockGetFileMetadataById.mockImplementation(async (id: string) =>
      id === DOC_ID
        ? {
            id: DOC_ID,
            key: 'workspace/ws-1/doc.md',
            originalName: 'doc.md',
            contentType: 'text/markdown',
            context: 'workspace',
            size: 1024,
            workspaceId: 'ws-1',
          }
        : assetRecord(id, 100 * MB)
    )

    const response = await GET(request(), context)

    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('exceeds')
    // Only the markdown body was read; the 300 MB of assets never left storage.
    expect(mockDownloadFile).toHaveBeenCalledTimes(1)
  })

  it('counts the document body against the export limit, not just its assets', async () => {
    // Assets alone sit under the cap; the body is what carries the bundle over it.
    mockExtractEmbeddedImageIds.mockReturnValue(['a'])
    mockDownloadFile.mockResolvedValue(Buffer.alloc(250 * MB))

    const response = await GET(request(), context)

    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('document and its embedded files')
  })

  it('caps the document body read rather than loading it unbounded', async () => {
    mockExtractEmbeddedImageIds.mockReturnValue([])

    await GET(request(), context)

    const bodyCall = mockDownloadFile.mock.calls.find(([options]) => options.key.endsWith('doc.md'))
    expect(bodyCall?.[0].maxBytes).toBe(250 * MB)
  })

  it('reports an oversized body as a size rejection, not a server error', async () => {
    mockExtractEmbeddedImageIds.mockReturnValue([])
    mockDownloadFile.mockRejectedValue(
      new PayloadSizeLimitError({ label: 'storage file download', maxBytes: 1 })
    )

    const response = await GET(request(), context)

    // The cap exists to produce a clear limit message; a 500 would hide it.
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('export limit')
  })

  it('caps each asset download rather than trusting its declared size', async () => {
    mockExtractEmbeddedImageIds.mockReturnValue(['a'])

    await GET(request(), context)

    const assetCall = mockDownloadFile.mock.calls.find(
      ([options]) => options.key === 'workspace/ws-1/a'
    )
    expect(assetCall?.[0].maxBytes).toBe(25 * MB)
  })

  it('drops an unreadable asset instead of failing the whole export', async () => {
    mockExtractEmbeddedImageIds.mockReturnValue(['good', 'bad'])
    mockDownloadFile.mockImplementation(async ({ key }: { key: string }) => {
      if (key.endsWith('doc.md')) return Buffer.from('# Doc\n![x](/api/files/view/good)\n')
      if (key.endsWith('bad')) throw new Error('storage down')
      return Buffer.from('png-bytes')
    })

    const response = await GET(request(), context)

    expect(response.status).toBe(200)
    const zip = await JSZip.loadAsync(Buffer.from(await response.arrayBuffer()))
    expect(zip.file('assets/good.png')).not.toBeNull()
    expect(zip.file('assets/bad.png')).toBeNull()
  })

  it('skips an asset the caller cannot read', async () => {
    mockExtractEmbeddedImageIds.mockReturnValue(['secret'])
    mockVerifyFileAccess.mockImplementation(async (key: string) => !key.endsWith('secret'))

    const response = await GET(request(), context)

    expect(response.status).toBe(200)
    // Authorization is settled during metadata resolution, before any asset read.
    expect(mockDownloadFile.mock.calls.some(([options]) => options.key.endsWith('secret'))).toBe(
      false
    )
  })
})

describe('markdown PDF export', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckAuth.mockResolvedValue({ success: true, userId: 'user-1' })
    mockVerifyFileAccess.mockResolvedValue(true)
    mockGetFileMetadataById.mockResolvedValue({
      id: DOC_ID,
      key: 'workspace/ws-1/doc.md',
      originalName: 'doc.md',
      contentType: 'text/markdown',
      context: 'workspace',
      size: 1024,
      workspaceId: 'ws-1',
    })
    mockDownloadFile.mockResolvedValue(Buffer.from('# Doc\n'))
    mockExtractEmbeddedImageIds.mockReturnValue([])
    mockExtractEmbeddedFileRefs.mockReturnValue({ keys: [], ids: [] })
    mockResolveWorkspaceInlineImage.mockResolvedValue(null)
    mockEnforceUserRateLimit.mockResolvedValue(null)
    mockRenderMarkdownPdf.mockResolvedValue(Buffer.from('%PDF-generated'))
  })

  it('renders a direct PDF attachment with the Markdown filename', async () => {
    const response = await GET(request('pdf'), context)

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/pdf')
    expect(response.headers.get('Content-Disposition')).toContain('doc.pdf')
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('%PDF-generated')
    expect(mockRenderMarkdownPdf).toHaveBeenCalledWith({
      markdown: '# Doc\n',
      title: 'doc',
      images: expect.any(Map),
    })
    expect(mockEnforceUserRateLimit).toHaveBeenCalledWith('markdown-pdf-export', 'user-1', {
      maxTokens: 3,
      refillRate: 3,
      refillIntervalMs: 60_000,
    })
    expect(mockCaptureServerEvent).toHaveBeenCalledWith(
      'user-1',
      'file_downloaded',
      expect.objectContaining({ file_count: 1, is_bulk: false }),
      { groups: { workspace: 'ws-1' } }
    )
  })

  it('resolves authorized key- and ID-based images for the PDF renderer', async () => {
    const imageKey = 'workspace/ws-1/editor-image.png'
    mockExtractEmbeddedFileRefs.mockReturnValue({ keys: [imageKey], ids: ['image-1'] })
    mockResolveWorkspaceInlineImage.mockImplementation(
      async (_workspaceId: string, ref: { key?: string; fileId?: string }) => ({
        key: ref.key ?? `workspace/ws-1/${ref.fileId}`,
        filename: 'image.png',
        contentType: 'image/png',
      })
    )
    mockDownloadFile.mockImplementation(async ({ key }: { key: string }) =>
      key.endsWith('doc.md') ? Buffer.from('# Doc\n') : Buffer.from(`bytes:${key}`)
    )

    const response = await GET(request('pdf'), context)

    expect(response.status).toBe(200)
    expect(mockResolveWorkspaceInlineImage).toHaveBeenNthCalledWith(1, 'ws-1', { key: imageKey })
    expect(mockResolveWorkspaceInlineImage).toHaveBeenNthCalledWith(2, 'ws-1', {
      fileId: 'image-1',
    })
    const images = mockRenderMarkdownPdf.mock.calls[0][0].images as Map<string, Buffer>
    expect(images.get(`key:${imageKey}`)).toEqual(Buffer.from(`bytes:${imageKey}`))
    expect(images.get('id:image-1')).toEqual(Buffer.from('bytes:workspace/ws-1/image-1'))
    expect(mockExtractEmbeddedImageIds).not.toHaveBeenCalled()
  })

  it('rejects PDF format for a non-Markdown file', async () => {
    mockGetFileMetadataById.mockResolvedValue({
      id: DOC_ID,
      key: 'workspace/ws-1/doc.txt',
      originalName: 'doc.txt',
      contentType: 'text/plain',
      context: 'workspace',
      size: 1024,
      workspaceId: 'ws-1',
    })

    const response = await GET(request('pdf'), context)

    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('only available for Markdown')
    expect(mockDownloadFile).not.toHaveBeenCalled()
    expect(mockRenderMarkdownPdf).not.toHaveBeenCalled()
  })

  it('stops a rate-limited PDF export before reading the document', async () => {
    mockEnforceUserRateLimit.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429 })
    )

    const response = await GET(request('pdf'), context)

    expect(response.status).toBe(429)
    expect(mockDownloadFile).not.toHaveBeenCalled()
    expect(mockRenderMarkdownPdf).not.toHaveBeenCalled()
  })

  it('uses PDF-specific document and image byte limits', async () => {
    mockExtractEmbeddedFileRefs.mockReturnValue({ keys: [], ids: ['image-1'] })
    mockResolveWorkspaceInlineImage.mockResolvedValue({
      key: 'workspace/ws-1/image-1',
      filename: 'image.png',
      contentType: 'image/png',
    })
    mockDownloadFile.mockImplementation(async ({ key }: { key: string }) =>
      key.endsWith('doc.md') ? Buffer.from('# Doc\n') : Buffer.from('image')
    )

    const response = await GET(request('pdf'), context)

    expect(response.status).toBe(200)
    const documentCall = mockDownloadFile.mock.calls.find(([options]) =>
      options.key.endsWith('doc.md')
    )
    const imageCall = mockDownloadFile.mock.calls.find(
      ([options]) => options.key === 'workspace/ws-1/image-1'
    )
    expect(documentCall?.[0].maxBytes).toBe(256 * 1024)
    expect(imageCall?.[0].maxBytes).toBe(10 * MB)
  })

  it('rejects actual downloaded image bytes above the aggregate PDF budget', async () => {
    mockExtractEmbeddedFileRefs.mockReturnValue({ keys: [], ids: ['a', 'b'] })
    mockResolveWorkspaceInlineImage.mockImplementation(
      async (_workspaceId: string, ref: { fileId: string }) => ({
        key: `workspace/ws-1/${ref.fileId}`,
        filename: `${ref.fileId}.png`,
        contentType: 'image/png',
      })
    )
    mockDownloadFile.mockImplementation(async ({ key }: { key: string }) =>
      key.endsWith('doc.md') ? Buffer.from('# Doc\n') : Buffer.alloc(26 * MB)
    )

    const response = await GET(request('pdf'), context)

    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('50 MB PDF export limit')
    expect(mockRenderMarkdownPdf).not.toHaveBeenCalled()
  })

  it('returns renderer resource-limit errors as clear client errors', async () => {
    mockRenderMarkdownPdf.mockRejectedValue(
      new MockMarkdownPdfLimitError('This document is too complex to export as PDF.')
    )

    const response = await GET(request('pdf'), context)

    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('too complex')
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })
})
