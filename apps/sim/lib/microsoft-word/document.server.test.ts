/**
 * @vitest-environment node
 */
import { Document, Header, Packer, Paragraph, TextRun } from 'docx'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
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

  it('keeps tabs, which are legal XML, while stripping forbidden characters', async () => {
    const buffer = await buildDocxFromContent(`a\tb${String.fromCharCode(0)}c`)

    expect(await extractDocxText(buffer)).toContain('a\tbc')
  })

  it('still produces an openable document for empty content', async () => {
    const buffer = await buildDocxFromContent('')
    const xml = await readDocumentXml(buffer)

    expect(xml).toContain('<w:body>')
  })
})

describe('appendParagraphsToDocx', () => {
  it('keeps the existing content and adds the new paragraphs after it', async () => {
    const original = await buildDocxFromContent('Existing paragraph')
    const { buffer: updated } = await appendParagraphsToDocx(original, 'Appended paragraph')
    const text = await extractDocxText(updated)

    expect(text).toContain('Existing paragraph')
    expect(text).toContain('Appended paragraph')
    expect(text.indexOf('Existing paragraph')).toBeLessThan(text.indexOf('Appended paragraph'))
  })

  it('inserts before the body-level section properties', async () => {
    const original = await buildDocxFromContent('Existing paragraph')
    const { buffer: updated } = await appendParagraphsToDocx(original, 'Appended paragraph')
    const xml = await readDocumentXml(updated)

    const appendedIndex = xml.indexOf('Appended paragraph')
    const sectPrIndex = xml.lastIndexOf('<w:sectPr')

    expect(appendedIndex).toBeGreaterThan(-1)
    expect(sectPrIndex).toBeGreaterThan(appendedIndex)
  })

  it('preserves every other part of the original package', async () => {
    const original = await buildDocxFromContent('# Heading\n- bullet')
    const { buffer: updated } = await appendParagraphsToDocx(original, 'More')

    const originalNames = Object.keys((await JSZip.loadAsync(original)).files).sort()
    const updatedNames = Object.keys((await JSZip.loadAsync(updated)).files).sort()

    expect(updatedNames).toEqual(originalNames)
  })

  it('escapes XML metacharacters instead of emitting broken markup', async () => {
    const original = await buildDocxFromContent('Existing')
    const { buffer: updated } = await appendParagraphsToDocx(original, 'a < b & c > d')
    const xml = await readDocumentXml(updated)

    expect(xml).toContain('a &lt; b &amp; c &gt; d')
    expect(await extractDocxText(updated)).toContain('a < b & c > d')
  })

  it('skips blank lines so appended text does not grow trailing paragraphs', async () => {
    const original = await buildDocxFromContent('Existing')
    const { buffer: updated } = await appendParagraphsToDocx(original, 'one\n\n\ntwo')
    const xml = await readDocumentXml(updated)

    expect(xml.match(/<w:p><w:r><w:t xml:space="preserve">/g)).toHaveLength(2)
  })

  it('reports a no-op for whitespace-only content and leaves the package untouched', async () => {
    const original = await buildDocxFromContent('Existing')
    const result = await appendParagraphsToDocx(original, '   \n\n  \n')

    expect(result.paragraphsAppended).toBe(0)
    expect(result.buffer).toBe(original)
  })

  it('reports how many paragraphs it appended', async () => {
    const original = await buildDocxFromContent('Existing')
    const result = await appendParagraphsToDocx(original, 'one\ntwo\nthree')

    expect(result.paragraphsAppended).toBe(3)
  })

  it('rejects an archive that is not a Word package', async () => {
    const zip = new JSZip()
    zip.file('hello.txt', 'not a word document')
    const buffer = await zip.generateAsync({ type: 'nodebuffer' })

    await expect(appendParagraphsToDocx(buffer, 'anything')).rejects.toThrow(
      /missing word\/document\.xml/
    )
  })
})

describe('extractDocxText', () => {
  it('reads a blank Word document as empty text rather than failing', async () => {
    const blank = await buildDocxFromContent('')

    await expect(extractDocxText(blank)).resolves.toBe('')
  })

  it('still fails on an archive that is not a Word package', async () => {
    const zip = new JSZip()
    zip.file('hello.txt', 'not a word document')
    const buffer = await zip.generateAsync({ type: 'nodebuffer' })

    await expect(extractDocxText(buffer)).rejects.toThrow()
  })
})

