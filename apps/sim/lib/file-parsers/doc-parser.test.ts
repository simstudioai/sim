import JSZip from 'jszip'
import { describe, expect, it, vi } from 'vitest'
import { FileParserError } from '@/lib/file-parsers/errors'
import { ZipBombError } from '@/lib/file-parsers/ooxml-limits'

const { mockParseOfficeText, mockExtractRawText, mockWordExtract } = vi.hoisted(() => ({
  mockParseOfficeText: vi.fn(),
  mockExtractRawText: vi.fn(),
  mockWordExtract: vi.fn(),
}))

vi.mock('@/lib/file-parsers/officeparser-module', () => ({
  parseOfficeText: mockParseOfficeText,
}))
vi.mock('mammoth', () => ({
  default: { extractRawText: mockExtractRawText },
  extractRawText: mockExtractRawText,
}))
vi.mock('word-extractor', () => ({
  default: class WordExtractor {
    extract(source: Buffer) {
      return mockWordExtract(source)
    }
  },
}))

import { DocParser } from '@/lib/file-parsers/doc-parser'

const CENTRAL_DIRECTORY_HEADER_SIGNATURE = 0x02014b50

interface WordSections {
  body?: string
  headers?: string
  footers?: string
  footnotes?: string
  endnotes?: string
  textboxes?: string
}

/** The accessor surface of word-extractor's `Document`, with empty sections by default. */
function _wordDocument(sections: WordSections) {
  return {
    getBody: () => sections.body ?? '',
    getHeaders: () => sections.headers ?? '',
    getFooters: () => sections.footers ?? '',
    getFootnotes: () => sections.footnotes ?? '',
    getEndnotes: () => sections.endnotes ?? '',
    getAnnotations: () => '',
    getTextboxes: () => sections.textboxes ?? '',
  }
}

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
  it('rejects a ZIP-shaped .doc whose declared expanded size exceeds the cap', async () => {
    const bomb = await buildDeclaredOversizeArchive(2 * 1024 * 1024 * 1024)

    await expect(new DocParser().parseBuffer(bomb)).rejects.toBeInstanceOf(ZipBombError)
  })

  it('rejects a .doc that under-declares its uncompressed size', async () => {
    /**
     * Declared sizes alone put this under every limit; officeparser and mammoth
     * only notice the mismatch after inflating the entry in full, so the guard
     * has to catch it before either library sees the buffer.
     */
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
    expect(mockParseOfficeText).not.toHaveBeenCalled()
    expect(mockExtractRawText).not.toHaveBeenCalled()
  })

  it('rejects a ZIP-shaped .doc whose central directory cannot be parsed', async () => {
    const buffer = Buffer.alloc(64)
    buffer.writeUInt32LE(0x04034b50, 0)

    await expect(new DocParser().parseBuffer(buffer)).rejects.toThrow(
      /refusing to parse an unverifiable ZIP-shaped archive/
    )
    expect(mockParseOfficeText).not.toHaveBeenCalled()
  })

  it('maps a Word 6/95 magic-number rejection to unsupported_type', async () => {
    mockWordExtract.mockRejectedValue(
      new Error('This does not seem to be a Word document: Invalid magic number: a5dc')
    )

    const error = await new DocParser()
      .parseBuffer(buildLegacyOleDoc())
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(FileParserError)
    expect(error).toMatchObject({ code: 'unsupported_type' })
    expect((error as Error).message).toMatch(/Word 6\/95/)
  })

  it('rejects bytes that are neither OLE, ZIP nor text instead of scraping placeholder prose', async () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from(Array.from({ length: 512 }, (_, index) => (index * 7919) % 256)),
    ])

    const error = await new DocParser().parseBuffer(png).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(FileParserError)
    expect(error).toMatchObject({ code: 'invalid_format' })
    expect(mockWordExtract).not.toHaveBeenCalled()
  })
})
