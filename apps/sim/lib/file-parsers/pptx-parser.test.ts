/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

const { mockParseOfficeAsync } = vi.hoisted(() => ({
  mockParseOfficeAsync: vi.fn(),
}))

vi.mock('@/lib/file-parsers/officeparser-module', () => ({
  loadParseOfficeAsync: vi.fn(async () => mockParseOfficeAsync),
}))

import type { FileParserError } from '@/lib/file-parsers/errors'
import { PptxParser } from '@/lib/file-parsers/pptx-parser'

describe('PptxParser', () => {
  it('classifies encrypted legacy presentations before degraded extraction', async () => {
    const libraryError = new Error('File is password-protected')
    mockParseOfficeAsync.mockRejectedValueOnce(libraryError)
    const legacyOleBuffer = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])

    const result = new PptxParser().parseBuffer(legacyOleBuffer)

    await expect(result).rejects.toMatchObject<FileParserError>({
      code: 'encrypted_file',
      cause: libraryError,
    })
  })
})
