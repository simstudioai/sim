import { Document, Header, Packer, Paragraph, TextRun } from 'docx'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { MAX_OOXML_CENTRAL_DIRECTORY_RECORDS, ZipBombError } from '@/lib/file-parsers/ooxml-limits'
import {
  appendParagraphsToDocx,
  buildDocxFromContent,
  extractDocxText,
  parseReplacements,
  replaceTextInDocx,
} from '@/lib/microsoft-word/document.server'

/** The characters XML 1.0 forbids in a text node, as a fresh (unstateful) matcher. */
const INVALID_XML_CHARS_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/

/** Reads one XML part out of a generated package. */
async function readPart(buffer: Buffer, path = 'word/document.xml'): Promise<string> {
  const zip = await JSZip.loadAsync(buffer)
  const part = zip.file(path)
  expect(part).not.toBeNull()
  return (part as JSZip.JSZipObject).async('string')
}

/** Reads `word/document.xml` out of a generated package. */
function readDocumentXml(buffer: Buffer): Promise<string> {
  return readPart(buffer)
}

/**
 * Builds a package whose paragraphs are made of explicitly split runs, which is
 * how Word itself stores text once formatting or spell-check state changes
 * mid-sentence.
 */
async function buildDocxWithRuns(
  paragraphs: ReadonlyArray<ReadonlyArray<{ text: string; bold?: boolean }>>,
  headerRuns?: readonly string[]
): Promise<Buffer> {
  const document = new Document({
    sections: [
      {
        ...(headerRuns
          ? {
              headers: {
                default: new Header({
                  children: [
                    new Paragraph({
                      children: headerRuns.map((text) => new TextRun({ text })),
                    }),
                  ],
                }),
              },
            }
          : {}),
        children: paragraphs.map(
          (runs) =>
            new Paragraph({
              children: runs.map((run) => new TextRun({ text: run.text, bold: run.bold })),
            })
        ),
      },
    ],
  })

  return Packer.toBuffer(document)
}

describe('buildDocxFromContent', () => {
  it('produces a package whose text round-trips through the DOCX parser', async () => {
    const buffer = await buildDocxFromContent('First line\n\nSecond line')
    const text = await extractDocxText(buffer)

    expect(text).toContain('First line')
    expect(text).toContain('Second line')
  })

  it('maps the supported Markdown subset onto Word formatting', async () => {
    const buffer = await buildDocxFromContent('# Title\n- a bullet\nplain **bold** text')
    const xml = await readDocumentXml(buffer)

    expect(xml).toContain('Heading1')
    expect(xml).toContain('<w:numPr>')
    expect(xml).toContain('<w:b ')
    expect(xml).toContain('bold')
  })

  it('leaves unmatched asterisks as literal text rather than dropping them', async () => {
    const buffer = await buildDocxFromContent('2 * 3 = 6')
    const text = await extractDocxText(buffer)

    expect(text).toContain('2 * 3 = 6')
  })

  it('strips control characters that would make the package unopenable', async () => {
    // The docx package writes run text into the XML verbatim, so a forbidden
    // character reaching it produces invalid XML 1.0 rather than a rendering bug.
    const buffer = await buildDocxFromContent(`before${String.fromCharCode(8)}after`)
    const xml = await readDocumentXml(buffer)

    expect(INVALID_XML_CHARS_PATTERN.test(xml)).toBe(false)
    expect(xml).toContain('beforeafter')
  })
})

describe('appendParagraphsToDocx', () => {
  it('inserts before the body-level section properties', async () => {
    const original = await buildDocxFromContent('Existing paragraph')
    const { buffer: updated } = await appendParagraphsToDocx(original, 'Appended paragraph')
    const xml = await readDocumentXml(updated)

    const appendedIndex = xml.indexOf('Appended paragraph')
    const sectPrIndex = xml.lastIndexOf('<w:sectPr')

    expect(appendedIndex).toBeGreaterThan(-1)
    expect(sectPrIndex).toBeGreaterThan(appendedIndex)
  })

  it('escapes XML metacharacters instead of emitting broken markup', async () => {
    const original = await buildDocxFromContent('Existing')
    const { buffer: updated } = await appendParagraphsToDocx(original, 'a < b & c > d')
    const xml = await readDocumentXml(updated)

    expect(xml).toContain('a &lt; b &amp; c &gt; d')
    expect(await extractDocxText(updated)).toContain('a < b & c > d')
  })
})

