/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { FileParserError } from '@/lib/file-parsers/errors'
import { PptxParser } from '@/lib/file-parsers/pptx-parser'

const LEGACY_OLE_BUFFER = Buffer.concat([
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  Buffer.alloc(2048),
])

describe('PptxParser', () => {
  it('rejects a legacy OLE .ppt as unsupported rather than scraping its bytes', async () => {
    await expect(
      new PptxParser().parseBuffer(LEGACY_OLE_BUFFER)
    ).rejects.toMatchObject<FileParserError>({ code: 'unsupported_type' })
  })

  it('rejects bytes that are neither a package nor an OLE container', async () => {
    await expect(
      new PptxParser().parseBuffer(Buffer.from('random presentation bytes'))
    ).rejects.toMatchObject<FileParserError>({ code: 'invalid_format' })
  })

  it('preserves cancellation instead of classifying the container', async () => {
    const controller = new AbortController()
    const abortError = new DOMException('The operation was aborted', 'AbortError')
    controller.abort(abortError)

    await expect(
      new PptxParser().parseBuffer(LEGACY_OLE_BUFFER, { signal: controller.signal })
    ).rejects.toBe(abortError)
  })
})