describe('replaceTextInDocx', () => {
  it('replaces text inside a single run and keeps that run formatting', async () => {
    const original = await buildDocxWithRuns([
      [{ text: 'Hello ' }, { text: 'PLACEHOLDER', bold: true }, { text: ' goodbye' }],
    ])

    const { buffer, occurrencesChanged } = await replaceTextInDocx(
      original,
      [{ find: 'PLACEHOLDER', replace: 'Acme Corp' }],
      false
    )

    expect(occurrencesChanged).toBe(1)
    expect(await extractDocxText(buffer)).toContain('Hello Acme Corp goodbye')

    // The replacement landed inside the bold run rather than being collapsed
    // onto the unformatted first run, so the in-place path ran.
    const xml = await readDocumentXml(buffer)
    expect(xml).toMatch(/<w:b\/>[\s\S]*?<\/w:rPr><w:t xml:space="preserve">Acme Corp<\/w:t>/)
  })

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

  it('replaces every occurrence and reports the count', async () => {
    const original = await buildDocxWithRuns([[{ text: 'x and x' }], [{ text: 'x again' }]])

    const { buffer, occurrencesChanged } = await replaceTextInDocx(
      original,
      [{ find: 'x', replace: 'y' }],
      false
    )

    expect(occurrencesChanged).toBe(3)
    const text = await extractDocxText(buffer)
    expect(text).not.toContain('x')
    expect(text).toContain('y and y')
  })

  it('ignores case by default and honours matchCase when asked', async () => {
    const original = await buildDocxWithRuns([[{ text: 'Total total TOTAL' }]])

    const insensitive = await replaceTextInDocx(
      original,
      [{ find: 'total', replace: 'sum' }],
      false
    )
    expect(insensitive.occurrencesChanged).toBe(3)

    const sensitive = await replaceTextInDocx(original, [{ find: 'total', replace: 'sum' }], true)
    expect(sensitive.occurrencesChanged).toBe(1)
    expect(await extractDocxText(sensitive.buffer)).toContain('Total sum TOTAL')
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

  it('applies several replacements in one pass', async () => {
    const original = await buildDocxWithRuns([[{ text: '{{a}} then {{b}}' }]])

    const { buffer, occurrencesChanged } = await replaceTextInDocx(
      original,
      [
        { find: '{{a}}', replace: 'first' },
        { find: '{{b}}', replace: 'second' },
      ],
      false
    )

    expect(occurrencesChanged).toBe(2)
    expect(await extractDocxText(buffer)).toContain('first then second')
  })

  it('rejects an archive that is not a Word package', async () => {
    const zip = new JSZip()
    zip.file('hello.txt', 'not a word document')
    const buffer = await zip.generateAsync({ type: 'nodebuffer' })

    await expect(replaceTextInDocx(buffer, [{ find: 'a', replace: 'b' }], false)).rejects.toThrow(
      /missing word\/document\.xml/
    )
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
  it('accepts an object', () => {
    expect(parseReplacements({ '{{a}}': 'one' })).toEqual([{ find: '{{a}}', replace: 'one' }])
  })

  it('accepts a JSON string, which is how a variable reference arrives', () => {
    expect(parseReplacements('{"{{a}}": "one"}')).toEqual([{ find: '{{a}}', replace: 'one' }])
  })

  it('coerces non-string values so upstream numbers substitute cleanly', () => {
    expect(parseReplacements({ n: 42, b: true, empty: null })).toEqual([
      { find: 'n', replace: '42' },
      { find: 'b', replace: 'true' },
      { find: 'empty', replace: '' },
    ])
  })

  it('treats absent or blank input as no replacements', () => {
    expect(parseReplacements(undefined)).toEqual([])
    expect(parseReplacements(null)).toEqual([])
    expect(parseReplacements('   ')).toEqual([])
  })

  it('rejects input that is not an object mapping', () => {
    expect(() => parseReplacements('not json')).toThrow(/JSON object/)
    expect(() => parseReplacements('[1,2]')).toThrow(/JSON object/)
    expect(() => parseReplacements(7)).toThrow(/JSON object/)
  })
})
