/**
 * @vitest-environment node
 *
 * Pins the `degraded` metadata contract to the parsers' real behaviour, using
 * genuine OOXML archives rather than mocks. `DocParser` and `PptxParser` never
 * throw by design — on a legacy OLE binary or a deck with no text they return a
 * placeholder sentence or scraped ZIP internals. Automated callers rely on
 * `degraded` to tell that apart from a real extraction, so if a parser stops
 * setting the flag these tests are what catches it.
 */
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { parseBuffer } from '@/lib/file-parsers'
import { DocParser } from '@/lib/file-parsers/doc-parser'
import { DocxParser } from '@/lib/file-parsers/docx-parser'
import { OpenDocumentParser } from '@/lib/file-parsers/opendocument-parser'
import { PptxParser } from '@/lib/file-parsers/pptx-parser'
import { XlsxParser } from '@/lib/file-parsers/xlsx-parser'

const OOXML_CONTENT_TYPES_RELS =
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'

function buildPptx(slideBodyXml: string, macroEnabled = false): Promise<Buffer> {
  const mainType = macroEnabled
    ? 'application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml'
    : 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml'
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${OOXML_CONTENT_TYPES_RELS}<Override PartName="/ppt/presentation.xml" ContentType="${mainType}"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>`
  )
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`
  )
  zip.file(
    'ppt/presentation.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>`
  )
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`
  )
  zip.file(
    'ppt/slides/slide1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>${slideBodyXml}</p:spTree></p:cSld></p:sld>`
  )
  return zip.generateAsync({ type: 'nodebuffer' }) as Promise<Buffer>
}

function buildDocx(bodyXml: string, macroEnabled = false): Promise<Buffer> {
  const mainType = macroEnabled
    ? 'application/vnd.ms-word.document.macroEnabled.main+xml'
    : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${OOXML_CONTENT_TYPES_RELS}<Override PartName="/word/document.xml" ContentType="${mainType}"/></Types>`
  )
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
  )
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml}</w:body></w:document>`
  )
  return zip.generateAsync({ type: 'nodebuffer' }) as Promise<Buffer>
}

/** OLE2 compound-file magic — how a genuine legacy .doc/.ppt/.xls begins. */
function buildLegacyOleBinary(): Buffer {
  return Buffer.concat([
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    Buffer.alloc(2048, 0),
  ])
}

/**
 * End-to-end through the public API, so a wrong extension→parser mapping is caught
 * (the registry test only proves *some* parser was found for each extension).
 */
describe('parseBuffer routes each extension to a parser that handles it', () => {
  it('extracts a docm through the docx parser', async () => {
    const result = await parseBuffer(
      await buildDocx('<w:p><w:r><w:t>Routed docm text</w:t></w:r></w:p>', true),
      'docm'
    )

    expect(result.content).toContain('Routed docm text')
    expect(result.metadata?.degraded).toBeFalsy()
  })

  it('extracts a pptm through the pptx parser', async () => {
    const result = await parseBuffer(
      await buildPptx(
        '<p:sp><p:txBody><a:p><a:r><a:t>Routed pptm text</a:t></a:r></a:p></p:txBody></p:sp>',
        true
      ),
      'pptm'
    )

    expect(result.content).toContain('Routed pptm text')
    expect(result.metadata?.degraded).toBeFalsy()
  })

  it.each(['xlsx', 'xlsm', 'xlsb', 'ods'] as const)(
    'extracts a %s workbook through the spreadsheet parser',
    async (bookType) => {
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Terminal'], ['BBG']]), 'Users')
      const buffer = XLSX.write(wb, { type: 'buffer', bookType }) as Buffer

      const result = await parseBuffer(buffer, bookType)

      expect(result.content).toContain('BBG')
    }
  )
})

describe('PptxParser degraded reporting', () => {
  it('extracts slide text from a real pptx without flagging it degraded', async () => {
    const buffer = await buildPptx(
      '<p:sp><p:txBody><a:p><a:r><a:t>Quarterly Market Data Review</a:t></a:r></a:p></p:txBody></p:sp>'
    )

    const result = await new PptxParser().parseBuffer(buffer)

    expect(result.content).toContain('Quarterly Market Data Review')
    expect(result.metadata?.degraded).toBeFalsy()
  })

  /**
   * A deck of images has no text for officeparser to return, and the fallback
   * then scrapes the archive — the observed output begins `[Content_Types].xml`.
   * Indexing that would put ZIP internals into the vector store.
   */
  it('flags a deck with no extractable text as degraded', async () => {
    const buffer = await buildPptx('<p:pic/>')

    const result = await new PptxParser().parseBuffer(buffer)

    expect(result.metadata?.degraded).toBe(true)
  })

  it('flags a legacy OLE .ppt binary as degraded', async () => {
    const result = await new PptxParser().parseBuffer(buildLegacyOleBinary())

    expect(result.metadata?.degraded).toBe(true)
    expect(result.content).toContain('Unable to extract text')
  })
})

