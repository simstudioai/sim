/**
 * Pins the `degraded` metadata contract to the parsers' real behaviour, using
 * genuine OOXML archives rather than mocks. `DocParser` never throws by design —
 * on a legacy OLE binary it returns a placeholder sentence or scraped bytes, and
 * automated callers rely on `degraded` to tell that apart from a real
 * extraction. `PptxParser` instead rejects with a typed error for a legacy
 * binary or a text-free deck, so nothing scraped ever reaches the index.
 */
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { DocParser } from '@/lib/file-parsers/doc-parser'
import { DocxParser } from '@/lib/file-parsers/docx-parser'
import { FileParserError } from '@/lib/file-parsers/errors'
import { OpenDocumentParser } from '@/lib/file-parsers/opendocument-parser'
import { PptxParser } from '@/lib/file-parsers/pptx-parser'

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

describe('PptxParser degraded reporting', () => {
  /**
   * A deck of images has no slide text. The old byte-scrape fallback returned
   * the archive's own file names (`[Content_Types].xml`) as content; a typed
   * rejection keeps ZIP internals out of the vector store.
   */
  it('reports a deck with no extractable text as a typed failure', async () => {
    const buffer = await buildPptx('<p:pic/>')

    const error = await new PptxParser().parseBuffer(buffer).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(FileParserError)
    expect(error).toMatchObject({ code: 'no_extractable_text' })
  })

  /** No pure-JS extractor reads PowerPoint 97 binaries, so the parser says so. */
  it('rejects a legacy OLE .ppt binary as unsupported', async () => {
    const error = await new PptxParser()
      .parseBuffer(buildLegacyOleBinary())
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(FileParserError)
    expect(error).toMatchObject({ code: 'unsupported_type' })
    expect((error as FileParserError).message).toContain('.pptx')
  })
})

describe('DocParser degraded reporting', () => {
  /**
   * An OLE2 header with no valid compound-file structure behind it used to fall
   * through to the byte scrape and come back as degraded placeholder prose. It is
   * now a typed rejection, so nothing downstream can index the placeholder.
   */
  it('rejects an OLE .doc binary that word-extractor cannot read as invalid_format', async () => {
    const error = await new DocParser()
      .parseBuffer(buildLegacyOleBinary())
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(FileParserError)
    expect(error).toMatchObject({ code: 'invalid_format' })
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
  it('reports a valid image-only or empty Word container as no extractable text', async () => {
    const buffer = await buildDocx('<w:p><w:r><w:drawing/></w:r></w:p>')

    const error = await new DocxParser().parseBuffer(buffer).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(FileParserError)
    expect(error).toMatchObject({ code: 'no_extractable_text' })
  })
})

describe('OpenDocumentParser', () => {
  /** OpenDocument package: `mimetype` must be the first, STORED entry. */
  function _buildOdf(mimetype: string, bodyXml: string): Promise<Buffer> {
    const zip = new JSZip()
    zip.file('mimetype', mimetype, { compression: 'STORE' })
    zip.file('META-INF/manifest.xml', '<?xml version="1.0"?><manifest:manifest/>')
    zip.file(
      'content.xml',
      `<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"><office:body>${bodyXml}</office:body></office:document-content>`
    )
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) as Promise<Buffer>
  }

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
