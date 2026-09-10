/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  collectCompounds,
  collectWords,
  dominantLineHeight,
  headingMarkersViable,
  joinLines,
  MAX_PDF_LINES,
  normalizePdfWhitespace,
  type PdfLine,
  PdfLineBuilder,
  readItemGeometry,
} from '@/lib/file-parsers/pdf-lines'

const BODY = 11

/** Body lines at a 14.4pt pitch starting at the given baseline. */
function paragraph(texts: string[], top: number, height = BODY): PdfLine[] {
  return texts.map((text, index) => ({ text, y: top - index * 14.4, height }))
}

describe('joinLines', () => {
  it('separates lines with \\n and paragraphs with \\n\\n from the baseline pitch', () => {
    const lines = [
      ...paragraph(['First paragraph line one', 'first paragraph line two'], 700),
      ...paragraph(['Second paragraph line one', 'second paragraph line two'], 700 - 14.4 - 20.4),
    ]

    expect(joinLines(lines, { headingMarkers: false })).toBe(
      'First paragraph line one\nfirst paragraph line two\n\nSecond paragraph line one\nsecond paragraph line two'
    )
  })

  it('breaks a paragraph where the line height changes between heading and body', () => {
    const lines: PdfLine[] = [
      { text: 'Heading', y: 700, height: 15.4 },
      { text: 'Body line', y: 700 - 15.5, height: BODY },
    ]

    expect(joinLines(lines, { headingMarkers: false })).toBe('Heading\n\nBody line')
  })

  it('joins cells that share a baseline with a space', () => {
    const lines: PdfLine[] = [
      { text: 'SKU', y: 600, height: BODY },
      { text: 'HW-1021', y: 600.2, height: BODY },
      { text: 'Next row', y: 600 - 14.4, height: BODY },
    ]

    expect(joinLines(lines, { headingMarkers: false })).toBe('SKU HW-1021\nNext row')
  })

  it('rejoins a wrapped table cell to its row on a short upward return', () => {
    const lines: PdfLine[] = [
      { text: 'HW-1000 Rack unit model', y: 669.5, height: BODY },
      { text: 'D0', y: 655.1, height: BODY },
      { text: '$65,918.68 6 weeks', y: 669.5, height: BODY },
      { text: 'HW-1001 Blade unit', y: 635.9, height: BODY },
      { text: 'model E1', y: 621.5, height: BODY },
      { text: '$942,425.74 11 weeks', y: 635.9, height: BODY },
    ]

    expect(joinLines(lines, { headingMarkers: false })).toBe(
      'HW-1000 Rack unit model D0 $65,918.68 6 weeks\n\nHW-1001 Blade unit model E1 $942,425.74 11 weeks'
    )
  })

  it('starts a paragraph when the text returns upward to a new column', () => {
    const lines: PdfLine[] = [
      ...paragraph(['Column one ends here.'], 100),
      ...paragraph(['Column two starts here.'], 700),
    ]

    expect(joinLines(lines, { headingMarkers: false })).toBe(
      'Column one ends here.\n\nColumn two starts here.'
    )
  })

  it('falls back to single line breaks when lines carry no geometry', () => {
    const lines: PdfLine[] = [
      { text: 'one', height: 0 },
      { text: 'two', height: 0 },
    ]

    expect(joinLines(lines)).toBe('one\ntwo')
  })

  it('prefixes short oversized lines with a heading marker only when markers are requested', () => {
    const lines: PdfLine[] = [
      { text: 'Memo: Office Relocation Timeline', y: 692, height: 15.4 },
      ...paragraph(['Body text follows the title.'], 676.6),
    ]

    expect(joinLines(lines, { bodyHeight: BODY, headingMarkers: true })).toBe(
      '## Memo: Office Relocation Timeline\n\nBody text follows the title.'
    )
    expect(joinLines(lines, { bodyHeight: BODY })).toBe(
      'Memo: Office Relocation Timeline\n\nBody text follows the title.'
    )
  })

  it('does not mark a heading candidate inside a run of more than three same-height lines', () => {
    const tall = paragraph(
      ['Slide bullet one', 'Slide bullet two', 'Slide bullet three', 'Slide bullet four'],
      700,
      15.4
    )
    const single: PdfLine[] = [
      { text: 'Real heading', y: 700, height: 15.4 },
      ...paragraph(['Body text follows the heading here.'], 684),
    ]

    expect(joinLines(tall, { bodyHeight: BODY, headingMarkers: true })).not.toContain('## ')
    expect(joinLines(single, { bodyHeight: BODY, headingMarkers: true })).toMatch(
      /^## Real heading/
    )
  })

  it('joins fifty thousand lines in linear time', () => {
    const lines: PdfLine[] = Array.from({ length: 50_000 }, (_, i) => ({
      text: i % 2 === 0 ? `line ${i} ends with hyphen-` : `ated continuation ${i}`,
      y: 1_000_000 - i * 14.4,
      height: BODY,
    }))
    const started = performance.now()

    const text = joinLines(lines, { words: new Set(['hyphenated']) })

    expect(performance.now() - started).toBeLessThan(1000)
    expect(text).toContain('ends with hyphenated continuation')
  })

  it('keeps a multi-line heading together by scaling the pitch with its height', () => {
    const lines: PdfLine[] = [
      { text: 'Do I Have To', y: 735.9, height: 15 },
      { text: 'File a Return?', y: 719.9, height: 15 },
      ...paragraph(['You must file a federal income tax return if you', 'are a citizen'], 701.8, 8),
      ...paragraph(['a resident of Puerto Rico'], 701.8 - 2 * 9.5, 8),
    ]

    expect(joinLines(lines, { bodyHeight: 8, headingMarkers: false })).toBe(
      'Do I Have To\nFile a Return?\n\nYou must file a federal income tax return if you\nare a citizen\na resident of Puerto Rico'
    )
  })

  describe('dehyphenation', () => {
    it('removes a line-end hyphen when the document shows the joined word', () => {
      const lines = paragraph(['archived by the Infra-', 'structure team.'], 627.4)
      const words = collectWords([{ text: 'The Infrastructure team owns it.', height: BODY }])

      expect(joinLines(lines, { words, headingMarkers: false })).toBe(
        'archived by the Infrastructure team.'
      )
    })

    it('keeps an unknown line-end hyphen rather than inventing a word', () => {
      const lines = paragraph(['we ship high-', 'quality builds'], 627.4)
      const words = collectWords(lines)

      expect(joinLines(lines, { words, headingMarkers: false })).toBe('we ship high-quality builds')
      expect(joinLines(lines, { headingMarkers: false })).toBe('we ship high-quality builds')
    })

    it('keeps the hyphen when the compound appears intact elsewhere in the document', () => {
      const lines = paragraph(['we compare attention-', 'based models with others'], 700)
      const compounds = collectCompounds([{ text: 'Attention-based models win.', height: BODY }])

      expect(joinLines(lines, { compounds, headingMarkers: false })).toBe(
        'we compare attention-based models with others'
      )
    })

    it('keeps the hyphen when the next line starts with a capital or the break is a paragraph', () => {
      expect(
        joinLines(paragraph(['the English-', 'German pair'], 700), { headingMarkers: false })
      ).toBe('the English-\nGerman pair')

      const acrossParagraphs: PdfLine[] = [
        ...paragraph(['a first line', 'a second line', 'ends with a dash-'], 700),
        ...paragraph(['lowercase start'], 700 - 2 * 14.4 - 30),
      ]
      expect(joinLines(acrossParagraphs, { headingMarkers: false })).toBe(
        'a first line\na second line\nends with a dash-\n\nlowercase start'
      )
    })

    it('always removes a soft hyphen at a line break', () => {
      const lines = paragraph(['Infra­', 'Structure'], 700)

      expect(joinLines(lines, { headingMarkers: false })).toBe('InfraStructure')
    })
  })
})

