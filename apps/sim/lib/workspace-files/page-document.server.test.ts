/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDownloadFile, mockGetFileMetadataById, mockRenderSimPageDocument } = vi.hoisted(() => ({
  mockDownloadFile: vi.fn(),
  mockGetFileMetadataById: vi.fn(),
  mockRenderSimPageDocument: vi.fn(),
}))

vi.mock('@/lib/uploads/core/storage-service', () => ({
  downloadFile: mockDownloadFile,
}))

vi.mock('@/lib/uploads/server/metadata', () => ({
  getFileMetadataById: mockGetFileMetadataById,
}))

vi.mock('@/lib/workspace-files/page-document', () => ({
  renderSimPageDocument: mockRenderSimPageDocument,
}))

import { renderSimPageDocumentWithAssets } from '@/lib/workspace-files/page-document.server'

const WORKSPACE_ID = 'ws-1'
const MB = 1024 * 1024

function imageRecord(id: string, size: number) {
  return {
    id,
    key: `workspace/${WORKSPACE_ID}/${id}.png`,
    context: 'workspace',
    workspaceId: WORKSPACE_ID,
    contentType: 'image/png',
    size,
    sizeBytes: size,
  }
}

function documentReferencing(ids: string[]) {
  return ids.map((id) => `<img src="/api/files/view/${id}">`).join('')
}

describe('renderSimPageDocumentWithAssets memory bounds', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('charges the budget by delivered bytes, not by what the metadata claimed', async () => {
    // Every row claims to be tiny; the objects are 8MB each. The budget must still
    // stop at 32MB — planning off the recorded size would admit all six.
    const ids = ['a', 'b', 'c', 'd', 'e', 'f']
    mockRenderSimPageDocument.mockReturnValue(documentReferencing(ids))
    mockGetFileMetadataById.mockImplementation(async (id: string) => imageRecord(id, 1024))
    mockDownloadFile.mockImplementation(async () => Buffer.alloc(8 * MB))

    const html = await renderSimPageDocumentWithAssets('source', { workspaceId: WORKSPACE_ID })

    expect(mockDownloadFile).toHaveBeenCalledTimes(4)
    // The images past the budget keep their URL reference rather than failing the render.
    expect(html).toContain('src="/api/files/view/e"')
    expect(html).toContain('src="/api/files/view/f"')
  })

  it('offers each download only what the budget has left', async () => {
    mockRenderSimPageDocument.mockReturnValue(documentReferencing(['a', 'b']))
    mockGetFileMetadataById.mockImplementation(async (id: string) => imageRecord(id, 1024))
    mockDownloadFile.mockImplementation(async () => Buffer.alloc(30 * MB))

    await renderSimPageDocumentWithAssets('source', { workspaceId: WORKSPACE_ID })

    expect(mockDownloadFile).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ maxBytes: 8 * MB })
    )
    // 30MB delivered leaves 2MB, which is below the per-image limit and becomes the cap.
    expect(mockDownloadFile).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ maxBytes: 2 * MB })
    )
  })

  it('never offers a download more than the per-image limit', async () => {
    mockRenderSimPageDocument.mockReturnValue(documentReferencing(['solo']))
    mockGetFileMetadataById.mockResolvedValue(imageRecord('solo', 1024))
    mockDownloadFile.mockResolvedValue(Buffer.from('png-bytes'))

    await renderSimPageDocumentWithAssets('source', { workspaceId: WORKSPACE_ID })

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.objectContaining({ maxBytes: 8 * MB, context: 'workspace' })
    )
  })

  it('keeps the URL reference when a capped download rejects', async () => {
    mockRenderSimPageDocument.mockReturnValue(documentReferencing(['big']))
    mockGetFileMetadataById.mockResolvedValue(imageRecord('big', 1024))
    mockDownloadFile.mockRejectedValue(new Error('storage download exceeds maximum size'))

    const html = await renderSimPageDocumentWithAssets('source', { workspaceId: WORKSPACE_ID })

    expect(html).toContain('src="/api/files/view/big"')
  })

  it('inlines images that fit and leaves cross-workspace references alone', async () => {
    mockRenderSimPageDocument.mockReturnValue(documentReferencing(['mine', 'theirs']))
    mockGetFileMetadataById.mockImplementation(async (id: string) =>
      id === 'mine'
        ? imageRecord('mine', 1024)
        : { ...imageRecord('theirs', 1024), workspaceId: 'ws-2' }
    )
    mockDownloadFile.mockResolvedValue(Buffer.from('png-bytes'))

    const html = await renderSimPageDocumentWithAssets('source', { workspaceId: WORKSPACE_ID })

    expect(mockDownloadFile).toHaveBeenCalledTimes(1)
    expect(html).toContain(`data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`)
    expect(html).toContain('src="/api/files/view/theirs"')
  })
})
