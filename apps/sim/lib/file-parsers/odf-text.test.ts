import JSZip, { type JSZipObject } from 'jszip'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FileParserError } from '@/lib/file-parsers/errors'
import { extractOpenDocumentText } from '@/lib/file-parsers/odf-text'
import { MAX_OFFICE_TEXT_BYTES, MAX_OFFICE_XML_PART_BYTES } from '@/lib/file-parsers/office-text'

const NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/"'

async function buildOdf(bodyXml: string, extraParts: Record<string, string> = {}): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' })
  zip.file(
    'content.xml',
    `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${NS}><office:body>${bodyXml}</office:body></office:document-content>`
  )
  for (const [path, xml] of Object.entries(extraParts)) zip.file(path, xml)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) as Promise<Buffer>
}

const text = (body: string) => buildOdf(`<office:text>${body}</office:text>`)

describe('extractOpenDocumentText', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('treats tracked deletions as accepted and keeps insertions', async () => {
    const buffer = await text(
      `<text:tracked-changes><text:changed-region text:id="ct1"><text:deletion><office:change-info><dc:creator>M</dc:creator></office:change-info><text:p>deleted words</text:p></text:deletion></text:changed-region></text:tracked-changes>` +
        `<text:p>Kept <text:change text:change-id="ct1"/>sentence.</text:p>`
    )

    expect(await extractOpenDocumentText(buffer)).toBe('Kept sentence.')
  })

  it('caps a text:s run instead of allocating what text:c asks for', async () => {
    const buffer = await text(`<text:p>A<text:s text:c="1000000000"/>B</text:p>`)

    expect(await extractOpenDocumentText(buffer)).toBe(`A${' '.repeat(100)}B`)
  })

  it('handles a long whitespace run inside the budget in linear time', async () => {
    const spaces = '<text:s text:c="100"/>'.repeat(2_000)
    const buffer = await text(`<text:p>x${spaces}y<text:line-break/>z</text:p>`)

    const started = performance.now()
    const result = await extractOpenDocumentText(buffer)

    expect(result).toBe(`x${' '.repeat(200_000)}y\nz`)
    expect(performance.now() - started).toBeLessThan(5_000)
  }, 60_000)

  it('rejects a document whose expanded text exceeds the ceiling', async () => {
    const spaces = '<text:s text:c="100"/>'.repeat(Math.ceil(MAX_OFFICE_TEXT_BYTES / 100) + 1)
    const buffer = await text(`<text:p>x${spaces}y</text:p>`)

    await expect(extractOpenDocumentText(buffer)).rejects.toMatchObject<FileParserError>({
      code: 'complexity_limit',
    })
  })

  it('stops walking at the ceiling before inflating later parts', async () => {
    const spaces = '<text:s text:c="100"/>'.repeat(Math.ceil(MAX_OFFICE_TEXT_BYTES / 100) + 1)
    const buffer = await buildOdf(`<office:text><text:p>x${spaces}y</text:p></office:text>`, {
      'Object 1/content.xml': `<?xml version="1.0"?><office:document-content ${NS}><office:body><office:text><text:p>Embedded</text:p></office:text></office:body></office:document-content>`,
    })
    const zip = await JSZip.loadAsync(buffer)
    const embedded = zip.file('Object 1/content.xml') as JSZipObject
    const inflate = vi.spyOn(embedded, 'async')
    vi.spyOn(JSZip, 'loadAsync').mockResolvedValueOnce(zip)

    await expect(extractOpenDocumentText(buffer)).rejects.toMatchObject<FileParserError>({
      code: 'complexity_limit',
    })
    expect(inflate).not.toHaveBeenCalled()
  })

  it('rejects an archive without content.xml as invalid_format', async () => {
    const zip = new JSZip()
    zip.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' })
    zip.file('junk.txt', 'not a document')
    const buffer = (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer

    await expect(extractOpenDocumentText(buffer)).rejects.toMatchObject<FileParserError>({
      code: 'invalid_format',
    })
  })

  it('rejects a content part above the per-part size cap before parsing it', async () => {
    const buffer = await text('<text:p>Small</text:p>')
    const zip = await JSZip.loadAsync(buffer)
    const entry = zip.file('content.xml') as JSZipObject & {
      _data: { uncompressedSize: number }
    }
    entry._data.uncompressedSize = MAX_OFFICE_XML_PART_BYTES + 1
    vi.spyOn(JSZip, 'loadAsync').mockResolvedValueOnce(zip)

    await expect(extractOpenDocumentText(buffer)).rejects.toMatchObject<FileParserError>({
      code: 'complexity_limit',
    })
  })
})
