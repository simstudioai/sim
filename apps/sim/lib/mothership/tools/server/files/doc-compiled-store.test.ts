/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDownloadFile, mockHeadObject, mockUploadFile } = vi.hoisted(() => ({
  mockDownloadFile: vi.fn(),
  mockHeadObject: vi.fn(),
  mockUploadFile: vi.fn(),
}))

vi.mock('@/lib/uploads/core/storage-service', () => ({
  downloadFile: mockDownloadFile,
  headObject: mockHeadObject,
  uploadFile: mockUploadFile,
}))

import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import {
  loadPublishedCompiledDoc,
  storeCompiledDoc,
} from '@/lib/mothership/tools/server/files/doc-compiled-store'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'

describe('compiled document publication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHeadObject.mockResolvedValue(null)
  })

  it('publishes a source-keyed pointer after storing a dependency-bound artifact', async () => {
    await storeCompiledDoc(
      'workspace-1',
      'source',
      'pdf',
      'application/pdf',
      Buffer.from('%PDF-artifact'),
      'dependency-identity'
    )

    expect(mockUploadFile).toHaveBeenCalledTimes(2)
    expect(mockUploadFile).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        file: Buffer.from(
          JSON.stringify({ version: 1, referencedInputIdentity: 'dependency-identity' })
        ),
        contentType: 'application/json',
        context: 'copilot',
        preserveKey: true,
      })
    )
  })

  it('loads only the exact dependency-bound artifact named by the published pointer', async () => {
    mockHeadObject.mockResolvedValue({ size: 1 })
    mockDownloadFile
      .mockResolvedValueOnce(
        Buffer.from(JSON.stringify({ version: 1, referencedInputIdentity: 'dependency-identity' }))
      )
      .mockResolvedValueOnce(Buffer.from('%PDF-artifact'))

    await expect(loadPublishedCompiledDoc('workspace-1', 'source', 'pdf')).resolves.toEqual(
      Buffer.from('%PDF-artifact')
    )
    expect(mockDownloadFile).toHaveBeenCalledTimes(2)
    expect(mockDownloadFile.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ context: 'copilot' })
    )
  })

  it('bounds the artifact read so an oversized artifact is never materialized', async () => {
    mockHeadObject.mockResolvedValue({ size: 1 })
    mockDownloadFile.mockResolvedValueOnce(
      Buffer.from(JSON.stringify({ version: 1, referencedInputIdentity: 'dependency-identity' }))
    )
    mockDownloadFile.mockResolvedValueOnce(Buffer.from('%PDF-artifact'))

    await loadPublishedCompiledDoc('workspace-1', 'source', 'pdf')

    // The artifact is fetched separately from the source that names it, so a source
    // that cleared its own ceiling says nothing about how large this is.
    expect(mockDownloadFile.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ maxBytes: MAX_BUFFERED_TRANSFER_BYTES })
    )
  })

  it('surfaces an oversized artifact instead of reporting it as not yet built', async () => {
    // `null` means "still compiling", which callers answer with a retry — an artifact
    // that is too large would sit behind that answer forever.
    mockHeadObject.mockResolvedValue({ size: 1 })
    mockDownloadFile.mockResolvedValueOnce(
      Buffer.from(JSON.stringify({ version: 1, referencedInputIdentity: 'dependency-identity' }))
    )
    mockDownloadFile.mockRejectedValueOnce(
      new PayloadSizeLimitError({
        label: 'storage download',
        maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
        observedBytes: MAX_BUFFERED_TRANSFER_BYTES + 1,
      })
    )

    await expect(loadPublishedCompiledDoc('workspace-1', 'source', 'pdf')).rejects.toThrow(
      PayloadSizeLimitError
    )
  })

  it('still reports a missing artifact as not yet built', async () => {
    mockHeadObject.mockResolvedValue({ size: 1 })
    mockDownloadFile.mockResolvedValueOnce(
      Buffer.from(JSON.stringify({ version: 1, referencedInputIdentity: 'dependency-identity' }))
    )
    mockDownloadFile.mockRejectedValueOnce(new Error('NoSuchKey'))

    await expect(loadPublishedCompiledDoc('workspace-1', 'source', 'pdf')).rejects.toThrow(
      'Published compiled document artifact is missing'
    )
  })

  it('fails fast on a malformed published pointer', async () => {
    mockHeadObject.mockResolvedValue({ size: 1 })
    mockDownloadFile.mockResolvedValueOnce(Buffer.from('{not-json'))

    await expect(loadPublishedCompiledDoc('workspace-1', 'source', 'pdf')).rejects.toThrow(
      'Published compiled document pointer is malformed'
    )
  })
})
