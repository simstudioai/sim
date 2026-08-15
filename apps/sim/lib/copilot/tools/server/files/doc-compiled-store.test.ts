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

import {
  loadPublishedCompiledDoc,
  storeCompiledDoc,
} from '@/lib/copilot/tools/server/files/doc-compiled-store'

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

  it('fails fast on a malformed published pointer', async () => {
    mockHeadObject.mockResolvedValue({ size: 1 })
    mockDownloadFile.mockResolvedValueOnce(Buffer.from('{not-json'))

    await expect(loadPublishedCompiledDoc('workspace-1', 'source', 'pdf')).rejects.toThrow(
      'Published compiled document pointer is malformed'
    )
  })
})
