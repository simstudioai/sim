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
  mockResolveWorkspaceInlineImage,
  mockRenderMarkdownPdf,
  mockEnforceUserRateLimit,
  mockRecordAudit,
  mockCaptureServerEvent,
  MockMarkdownPdfLimitError,
} = vi.hoisted(() => ({
  mockCheckAuth: vi.fn(),
  mockGetFileMetadataById: vi.fn(),
  mockVerifyFileAccess: vi.fn(),
  mockDownloadFile: vi.fn(),
  mockResolveWorkspaceInlineImage: vi.fn(),
  mockRenderMarkdownPdf: vi.fn(),
  mockEnforceUserRateLimit: vi.fn(),
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
vi.mock('@/lib/uploads/server/inline-image', () => ({
  resolveWorkspaceInlineImage: mockResolveWorkspaceInlineImage,
}))
vi.mock('@/app/api/files/export/[id]/markdown-pdf', () => ({
  renderMarkdownPdf: mockRenderMarkdownPdf,
  MarkdownPdfLimitError: MockMarkdownPdfLimitError,
}))
vi.mock('@/lib/core/rate-limiter/route-helpers', () => ({
  enforceUserRateLimit: mockEnforceUserRateLimit,
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
  const query = format ? `?format=${format}` : ''
  return createMockRequest(
    'GET',
    undefined,
    {},
    `http://localhost:3000/api/files/export/${DOC_ID}${query}`
  )
}

function inlineImage(id: string, size = 1 * MB) {
  return {
    key: `workspace/ws-1/${id}`,
    filename: id.endsWith('.png') ? id : `${id}.png`,
    contentType: 'image/png',
    size,
  }
}

function markdownWithIds(...ids: string[]): Buffer {
  return Buffer.from(ids.map((id) => `![${id}](/api/files/view/${id})`).join('\n'))
}

describe('markdown export bundling', () => {
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
    mockResolveWorkspaceInlineImage.mockImplementation(
      async (_workspaceId: string, ref: { fileId?: string; key?: string }) => {
        const id = ref.fileId ?? ref.key?.split('/').at(-1) ?? 'image'
        return inlineImage(id)
      }
    )
    mockDownloadFile.mockResolvedValue(Buffer.from('# Doc\n'))
    mockRenderMarkdownPdf.mockResolvedValue(Buffer.from('%PDF-generated'))
    mockEnforceUserRateLimit.mockResolvedValue(null)
  })

  it('returns the stored Markdown unchanged when no format is requested', async () => {
    const response = await GET(request(), context)

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8')
    expect(response.headers.get('Content-Disposition')).toContain('doc.md')
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('# Doc\n')
    expect(mockRenderMarkdownPdf).not.toHaveBeenCalled()
    expect(mockEnforceUserRateLimit).not.toHaveBeenCalled()
  })

  it('renders Markdown as a directly downloadable PDF', async () => {
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
    expect(mockRenderMarkdownPdf.mock.calls[0][0].images.size).toBe(0)
    expect(mockEnforceUserRateLimit).toHaveBeenCalledWith('markdown-pdf-export', 'user-1', {
      maxTokens: 3,
      refillRate: 3,
      refillIntervalMs: 60_000,
    })
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

  it('returns a clear rejection when the parsed document exceeds renderer limits', async () => {
    mockRenderMarkdownPdf.mockRejectedValue(
      new MockMarkdownPdfLimitError('This document is too complex to export as PDF.')
    )

    const response = await GET(request('pdf'), context)

    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('too complex')
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it('passes only authorized, readable embedded images to the PDF renderer', async () => {
    mockVerifyFileAccess.mockImplementation(async (key: string) => !key.endsWith('secret'))
    mockDownloadFile.mockImplementation(async ({ key }: { key: string }) => {
      if (key.endsWith('doc.md')) return markdownWithIds('good', 'secret', 'broken')
      if (key.endsWith('broken')) throw new Error('storage down')
      return Buffer.from('png-bytes')
    })

    const response = await GET(request('pdf'), context)

    expect(response.status).toBe(200)
    const images = mockRenderMarkdownPdf.mock.calls[0][0].images as Map<string, Buffer>
    expect(Array.from(images.keys())).toEqual(['id:good'])
    expect(images.get('id:good')).toEqual(Buffer.from('png-bytes'))
  })

  it('resolves the key-based image URL emitted by the Files editor', async () => {
    const key = 'workspace/ws-1/editor-image.png'
    mockDownloadFile.mockImplementation(async ({ key: requestedKey }: { key: string }) =>
      requestedKey.endsWith('doc.md')
        ? Buffer.from(`![image](/api/files/serve/${encodeURIComponent(key)}?context=workspace)`)
        : Buffer.from('png-bytes')
    )

    const response = await GET(request('pdf'), context)

    expect(response.status).toBe(200)
    expect(mockResolveWorkspaceInlineImage).toHaveBeenCalledWith('ws-1', { key })
    const images = mockRenderMarkdownPdf.mock.calls[0][0].images as Map<string, Buffer>
    expect(images.get(`key:${key}`)).toEqual(Buffer.from('png-bytes'))
  })

  it('records an image-containing PDF as one downloaded file', async () => {
    mockDownloadFile.mockImplementation(async ({ key }: { key: string }) =>
      key.endsWith('doc.md') ? markdownWithIds('image-1') : Buffer.from('png-bytes')
    )

    await GET(request('pdf'), context)

    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ assetCount: 1, format: 'pdf' }),
      })
    )
    expect(mockCaptureServerEvent).toHaveBeenCalledWith(
      'user-1',
      'file_downloaded',
      expect.objectContaining({ file_count: 1, is_bulk: false }),
      { groups: { workspace: 'ws-1' } }
    )
  })

  it('keeps image-containing ZIP telemetry bulk', async () => {
    mockDownloadFile.mockImplementation(async ({ key }: { key: string }) =>
      key.endsWith('doc.md') ? markdownWithIds('image-1') : Buffer.from('png-bytes')
    )

    await GET(request(), context)

    expect(mockCaptureServerEvent).toHaveBeenCalledWith(
      'user-1',
      'file_downloaded',
      expect.objectContaining({ file_count: 2, is_bulk: true }),
      { groups: { workspace: 'ws-1' } }
    )
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

  it('rejects on declared asset bytes before downloading any of them', async () => {
    mockDownloadFile.mockResolvedValue(markdownWithIds('a', 'b', 'c'))
    mockResolveWorkspaceInlineImage.mockImplementation(
      async (_workspaceId: string, ref: { fileId: string }) => inlineImage(ref.fileId, 100 * MB)
    )

    const response = await GET(request(), context)

    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('exceeds')
    // Only the markdown body was read; the 300 MB of assets never left storage.
    expect(mockDownloadFile).toHaveBeenCalledTimes(1)
  })

  it('counts the document body against the export limit, not just its assets', async () => {
    // Assets alone sit under the cap; the body is what carries the bundle over it.
    const body = Buffer.alloc(250 * MB)
    markdownWithIds('a').copy(body)
    mockDownloadFile.mockResolvedValue(body)

    const response = await GET(request(), context)

    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('document and its embedded files')
  })

  it('caps the document body read rather than loading it unbounded', async () => {
    await GET(request(), context)

    const bodyCall = mockDownloadFile.mock.calls.find(([options]) => options.key.endsWith('doc.md'))
    expect(bodyCall?.[0].maxBytes).toBe(250 * MB)
  })

  it('uses a smaller document limit for PDF rendering', async () => {
    await GET(request('pdf'), context)

    const bodyCall = mockDownloadFile.mock.calls.find(([options]) => options.key.endsWith('doc.md'))
    expect(bodyCall?.[0].maxBytes).toBe(256 * 1024)
  })

  it('reports an oversized PDF body with the PDF-specific limit', async () => {
    mockDownloadFile.mockRejectedValue(
      new PayloadSizeLimitError({ label: 'storage file download', maxBytes: 1 })
    )

    const response = await GET(request('pdf'), context)

    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('256 KB PDF export limit')
    expect(mockRenderMarkdownPdf).not.toHaveBeenCalled()
  })

  it('reports an oversized body as a size rejection, not a server error', async () => {
    mockDownloadFile.mockRejectedValue(
      new PayloadSizeLimitError({ label: 'storage file download', maxBytes: 1 })
    )

    const response = await GET(request(), context)

    // The cap exists to produce a clear limit message; a 500 would hide it.
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('export limit')
  })

  it('caps each asset download rather than trusting its declared size', async () => {
    mockDownloadFile.mockImplementation(async ({ key }: { key: string }) =>
      key.endsWith('doc.md') ? markdownWithIds('a') : Buffer.from('asset')
    )

    await GET(request(), context)

    const assetCall = mockDownloadFile.mock.calls.find(
      ([options]) => options.key === 'workspace/ws-1/a'
    )
    expect(assetCall?.[0].maxBytes).toBe(25 * MB)
  })

  it('uses a smaller per-asset limit for PDF rendering', async () => {
    mockDownloadFile.mockImplementation(async ({ key }: { key: string }) =>
      key.endsWith('doc.md') ? markdownWithIds('a') : Buffer.from('asset')
    )

    await GET(request('pdf'), context)

    const assetCall = mockDownloadFile.mock.calls.find(
      ([options]) => options.key === 'workspace/ws-1/a'
    )
    expect(assetCall?.[0].maxBytes).toBe(10 * MB)
  })

  it('rejects PDF source material above its aggregate input limit', async () => {
    mockDownloadFile.mockResolvedValue(markdownWithIds('a', 'b'))
    mockResolveWorkspaceInlineImage.mockImplementation(
      async (_workspaceId: string, ref: { fileId: string }) => inlineImage(ref.fileId, 30 * MB)
    )

    const response = await GET(request('pdf'), context)

    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('50 MB PDF export limit')
    expect(mockDownloadFile).toHaveBeenCalledTimes(1)
    expect(mockRenderMarkdownPdf).not.toHaveBeenCalled()
  })

  it('enforces the aggregate PDF budget against downloaded bytes, not only metadata', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f']
    mockDownloadFile.mockImplementation(async ({ key }: { key: string }) =>
      key.endsWith('doc.md') ? markdownWithIds(...ids) : Buffer.alloc(10 * MB)
    )

    const response = await GET(request('pdf'), context)

    expect(response.status).toBe(200)
    const images = mockRenderMarkdownPdf.mock.calls[0][0].images as Map<string, Buffer>
    expect(images.size).toBe(4)
  })

  it('rewrites the editor key URL when producing a Markdown asset ZIP', async () => {
    const key = 'workspace/ws-1/editor-image.png'
    mockDownloadFile.mockImplementation(async ({ key: requestedKey }: { key: string }) =>
      requestedKey.endsWith('doc.md')
        ? Buffer.from(`![image](/api/files/serve/${encodeURIComponent(key)}?context=workspace)`)
        : Buffer.from('png-bytes')
    )

    const response = await GET(request(), context)

    const zip = await JSZip.loadAsync(Buffer.from(await response.arrayBuffer()))
    expect(await zip.file('doc.md')?.async('string')).toBe('![image](./assets/editor-image.png)')
    expect(zip.file('assets/editor-image.png')).not.toBeNull()
  })

  it('drops an unreadable asset instead of failing the whole export', async () => {
    mockDownloadFile.mockImplementation(async ({ key }: { key: string }) => {
      if (key.endsWith('doc.md')) return markdownWithIds('good', 'bad')
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
    mockVerifyFileAccess.mockImplementation(async (key: string) => !key.endsWith('secret'))
    mockDownloadFile.mockImplementation(async ({ key }: { key: string }) =>
      key.endsWith('doc.md') ? markdownWithIds('secret') : Buffer.from('asset')
    )

    const response = await GET(request(), context)

    expect(response.status).toBe(200)
    // Authorization is settled during metadata resolution, before any asset read.
    expect(mockDownloadFile.mock.calls.some(([options]) => options.key.endsWith('secret'))).toBe(
      false
    )
  })
})
