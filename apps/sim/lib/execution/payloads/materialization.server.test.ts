/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDownloadFile, mockResolveServableDocBytes, mockVerifyFileAccess } = vi.hoisted(() => ({
  mockDownloadFile: vi.fn(),
  mockResolveServableDocBytes: vi.fn(),
  mockVerifyFileAccess: vi.fn(),
}))

vi.mock('@/lib/uploads/core/storage-service', () => ({
  downloadFile: mockDownloadFile,
  hasCloudStorage: vi.fn(() => true),
}))

vi.mock('@/app/api/files/authorization', () => ({
  verifyFileAccess: mockVerifyFileAccess,
}))

vi.mock('@/lib/copilot/tools/server/files/doc-compile', () => ({
  resolveServableDocBytes: mockResolveServableDocBytes,
}))

import { readUserFileContent } from '@/lib/execution/payloads/materialization.server'
import { isExecutionResourceLimitError } from '@/lib/execution/resource-errors'
import type { UserFile } from '@/executor/types'

const RAW_SOURCE = Buffer.from('from reportlab.pdfgen import canvas', 'utf8')
const RENDERED_PDF = Buffer.from('%PDF-1.4 rendered bytes', 'utf8')

function generatedDoc(overrides: Partial<UserFile> = {}): UserFile {
  return {
    id: 'file-1',
    name: 'report.pdf',
    url: '',
    size: RAW_SOURCE.length,
    type: 'text/x-python-pdf',
    key: 'workspace/2f1d8c3e-5b6a-4c7d-8e9f-0a1b2c3d4e5f/1700000000000-abc1234-report.pdf',
    ...overrides,
  }
}

describe('readUserFileContent generated-document resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockVerifyFileAccess.mockResolvedValue(true)
    mockDownloadFile.mockResolvedValue(RAW_SOURCE)
    mockResolveServableDocBytes.mockResolvedValue({
      buffer: RENDERED_PDF,
      contentType: 'application/pdf',
    })
  })

  it('returns the compiled artifact rather than the raw generation source', async () => {
    const content = await readUserFileContent(generatedDoc(), {
      userId: 'user-1',
      encoding: 'base64',
    })

    expect(mockResolveServableDocBytes).toHaveBeenCalledTimes(1)
    expect(content).toBe(RENDERED_PDF.toString('base64'))
    expect(content).not.toBe(RAW_SOURCE.toString('base64'))
  })

  it('attributes the compile to the requesting user instead of the shared anonymous bucket', async () => {
    await readUserFileContent(generatedDoc(), { userId: 'user-1', encoding: 'text' })

    expect(mockResolveServableDocBytes).toHaveBeenCalledWith(
      expect.objectContaining({ ownerKey: 'user:user-1' })
    )
  })

  it('slices the compiled artifact, not the source, on ranged reads', async () => {
    const content = await readUserFileContent(generatedDoc(), {
      userId: 'user-1',
      encoding: 'text',
      offset: 0,
      length: 8,
    })

    expect(content).toBe(RENDERED_PDF.subarray(0, 8).toString('utf8'))
  })

  it('rejects when the rendered artifact exceeds the limit even though the source fits', async () => {
    const oversizedRender = Buffer.alloc(64, 0x41)
    mockResolveServableDocBytes.mockResolvedValue({
      buffer: oversizedRender,
      contentType: 'application/pdf',
    })

    const error = await readUserFileContent(generatedDoc(), {
      userId: 'user-1',
      encoding: 'base64',
      maxSourceBytes: 32,
    }).catch((e: unknown) => e)

    expect(isExecutionResourceLimitError(error)).toBe(true)
  })

  it('surfaces a not-ready document as itself rather than a size-limit error', async () => {
    // The catch below the download only converts payload-size failures; everything else
    // must reach the caller intact, or a still-compiling document would be reported as
    // an oversized one.
    const notReady = new Error('Document is still being generated')
    mockResolveServableDocBytes.mockRejectedValue(notReady)

    const error = await readUserFileContent(generatedDoc(), {
      userId: 'user-1',
      encoding: 'base64',
    }).catch((e: unknown) => e)

    expect(error).toBe(notReady)
    expect(isExecutionResourceLimitError(error)).toBe(false)
  })

  it('refuses bytes the resolver could not render rather than letting them be relabelled', async () => {
    // readUserFileContent returns only a string, so the resolver's honest
    // application/octet-stream cannot travel with it — an attachment builder
    // downstream would infer application/pdf from the name and ship source bytes
    // as a document. Refusing is the only way to keep that from happening.
    mockResolveServableDocBytes.mockResolvedValue({
      buffer: Buffer.from('<html>not a pdf</html>'),
      contentType: 'application/octet-stream',
      unrendered: true,
    })

    await expect(
      readUserFileContent(generatedDoc(), { userId: 'user-1', encoding: 'base64' })
    ).rejects.toThrow(/could not be rendered/)
  })

  it('passes a plain file through without consulting the document resolver', async () => {
    const plainText = Buffer.from('just notes', 'utf8')
    mockDownloadFile.mockResolvedValue(plainText)

    const content = await readUserFileContent(
      generatedDoc({ name: 'notes.txt', type: 'text/plain', size: plainText.length }),
      { userId: 'user-1', encoding: 'text' }
    )

    expect(mockResolveServableDocBytes).not.toHaveBeenCalled()
    expect(content).toBe('just notes')
  })
})