describe('PdfLineBuilder', () => {
  it('stops splitting lines at the ceiling and keeps the overflow text', () => {
    const builder = new PdfLineBuilder()
    for (let i = 0; i < MAX_PDF_LINES; i++) {
      builder.append('x', { x: 0, y: i, width: 1, height: 1 })
      builder.endLine()
    }
    builder.append('overflow', { x: 0, y: -1, width: 1, height: 1 })
    builder.endLine()
    builder.append('tail', { x: 0, y: -2, width: 1, height: 1 })

    const lines = builder.finish()

    expect(lines).toHaveLength(MAX_PDF_LINES)
    expect(lines[lines.length - 1].text).toBe('x overflow tail')
  })

  it('starts a new line on a baseline change even without hasEOL', () => {
    const builder = new PdfLineBuilder()
    builder.append('and', { x: 100, y: 700, width: 20, height: 11 })
    const separator = builder.separatorBefore('CAUTION', { x: 100, y: 680, width: 50, height: 11 })

    expect(separator).toBe('\n')
  })

  it('starts a new cell on a backwards x-move along one baseline', () => {
    const builder = new PdfLineBuilder()
    builder.append('EOL 2027', { x: 400, y: 700, width: 40, height: 11 })

    expect(builder.separatorBefore('HW-1021', { x: 120, y: 700, width: 40, height: 11 })).toBe('\n')
  })

  it('inserts a space across a word-sized gap and nothing across a tight one', () => {
    const builder = new PdfLineBuilder()
    builder.append('Table', { x: 100, y: 700, width: 30, height: 11 })

    expect(builder.separatorBefore('Caption', { x: 136, y: 700, width: 40, height: 11 })).toBe(' ')
    expect(builder.separatorBefore('s', { x: 130.5, y: 700, width: 5, height: 11 })).toBe('')
    builder.append(' ', { x: 130, y: 700, width: 4, height: 0 })
    expect(builder.separatorBefore('Caption', { x: 140, y: 700, width: 40, height: 11 })).toBe('')
  })

  it('records the baseline and dominant height of each line and drops blank lines', () => {
    const builder = new PdfLineBuilder()
    builder.append('•', { x: 90, y: 592.5, width: 3.9, height: 12.6 })
    builder.append(' ', { x: 93.9, y: 592.5, width: 5.5, height: 0 })
    builder.append('Confirm desk allocations', { x: 99.4, y: 592.5, width: 157, height: 11 })
    builder.endLine()
    builder.append('   ')
    builder.endLine()

    expect(builder.finish()).toEqual([{ text: '• Confirm desk allocations', y: 592.5, height: 11 }])
  })
})

