/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockParseOfficeText } = vi.hoisted(() => ({
  mockParseOfficeText: vi.fn(),
}))

vi.mock('@/lib/file-parsers/officeparser-module', () => ({
  parseOfficeText: mockParseOfficeText,
}))

import type { FileParserError } from '@/lib/file-parsers/errors'
import { PptxParser } from '@/lib/file-parsers/pptx-parser'

describe('PptxParser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('classifies encrypted legacy presentations before degraded extraction', async () => {
    const libraryError = new Error('File is password-protected')
    mockParseOfficeText.mockRejectedValueOnce(libraryError)
    const legacyOleBuffer = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])

    const result = new PptxParser().parseBuffer(legacyOleBuffer)

    await expect(result).rejects.toMatchObject<FileParserError>({
      code: 'encrypted_file',
      cause: libraryError,
    })
  })

  it('preserves cancellation instead of classifying a legacy binary', async () => {
    const controller = new AbortController()
    const abortError = new DOMException('The operation was aborted', 'AbortError')
    mockParseOfficeText.mockImplementationOnce(async () => {
      controller.abort(abortError)
      throw abortError
    })
    const legacyOleBuffer = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])

    await expect(
      new PptxParser().parseBuffer(legacyOleBuffer, { signal: controller.signal })
    ).rejects.toBe(abortError)
  })

  it('rejects a legacy OLE .ppt as unsupported rather than scraping its bytes', async () => {
    mockParseOfficeText.mockRejectedValueOnce(new Error('Unsupported file type'))
    const legacyOleBuffer = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])

    await expect(
      new PptxParser().parseBuffer(legacyOleBuffer)
    ).rejects.toMatchObject<FileParserError>({ code: 'unsupported_type' })
  })

  it('rejects bytes that are neither a package nor an OLE container', async () => {
    await expect(
      new PptxParser().parseBuffer(Buffer.from('random presentation bytes'))
    ).rejects.toMatchObject<FileParserError>({ code: 'invalid_format' })
    expect(mockParseOfficeText).not.toHaveBeenCalled()
  })
})
