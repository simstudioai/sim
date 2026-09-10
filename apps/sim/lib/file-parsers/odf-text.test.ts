/**
 * @vitest-environment node
 */
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { extractOpenDocumentText } from '@/lib/file-parsers/odf-text'

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
  it('drops annotations so the surrounding sentence stays intact', async () => {
    const buffer = await text(
      `<text:p>Aaa <office:annotation><dc:creator>M</dc:creator><text:sender-initials>M</text:sender-initials><text:p>First comment.</text:p></office:annotation>comment ccc.<office:annotation-end office:name="c1"/></text:p>`
    )

    expect(await extractOpenDocumentText(buffer)).toBe('Aaa comment ccc.')
  })

  it('treats tracked deletions as accepted and keeps insertions', async () => {
    const buffer = await text(
      `<text:tracked-changes><text:changed-region text:id="ct1"><text:deletion><office:change-info><dc:creator>M</dc:creator></office:change-info><text:p>deleted words</text:p></text:deletion></text:changed-region></text:tracked-changes>` +
        `<text:p>Kept <text:change text:change-id="ct1"/>sentence.</text:p>`
    )

    expect(await extractOpenDocumentText(buffer)).toBe('Kept sentence.')
  })

  it('renders headings, paragraphs, and nested lists', async () => {
    const buffer = await text(
      `<text:h text:outline-level="1">Purpose</text:h><text:p>Body line.</text:p>` +
        `<text:list><text:list-item><text:p>one</text:p><text:list><text:list-item><text:p>one-a</text:p></text:list-item></text:list></text:list-item><text:list-item><text:p>two</text:p></text:list-item></text:list>`
    )

    expect(await extractOpenDocumentText(buffer)).toBe(
      'Purpose\n\nBody line.\n\n• one\n  • one-a\n• two'
    )
  })

  it('keeps header rows and expands repeated columns up to the cap', async () => {
    const cell = (value: string, repeat?: number) =>
      `<table:table-cell${repeat === undefined ? '' : ` table:number-columns-repeated="${repeat}"`}><text:p>${value}</text:p></table:table-cell>`
    const buffer = await text(
      `<table:table><table:table-header-rows><table:table-row>${cell('Role')}${cell('Contact')}</table:table-row></table:table-header-rows>` +
        `<table:table-row>${cell('Owner')}${cell('x', 2)}</table:table-row>` +
        `<table:table-row>${cell('', 1024)}</table:table-row></table:table>`
    )

    expect(await extractOpenDocumentText(buffer)).toBe(
      '[Table]\n| Role | Contact |\n| Owner | x | x |\n[/Table]'
    )
  })

  it('expands whitespace elements and appends footnotes after the paragraph', async () => {
    const buffer = await text(
      `<text:p>A<text:s text:c="3"/>B<text:tab/>C<text:line-break/>D<text:note text:note-class="footnote"><text:note-citation>1</text:note-citation><text:note-body><text:p>snoska</text:p></text:note-body></text:note></text:p><text:p>Next.</text:p>`
    )

    expect(await extractOpenDocumentText(buffer)).toBe('A   B\tC\nD[1]\n[1] snoska\n\nNext.')
  })

  it('emits presentation notes only when they have a body, skipping page chrome', async () => {
    const buffer = await buildOdf(
      `<office:presentation><draw:page draw:name="page1"><draw:frame presentation:class="title"><draw:text-box><text:p>Slide title</text:p></draw:text-box></draw:frame>` +
        `<draw:frame presentation:class="page-number"><draw:text-box><text:p><text:page-number>1</text:page-number></text:p></draw:text-box></draw:frame>` +
        `<presentation:notes><draw:page-thumbnail/><draw:frame presentation:class="notes"><draw:text-box><text:p>Say hello</text:p></draw:text-box></draw:frame></presentation:notes></draw:page>` +
        `<draw:page draw:name="page2"><draw:frame><draw:text-box><text:p>Second slide</text:p></draw:text-box></draw:frame><presentation:notes><draw:page-thumbnail/></presentation:notes></draw:page></office:presentation>`
    )

    expect(await extractOpenDocumentText(buffer)).toBe(
      'Slide title\n\n[Notes]\nSay hello\n\nSecond slide'
    )
  })

  it('includes embedded object content parts after the main document', async () => {
    const buffer = await buildOdf(`<office:text><text:p>Main</text:p></office:text>`, {
      'Object 1/content.xml': `<?xml version="1.0"?><office:document-content ${NS}><office:body><office:text><text:p>Embedded</text:p></office:text></office:body></office:document-content>`,
    })

    expect(await extractOpenDocumentText(buffer)).toBe('Main\n\nEmbedded')
  })
})