describe('readItemGeometry', () => {
  it('returns undefined for missing, rotated, or non-ltr items', () => {
    expect(readItemGeometry({ str: 'x' })).toBeUndefined()
    expect(readItemGeometry({ str: 'x', transform: [0, 1, -1, 0, 10, 20] })).toBeUndefined()
    expect(
      readItemGeometry({ str: 'x', transform: [1, 0, 0, 1, 10, 20], dir: 'rtl' })
    ).toBeUndefined()
    expect(readItemGeometry({ str: 'x', transform: [1, 0, 0, 1, 'a', 20] })).toBeUndefined()
  })

  it('reads placement from a horizontal transform', () => {
    expect(
      readItemGeometry({
        str: 'x',
        transform: [1, 0, 0, 1, 10, 20],
        width: 5,
        height: 11,
        dir: 'ltr',
      })
    ).toEqual({ x: 10, y: 20, width: 5, height: 11 })
  })
})

describe('helpers', () => {
  it('collapses blanks without destroying line structure', () => {
    expect(normalizePdfWhitespace('a  b \n  c\n\n\n\nd\t e')).toBe('a b\nc\n\nd e')
  })

  it('picks the character-weighted modal height as body height', () => {
    expect(
      dominantLineHeight([
        { text: 'Heading', height: 15.4 },
        { text: 'A long body line of text', height: 11 },
        { text: 'Another body line', height: 11.02 },
      ])
    ).toBe(11)
  })

  it('weighs only prose-like lines when the document has any, so table text cannot become the body', () => {
    const cells = Array.from({ length: 200 }, (_, i) => ({ text: `${i} 4,512 7%`, height: 7.5 }))
    const prose = [
      { text: 'This sentence is long enough and has enough words to count as prose.', height: 11 },
    ]

    expect(dominantLineHeight([...cells, ...prose])).toBe(11)
    expect(dominantLineHeight(cells)).toBe(7.5)
  })

  it('disables heading markers when too many lines would qualify', () => {
    const bullets = Array.from({ length: 6 }, () => ({ text: 'Bullet', height: 15 }))
    const body = Array.from({ length: 4 }, () => ({ text: 'Body', height: 11 }))

    expect(headingMarkersViable([...bullets, ...body], 11)).toBe(false)
    expect(headingMarkersViable([bullets[0], ...body], 11)).toBe(true)
  })

  it('collects words of three to forty letters and caps the set', () => {
    const words = collectWords([
      { text: `ab abc ${'x'.repeat(41)} ${'y'.repeat(40)}`, height: BODY },
    ])
    expect(words).toEqual(new Set(['abc', 'y'.repeat(40)]))

    const letters = (n: number): string =>
      n < 26 ? String.fromCharCode(97 + n) : letters(Math.floor(n / 26)) + letters(n % 26)
    const unique = Array.from({ length: 200_050 }, (_, i) => `w${letters(i)}z`).join(' ')
    expect(collectWords([{ text: unique, height: BODY }]).size).toBe(200_000)
  })
})
