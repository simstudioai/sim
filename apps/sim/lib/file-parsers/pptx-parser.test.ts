/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

const { mockParseOfficeText } = vi.hoisted(() => ({
  mockParseOfficeText: vi.fn(),
}))

vi.mock('@/lib/file-parsers/officeparser-module', () => ({
  parseOfficeText: mockParseOfficeText,
}))

import type { FileParserError } from '@/lib/file-parsers/errors'
import { PptxParser } from '@/lib/file-parsers/pptx-parser'

describe('PptxParser', () => {
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

  it('preserves cancellation instead of degrading to scraped bytes', async () => {
    const controller = new AbortController()
    const abortError = new DOMException('The operation was aborted', 'AbortError')
    mockParseOfficeText.mockImplementationOnce(async () => {
      controller.abort(abortError)
      throw abortError
    })

    await expect(
      new PptxParser().parseBuffer(Buffer.from('legacy presentation'), {
        signal: controller.signal,
      })
    ).rejects.toBe(abortError)
  })
})
