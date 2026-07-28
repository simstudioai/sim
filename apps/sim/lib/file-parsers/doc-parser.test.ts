/**
 * @vitest-environment node
 */
import JSZip from 'jszip'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockParseOfficeAsync, mockExtractRawText } = vi.hoisted(() => ({
  mockParseOfficeAsync: vi.fn(),
  mockExtractRawText: vi.fn(),
}))

vi.mock('officeparser', () => ({
  parseOfficeAsync: mockParseOfficeAsync,
}))

vi.mock('mammoth', () => ({
  default: { extractRawText: mockExtractRawText },
  extractRawText: mockExtractRawText,
}))

import { DocParser } from '@/lib/file-parsers/doc-parser'

const CENTRAL_DIRECTORY_HEADER_SIGNATURE = 0x02014b50

/**
 * Overwrite every central-directory record's declared uncompressed size so the
 * archive claims a multi-gigabyte expansion without the test having to allocate
 * it. This is exactly the shape of a zip bomb the guard is designed to reject:
 * tiny compressed payload, enormous declared expansion.
 */
function forgeDeclaredUncompressedSize(zipBuffer: Buffer, declaredBytes: number): Buffer {
  const forged = Buffer.from(zipBuffer)
  for (let offset = 0; offset + 46 <= forged.length; offset++) {
    if (forged.readUInt32LE(offset) === CENTRAL_DIRECTORY_HEADER_SIGNATURE) {
      forged.writeUInt32LE(declaredBytes, offset + 24)
    }
  }
  return forged
}

async function buildOoxmlArchive(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('word/document.xml', '<w:document><w:body>hello</w:body></w:document>')
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

/** A minimal legacy OLE2/CFB compound-file header followed by readable text. */
function buildLegacyOle2Doc(text: string): Buffer {
  const header = Buffer.alloc(512)
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header, 0)
  return Buffer.concat([header, Buffer.from(text, 'utf8'), Buffer.alloc(64)])
}

describe('DocParser.parseBuffer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockParseOfficeAsync.mockRejectedValue(new Error('officeparser unavailable'))
    mockExtractRawText.mockRejectedValue(new Error('mammoth unavailable'))
  })

  it('rejects a zip-bomb-shaped .doc before any parser touches the buffer', async () => {
    const archive = await buildOoxmlArchive()
    const bomb = forgeDeclaredUncompressedSize(archive, 0xfffffff0)

    await expect(new DocParser().parseBuffer(bomb)).rejects.toThrow(/exceeds the maximum allowed/)
    expect(mockParseOfficeAsync).not.toHaveBeenCalled()
    expect(mockExtractRawText).not.toHaveBeenCalled()
  })

  it('rejects a ZIP-shaped .doc whose central directory cannot be parsed', async () => {
    const buffer = Buffer.alloc(64)
    buffer.writeUInt32LE(0x04034b50, 0)

    await expect(new DocParser().parseBuffer(buffer)).rejects.toThrow(/ZIP central directory/)
    expect(mockParseOfficeAsync).not.toHaveBeenCalled()
  })

  it('lets a well-formed OOXML archive renamed to .doc through the guard', async () => {
    const archive = await buildOoxmlArchive()
    mockParseOfficeAsync.mockResolvedValue('hello from officeparser')

    const result = await new DocParser().parseBuffer(archive)

    expect(result.content).toBe('hello from officeparser')
    expect(mockParseOfficeAsync).toHaveBeenCalledTimes(1)
  })

  it('still parses a genuine legacy OLE2 .doc through the existing extraction path', async () => {
    const buffer = buildLegacyOle2Doc('The quick brown fox jumps over the lazy dog')

    const result = await new DocParser().parseBuffer(buffer)

    expect(mockParseOfficeAsync).toHaveBeenCalledTimes(1)
    expect(result.metadata.extractionMethod).toBe('fallback')
    expect(result.content).toContain('The quick brown fox jumps over the lazy dog')
  })

  it('still returns officeparser output for a genuine OLE2 .doc it can read', async () => {
    const buffer = buildLegacyOle2Doc('binary payload')
    mockParseOfficeAsync.mockResolvedValue('legacy doc text')

    const result = await new DocParser().parseBuffer(buffer)

    expect(result.content).toBe('legacy doc text')
    expect(result.metadata.extractionMethod).toBe('officeparser')
  })
})
