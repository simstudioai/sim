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
    mockDownloadFile.mockImplementation(async ({ maxBytes }) => Buffer.alloc(maxBytes ?? 4 * MB))
  })

  it('stops inlining once the per-document budget is spent, without fetching the rest', async () => {
    // Five 8MB images against a 32MB document budget: four fit, the fifth must not
    // even be downloaded — discovering its size after the fact is the bug.
    const ids = ['a', 'b', 'c', 'd', 'e']
    mockRenderSimPageDocument.mockReturnValue(documentReferencing(ids))
    mockGetFileMetadataById.mockImplementation(async (id: string) => imageRecord(id, 8 * MB))
    mockDownloadFile.mockImplementation(async () => Buffer.alloc(8 * MB))

    const html = await renderSimPageDocumentWithAssets('source', { workspaceId: WORKSPACE_ID })

    expect(mockDownloadFile).toHaveBeenCalledTimes(4)
    // The image that did not fit keeps its URL reference rather than failing the render.
    expect(html).toContain('src="/api/files/view/e"')
  })

  it('never fetches an image whose recorded size already exceeds the per-image limit', async () => {
    mockRenderSimPageDocument.mockReturnValue(documentReferencing(['big']))
    mockGetFileMetadataById.mockResolvedValue(imageRecord('big', 9 * MB))

    const html = await renderSimPageDocumentWithAssets('source', { workspaceId: WORKSPACE_ID })

    expect(mockDownloadFile).not.toHaveBeenCalled()
    expect(html).toContain('src="/api/files/view/big"')
  })

  it('caps each download so a row understating its object cannot be inlined', async () => {
    mockRenderSimPageDocument.mockReturnValue(documentReferencing(['liar']))
    mockGetFileMetadataById.mockResolvedValue(imageRecord('liar', 1024))

    await renderSimPageDocumentWithAssets('source', { workspaceId: WORKSPACE_ID })

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.objectContaining({ maxBytes: 8 * MB, context: 'workspace' })
    )
  })

  it('keeps the URL reference when a capped download rejects', async () => {
    mockRenderSimPageDocument.mockReturnValue(documentReferencing(['liar']))
    mockGetFileMetadataById.mockResolvedValue(imageRecord('liar', 1024))
    mockDownloadFile.mockRejectedValue(new Error('storage download exceeds maximum size'))

    const html = await renderSimPageDocumentWithAssets('source', { workspaceId: WORKSPACE_ID })

    expect(html).toContain('src="/api/files/view/liar"')
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
