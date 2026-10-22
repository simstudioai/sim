import { describe, expect, it } from 'vitest'
import { DocxParser } from '@/lib/file-parsers/docx-parser'
import { OpenDocumentParser } from '@/lib/file-parsers/opendocument-parser'

/**
 * GHSA-5v7r-6r5c-r473: an ASF header followed by a sub-header of size zero sends `file-type`
 * 16's ASF detector back over the same sub-header forever. officeparser sniffs every buffer it
 * gets with it, so this upload stalled the event loop once mammoth or the ODF walker gave up,
 * and neither parser below ever returned.
 */
const ASF_ZERO_SIZE_SUB_HEADER = Buffer.concat([
  Buffer.from([0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9]),
  Buffer.alloc(20),
  Buffer.alloc(24),
  Buffer.alloc(1),
])

describe('Office parsers given an ASF payload', () => {
  it('falls back to plain text for a .docx that is not a ZIP package', async () => {
    const result = await new DocxParser().parseBuffer(ASF_ZERO_SIZE_SUB_HEADER)

    expect(result.metadata?.extractionMethod).toBe('plaintext-fallback')
  })

  it('rejects an .odt that is not a ZIP package', async () => {
    await expect(
      new OpenDocumentParser().parseBuffer(ASF_ZERO_SIZE_SUB_HEADER)
    ).rejects.toMatchObject({ code: 'invalid_format' })
  })
})
