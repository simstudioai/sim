/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import JSZip from 'jszip'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckAuth,
  mockGetFileMetadataById,
  mockVerifyFileAccess,
  mockDownloadFile,
  mockExtractEmbeddedImageIds,
} = vi.hoisted(() => ({
  mockCheckAuth: vi.fn(),
  mockGetFileMetadataById: vi.fn(),
  mockVerifyFileAccess: vi.fn(),
  mockDownloadFile: vi.fn(),
  mockExtractEmbeddedImageIds: vi.fn(),
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
vi.mock('@sim/audit', () => ({
  recordAudit: vi.fn(),
  AuditAction: { FILE_DOWNLOADED: 'file.downloaded' },
  AuditResourceType: { FILE: 'file' },
}))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: vi.fn() }))

import { GET } from '@/app/api/files/export/[id]/route'

const MB = 1024 * 1024
const DOC_ID = 'doc-1'
const context = { params: Promise.resolve({ id: DOC_ID }) }

function request() {
  return createMockRequest('GET', undefined, {}, `http://localhost:3000/api/files/export/${DOC_ID}`)
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
  })

  it('rejects a document embedding more assets than an export may bundle', async () => {
    mockExtractEmbeddedImageIds.mockReturnValue(
      Array.from({ length: 101 }, (_, index) => `img-${index}`)
    )

    const response = await GET(request(), context)

    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('101')
    // Rejected on the embed count alone: nothing was resolved or downloaded.
    expect(mockGetFileMetadataById).toHaveBeenCalledTimes(1)
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
        : assetRecord(id, 40 * MB)
    )

    const response = await GET(request(), context)

    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('exceeds')
    // Only the markdown body was read; the 120 MB of assets never left storage.
    expect(mockDownloadFile).toHaveBeenCalledTimes(1)
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