describe('extractDocxText', () => {
  it('refuses an archive the OOXML guard rejects rather than rescuing it', async () => {
    // The rescue re-opens the buffer with JSZip and reads `word/document.xml`
    // into a string with no size cap, and the parser rejecting the archive is
    // exactly what routes it there. The body stays empty so the rescue would
    // otherwise succeed — reporting the archive as an empty document.
    const zip = await JSZip.loadAsync(await buildDocxFromContent(''))
    for (let index = 0; index <= MAX_OOXML_CENTRAL_DIRECTORY_RECORDS; index++) {
      zip.file(`word/embeddings/pad${index}.bin`, '')
    }

    await expect(extractDocxText(await zip.generateAsync({ type: 'nodebuffer' }))).rejects.toThrow(
      ZipBombError
    )
  })
})

describe('replaceTextInDocx', () => {
  it('replaces a placeholder that Word split across runs', async () => {
    const original = await buildDocxWithRuns([
      [{ text: 'Dear {{cus' }, { text: 'tomer', bold: true }, { text: '}},' }],
    ])

    const { buffer, occurrencesChanged } = await replaceTextInDocx(
      original,
      [{ find: '{{customer}}', replace: 'Acme Corp' }],
      false
    )

    expect(occurrencesChanged).toBe(1)
    expect(await extractDocxText(buffer)).toContain('Dear Acme Corp,')
  })

  it('never matches across a paragraph boundary', async () => {
    const original = await buildDocxWithRuns([[{ text: 'first' }], [{ text: 'second' }]])

    const { occurrencesChanged } = await replaceTextInDocx(
      original,
      [{ find: 'firstsecond', replace: 'joined' }],
      false
    )

    expect(occurrencesChanged).toBe(0)
  })

  it('treats $ in the replacement literally, not as a substitution directive', async () => {
    const original = await buildDocxWithRuns([[{ text: 'AMOUNT' }]])

    const { buffer } = await replaceTextInDocx(
      original,
      [{ find: 'AMOUNT', replace: '$1,200 ($&)' }],
      false
    )

    expect(await extractDocxText(buffer)).toContain('$1,200 ($&)')
  })

  it('escapes XML metacharacters introduced by the replacement', async () => {
    const original = await buildDocxWithRuns([[{ text: 'NAME' }]])

    const { buffer } = await replaceTextInDocx(
      original,
      [{ find: 'NAME', replace: 'Ben & Co <Ltd>' }],
      false
    )

    expect(await readDocumentXml(buffer)).toContain('Ben &amp; Co &lt;Ltd&gt;')
    expect(await extractDocxText(buffer)).toContain('Ben & Co <Ltd>')
  })

  it('finds placeholders that live in a header, not only the body', async () => {
    const original = await buildDocxWithRuns([[{ text: 'body' }]], ['Prepared for CLIENT'])

    const { buffer, occurrencesChanged } = await replaceTextInDocx(
      original,
      [{ find: 'CLIENT', replace: 'Acme Corp' }],
      false
    )

    expect(occurrencesChanged).toBe(1)
    expect(await readPart(buffer, 'word/header1.xml')).toContain('Acme Corp')
  })

  it('rejects an empty search term instead of matching everywhere', async () => {
    const original = await buildDocxWithRuns([[{ text: 'text' }]])

    await expect(replaceTextInDocx(original, [{ find: '', replace: 'x' }], false)).rejects.toThrow(
      /Search text is required/
    )
    await expect(replaceTextInDocx(original, [], false)).rejects.toThrow(/At least one replacement/)
  })
})

describe('parseReplacements', () => {
  it('coerces non-string values so upstream numbers substitute cleanly', () => {
    expect(parseReplacements({ n: 42, b: true, empty: null })).toEqual([
      { find: 'n', replace: '42' },
      { find: 'b', replace: 'true' },
      { find: 'empty', replace: '' },
    ])
  })
})