describe('DocParser degraded reporting', () => {
  it('flags a legacy OLE .doc binary as degraded', async () => {
    const result = await new DocParser().parseBuffer(buildLegacyOleBinary())

    expect(result.metadata?.degraded).toBe(true)
    expect(result.content).toContain('Unable to extract text')
  })

  /**
   * A real text file misnamed `.doc` is a genuine extraction, not a degraded one —
   * the content is the file's actual text, so it stays indexable.
   */
  it('does not flag a plain-text file misnamed .doc as degraded', async () => {
    const result = await new DocParser().parseBuffer(
      Buffer.from('Vendor list\nBloomberg\nRefinitiv\n')
    )

    expect(result.content).toContain('Bloomberg')
    expect(result.metadata?.degraded).toBeFalsy()
  })
})

describe('DocxParser', () => {
  it('extracts body text from a real docx without flagging it degraded', async () => {
    const buffer = await buildDocx('<w:p><w:r><w:t>Market Data SOP body text</w:t></w:r></w:p>')

    const result = await new DocxParser().parseBuffer(buffer)

    expect(result.content).toContain('Market Data SOP body text')
    expect(result.metadata?.degraded).toBeFalsy()
  })

  /**
   * A macro-enabled `.docm` is the same WordprocessingML package with a different
   * main-part content type. mammoth reads `word/document.xml` without consulting
   * the content type, so it extracts identically — this pins that assumption.
   */
  it('extracts a macro-enabled docm package', async () => {
    const buffer = await buildDocx('<w:p><w:r><w:t>Macro-enabled body</w:t></w:r></w:p>', true)

    const result = await new DocxParser().parseBuffer(buffer)

    expect(result.content).toContain('Macro-enabled body')
    expect(result.metadata?.degraded).toBeFalsy()
  })
})

describe('PptxParser macro-enabled package', () => {
  it('extracts slide text from a pptm package', async () => {
    const buffer = await buildPptx(
      '<p:sp><p:txBody><a:p><a:r><a:t>Macro deck slide</a:t></a:r></a:p></p:txBody></p:sp>',
      true
    )

    const result = await new PptxParser().parseBuffer(buffer)

    expect(result.content).toContain('Macro deck slide')
    expect(result.metadata?.degraded).toBeFalsy()
  })
})

describe('XlsxParser workbook containers', () => {
  function workbook(bookType: XLSX.BookType): Buffer {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['User', 'Terminal'],
        ['jjean', 'BBG'],
      ]),
      'Users'
    )
    return XLSX.write(wb, { type: 'buffer', bookType }) as Buffer
  }

  /**
   * SheetJS reads all of these natively. `ods` is routed to this parser rather
   * than `OpenDocumentParser` so a spreadsheet keeps its per-sheet structure.
   */
  it.each(['xlsx', 'xlsm', 'xlsb', 'ods'] as const)('extracts cell text from %s', (bookType) => {
    const result = new XlsxParser().parseBuffer(workbook(bookType))

    return result.then((parsed) => {
      expect(parsed.content).toContain('jjean')
      expect(parsed.content).toContain('Terminal')
      expect(parsed.metadata?.degraded).toBeFalsy()
    })
  })
})

describe('OpenDocumentParser', () => {
  /** OpenDocument package: `mimetype` must be the first, STORED entry. */
  function buildOdf(mimetype: string, bodyXml: string): Promise<Buffer> {
    const zip = new JSZip()
    zip.file('mimetype', mimetype, { compression: 'STORE' })
    zip.file('META-INF/manifest.xml', '<?xml version="1.0"?><manifest:manifest/>')
    zip.file(
      'content.xml',
      `<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body>${bodyXml}</office:body></office:document-content>`
    )
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) as Promise<Buffer>
  }

  it('extracts paragraph text from an odt', async () => {
    const buffer = await buildOdf(
      'application/vnd.oasis.opendocument.text',
      '<office:text><text:p>OpenDocument paragraph</text:p></office:text>'
    )

    const result = await new OpenDocumentParser().parseBuffer(buffer)

    expect(result.content).toContain('OpenDocument paragraph')
    expect(result.metadata?.degraded).toBeFalsy()
  })

  it('extracts slide text from an odp', async () => {
    const buffer = await buildOdf(
      'application/vnd.oasis.opendocument.presentation',
      '<office:presentation><text:p>OpenDocument slide</text:p></office:presentation>'
    )

    const result = await new OpenDocumentParser().parseBuffer(buffer)

    expect(result.content).toContain('OpenDocument slide')
  })

  /**
   * No best-effort fallback here on purpose: the text lives in `content.xml`, so a
   * failure means the archive is unreadable and scraping bytes would yield markup.
   */
  it('throws rather than fabricating content for an unreadable archive', async () => {
    await expect(
      new OpenDocumentParser().parseBuffer(Buffer.from('not an archive'))
    ).rejects.toThrow(/Failed to parse OpenDocument file|Failed to extract text/)
  })

  it('rejects an empty buffer', async () => {
    await expect(new OpenDocumentParser().parseBuffer(Buffer.alloc(0))).rejects.toThrow(
      'Empty buffer provided'
    )
  })
})
