/**
 * @vitest-environment node
 */
import JSZip from 'jszip'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockParseOfficeAsync, mockExtractRawText } = vi.hoisted(() => ({
  mockParseOfficeAsync: vi.fn(),
  mockExtractRawText: vi.fn(),
}))

vi.mock('officeparser', () => ({ parseOfficeAsync: mockParseOfficeAsync }))
vi.mock('mammoth', () => ({
  default: { extractRawText: mockExtractRawText },
  extractRawText: mockExtractRawText,
}))

import { DocParser } from '@/lib/file-parsers/doc-parser'

const CENTRAL_DIRECTORY_HEADER_SIGNATURE = 0x02014b50

/**
 * Build a small OOXML-shaped archive whose central directory *declares* a huge
 * uncompressed size. The guard reads declared sizes without inflating anything,
 * so this reproduces a zip bomb's central directory at a few hundred bytes.
 */
async function buildDeclaredOversizeArchive(declaredUncompressedBytes: number): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('word/document.xml', '<w:document><w:body>A</w:body></w:document>')
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })

  for (let offset = 0; offset + 28 <= buffer.length; offset++) {
    if (buffer.readUInt32LE(offset) === CENTRAL_DIRECTORY_HEADER_SIGNATURE) {
      buffer.writeUInt32LE(declaredUncompressedBytes, offset + 24)
      return buffer
    }
  }
  throw new Error('No central directory header found in generated archive')
}

/** A legacy OLE compound-file `.doc` — not a ZIP, so the guard must no-op. */
function buildLegacyOleDoc(): Buffer {
  const buffer = Buffer.alloc(512)
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(buffer, 0)
  return buffer
}

describe('DocParser.parseBuffer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects a ZIP-shaped .doc whose declared expanded size exceeds the cap', async () => {
    const bomb = await buildDeclaredOversizeArchive(2 * 1024 * 1024 * 1024)

    await expect(new DocParser().parseBuffer(bomb)).rejects.toThrow(/exceeds the maximum allowed/)
  })

  it('rejects the bomb before either decompression library sees the buffer', async () => {
    const bomb = await buildDeclaredOversizeArchive(2 * 1024 * 1024 * 1024)

    await expect(new DocParser().parseBuffer(bomb)).rejects.toThrow()
    expect(mockParseOfficeAsync).not.toHaveBeenCalled()
    expect(mockExtractRawText).not.toHaveBeenCalled()
  })

  it('rejects a .doc that under-declares its uncompressed size', async () => {
    // Declared sizes alone put this under every limit; officeparser and mammoth
    // only notice the mismatch after inflating the entry in full, so the guard
    // has to catch it before either library sees the buffer.
    const zip = new JSZip()
    zip.file('word/document.xml', 'A'.repeat(4 * 1024 * 1024))
    const honest = (await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
    })) as Buffer

    const lying = Buffer.from(honest)
    for (let offset = 0; offset + 30 <= lying.length; offset++) {
      const signature = lying.readUInt32LE(offset)
      if (signature === CENTRAL_DIRECTORY_HEADER_SIGNATURE) {
        lying.writeUInt32LE(1000, offset + 24)
      } else if (signature === 0x04034b50) {
        lying.writeUInt32LE(1000, offset + 22)
      }
    }

    await expect(new DocParser().parseBuffer(lying)).rejects.toThrow(/do not match declared sizes/)
    expect(mockParseOfficeAsync).not.toHaveBeenCalled()
    expect(mockExtractRawText).not.toHaveBeenCalled()
  })

  it('rejects a ZIP-shaped .doc whose central directory cannot be parsed', async () => {
    const buffer = Buffer.alloc(64)
    buffer.writeUInt32LE(0x04034b50, 0)

    await expect(new DocParser().parseBuffer(buffer)).rejects.toThrow(
      /refusing to parse an unverifiable ZIP-shaped archive/
    )
    expect(mockParseOfficeAsync).not.toHaveBeenCalled()
  })

  it('still parses a well-formed OOXML archive renamed to .doc', async () => {
    const zip = new JSZip()
    zip.file('word/document.xml', '<w:document><w:body>hello</w:body></w:document>')
    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    mockParseOfficeAsync.mockResolvedValue('hello')

    const result = await new DocParser().parseBuffer(buffer)

    expect(result.content).toBe('hello')
    expect(result.metadata.extractionMethod).toBe('officeparser')
  })

  it('no-ops the guard for a legacy OLE .doc and parses it', async () => {
    mockParseOfficeAsync.mockResolvedValue('legacy doc text')

    const result = await new DocParser().parseBuffer(buildLegacyOleDoc())

    expect(mockParseOfficeAsync).toHaveBeenCalledOnce()
    expect(result.content).toBe('legacy doc text')
  })

  it('rejects an empty buffer', async () => {
    await expect(new DocParser().parseBuffer(Buffer.alloc(0))).rejects.toThrow('Empty buffer')
  })
})
