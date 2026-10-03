import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { parseBuffer } from '@/lib/file-parsers'
import { FileParserError } from '@/lib/file-parsers/errors'
import { reconcileParserRoute, type SniffedKind, sniffFileKind } from '@/lib/file-parsers/sniff'

const OLE2_HEADER = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])

function _oleBinary(): Buffer {
  return Buffer.concat([OLE2_HEADER, Buffer.alloc(2048, 0)])
}

function pngBinary(): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(Array.from({ length: 4000 }, (_, index) => (index * 7919) % 256)),
  ])
}

async function zipWith(entries: Record<string, string>, storedMimetype?: string): Promise<Buffer> {
  const zip = new JSZip()
  if (storedMimetype) zip.file('mimetype', storedMimetype, { compression: 'STORE' })
  for (const [name, content] of Object.entries(entries)) zip.file(name, content)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) as Promise<Buffer>
}

function buildDocx(text: string): Promise<Buffer> {
  return zipWith({
    '[Content_Types].xml':
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels':
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  })
}

describe('sniffFileKind', () => {
  it('recognizes a PDF by its header at the start, after optional BOM or whitespace', () => {
    expect(sniffFileKind(Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n'))).toBe('pdf')
    expect(sniffFileKind(Buffer.from('\n  %PDF-1.4'))).toBe('pdf')
    expect(
      sniffFileKind(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('%PDF-1.4')]))
    ).toBe('pdf')
  })

  /**
   * Some PDFs carry junk before the header, which pdf.js tolerates, so a declared
   * `.pdf` keeps the 1 KiB search window. Under any other extension the signature
   * must be at the start: a `.txt` that merely mentions "%PDF-1.4" is text.
   */
  it('searches the first KiB for the PDF header only under a declared .pdf extension', () => {
    const junkThenPdf = Buffer.concat([Buffer.alloc(200, 0x41), Buffer.from('%PDF-1.4')])
    const mention = Buffer.from(
      'The file starts with the magic string %PDF-1.4 followed by objects.'
    )

    expect(sniffFileKind(junkThenPdf, 'pdf')).toBe('pdf')
    expect(sniffFileKind(junkThenPdf)).toBe('text')
    expect(sniffFileKind(junkThenPdf, 'txt')).toBe('text')
    expect(sniffFileKind(mention, 'txt')).toBe('text')
    expect(sniffFileKind(mention, 'pdf')).toBe('pdf')
    expect(
      sniffFileKind(Buffer.concat([Buffer.alloc(2000, 0x41), Buffer.from('%PDF-1.4')]), 'pdf')
    ).toBe('text')
  })

  it('classifies Office packages by their central-directory part names', async () => {
    expect(sniffFileKind(await zipWith({ 'word/document.xml': '<w/>' }))).toBe('docx')
    expect(
      sniffFileKind(await zipWith({ '[Content_Types].xml': '<T/>', 'xl/workbook.xml': '<w/>' }))
    ).toBe('xlsx')
    expect(sniffFileKind(await zipWith({ 'ppt/presentation.xml': '<p/>' }))).toBe('pptx')
  })

  it('reports NUL-bearing bytes without a UTF-16 layout as binary', () => {
    expect(sniffFileKind(pngBinary())).toBe('binary')
    expect(sniffFileKind(Buffer.from('abc\0def'))).toBe('binary')
  })

  it('treats UTF-16 text as text, with or without a BOM', () => {
    expect(
      sniffFileKind(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Hello', 'utf16le')]))
    ).toBe('text')
    expect(sniffFileKind(Buffer.from('Hello UTF-16 without a BOM', 'utf16le'))).toBe('text')
  })
})

describe('reconcileParserRoute', () => {
  it.each<[string, SniffedKind, string]>([
    ['xlsx', 'text', 'csv'],
    ['xls', 'text', 'csv'],
    ['txt', 'html', 'html'],
    ['md', 'html', 'html'],
    ['docx', 'pdf', 'pdf'],
    ['txt', 'pdf', 'pdf'],
    ['xlsx', 'docx', 'docx'],
    ['doc', 'docx', 'docx'],
    ['pdf', 'docx', 'docx'],
    ['docx', 'xlsx', 'xlsx'],
    ['docx', 'pptx', 'pptx'],
    ['docx', 'odt', 'odt'],
    ['odt', 'ods', 'ods'],
    ['txt', 'odp', 'odp'],
    ['docx', 'ole2', 'doc'],
    ['doc', 'text', 'txt'],
    ['docx', 'text', 'txt'],
    ['pptx', 'text', 'txt'],
    ['pdf', 'text', 'txt'],
    ['odt', 'text', 'txt'],
  ])('re-routes .%s holding %s to the %s parser with a warning', (extension, kind, route) => {
    expect(reconcileParserRoute(extension, kind)).toEqual({
      extension: route,
      detectedType: kind,
      warning: expect.stringContaining(`parsed as .${route} instead of .${extension}`),
    })
  })

  /** An HTML error page saved as structured data is an error, not a document. */
  it.each(['csv', 'json', 'jsonl', 'yaml', 'yml'])(
    'rejects an HTML document under .%s as invalid_format',
    (extension) => {
      expect(() => reconcileParserRoute(extension, 'html')).toThrow(
        expect.objectContaining({ code: 'invalid_format' })
      )
    }
  )

  it.each(['doc', 'docx', 'txt', 'pdf', 'xlsx', 'unknown'])(
    'rejects RTF under .%s as unsupported_type',
    (extension) => {
      expect(() => reconcileParserRoute(extension, 'rtf')).toThrow(
        expect.objectContaining({
          code: 'unsupported_type',
          message: expect.stringContaining('RTF'),
        })
      )
    }
  )

  it.each<[string, SniffedKind]>([
    ['csv', 'zip'],
    ['txt', 'ole2'],
    ['docx', 'binary'],
    ['pdf', 'binary'],
    ['pdf', 'ole2'],
    ['odt', 'ole2'],
  ])('rejects .%s holding %s as invalid_format', (extension, kind) => {
    const error = (() => {
      try {
        reconcileParserRoute(extension, kind)
        return null
      } catch (caught) {
        return caught
      }
    })()

    expect(error).toBeInstanceOf(FileParserError)
    expect(error).toMatchObject({ code: 'invalid_format' })
  })
})

describe('parseBuffer reconciles the extension with the sniffed bytes', () => {
  it('parses CSV bytes labelled .xlsx as CSV and keeps their UTF-8 intact', async () => {
    const result = await parseBuffer(Buffer.from('name,city\nAna,Araújo\n'), 'xlsx')

    expect(result.content).toContain('Araújo')
    expect(result.content).not.toContain('Ã')
    expect(result.metadata).toMatchObject({
      detectedType: 'text',
      warning: expect.stringContaining('parsed as .csv instead of .xlsx'),
    })
  })

  it('rejects a PNG labelled .doc with a typed error instead of placeholder prose', async () => {
    await expect(parseBuffer(pngBinary(), 'doc')).rejects.toMatchObject({
      name: 'FileParserError',
      code: 'invalid_format',
    })
  })

  it('rejects RTF bytes under .doc and .docx instead of indexing control words', async () => {
    const rtf = Buffer.from(
      '{\\rtf1\\ansi{\\fonttbl\\f0\\fswiss Helvetica;}\\f0\\pard Hello, world.\\par}'
    )

    for (const extension of ['doc', 'docx']) {
      await expect(parseBuffer(rtf, extension)).rejects.toMatchObject({
        name: 'FileParserError',
        code: 'unsupported_type',
      })
    }
  })

  it('rejects an HTML error page saved as .json', async () => {
    await expect(
      parseBuffer(Buffer.from('<!DOCTYPE html><html><body>403 Forbidden</body></html>'), 'json')
    ).rejects.toMatchObject({ code: 'invalid_format' })
  })

  it('decodes a .csv containing a stray NUL byte instead of refusing it', async () => {
    const result = await parseBuffer(Buffer.from('name,city\nAna,Lisboa\x00\n'), 'csv')

    expect(result.content).toContain('Lisboa')
    expect(result.metadata?.detectedType).toBeUndefined()
  })

  it('keeps a .txt that mentions the PDF magic string as text', async () => {
    const result = await parseBuffer(
      Buffer.from('Every PDF begins with %PDF-1.4 or similar.'),
      'txt'
    )

    expect(result.content).toContain('Every PDF begins with')
    expect(result.metadata?.detectedType).toBeUndefined()
  })

  it('surfaces a truncated OOXML archive as a typed invalid_format failure', async () => {
    const truncated = (await buildDocx('Office Relocation')).subarray(0, 200)

    await expect(parseBuffer(truncated, 'docx')).rejects.toMatchObject({
      name: 'FileParserError',
      code: 'invalid_format',
    })
  })
})
