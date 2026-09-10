/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  furnitureThreshold,
  isPageNumber,
  normalizeFurnitureText,
  type PdfPageLines,
  suppressFurniture,
} from '@/lib/file-parsers/pdf-furniture'
import type { PdfLine } from '@/lib/file-parsers/pdf-lines'

const PAGE_HEIGHT = 792

function line(text: string, y: number): PdfLine {
  return { text, y, height: 11 }
}

/** A page with a top header, a bottom footer, and two body lines. */
function page(index: number, options: { header?: string; footer?: string } = {}): PdfPageLines {
  const lines: PdfLine[] = []
  if (options.header) lines.push(line(options.header, 729))
  lines.push(
    line(`Body line one of page ${index}`, 600),
    line(`Body line two of page ${index}`, 585)
  )
  if (options.footer) lines.push(line(options.footer, 55))
  return { lines, pageHeight: PAGE_HEIGHT }
}

function texts(pages: PdfLine[][]): string[][] {
  return pages.map((lines) => lines.map((entry) => entry.text))
}

describe('suppressFurniture', () => {
  it('drops a header repeated on enough pages but keeps its first occurrence', () => {
    const pages = [1, 2, 3, 4].map((i) => page(i, { header: 'ACME Corp — Internal Use Only' }))

    const result = texts(suppressFurniture(pages))

    expect(result[0]).toContain('ACME Corp — Internal Use Only')
    for (const remaining of result.slice(1)) {
      expect(remaining).not.toContain('ACME Corp — Internal Use Only')
      expect(remaining).toHaveLength(2)
    }
  })

  it('never applies the frequency rule to a single page', () => {
    const result = texts(suppressFurniture([page(1, { header: 'Draft' })]))

    expect(result[0]).toContain('Draft')
  })

  it('treats two matching pages as furniture when the document has exactly two pages', () => {
    const pages = [1, 2].map((i) =>
      page(i, { footer: `Confidential draft, do not distribute — Page ${i} of 2` })
    )

    const result = texts(suppressFurniture(pages))

    expect(result[0]).toContain('Confidential draft, do not distribute — Page 1 of 2')
    expect(result[1]).not.toContain('Confidential draft, do not distribute — Page 2 of 2')
  })

  it('requires the fraction threshold on longer documents without a streak', () => {
    const pages = Array.from({ length: 10 }, (_, i) =>
      page(i, { footer: i % 4 === 0 ? 'Sporadic note' : undefined })
    )

    const result = texts(suppressFurniture(pages))

    expect(result.flat().filter((text) => text === 'Sporadic note')).toHaveLength(3)
  })

  it('detects a footer by a three-page streak even when its title changes per chapter', () => {
    const pages = Array.from({ length: 12 }, (_, i) => {
      const chapter = i < 6 ? 'Chapter 1 Filing Information' : 'Chapter 2 Filing Status'
      const pageNumber = i + 6
      const footer =
        i % 2 === 0
          ? `${pageNumber} ${chapter} Publication 17 (2025)`
          : `Publication 17 (2025) ${chapter} ${pageNumber}`
      return page(i, { footer })
    })

    const result = texts(suppressFurniture(pages))
    const footers = result.flat().filter((text) => text.includes('Publication 17'))

    expect(footers).toEqual([
      '6 Chapter 1 Filing Information Publication 17 (2025)',
      '12 Chapter 2 Filing Status Publication 17 (2025)',
    ])
  })

  it('drops page numbers in the bands regardless of repetition', () => {
    const pages: PdfPageLines[] = [
      { lines: [line('Page 1 of 3', 55), line('Body', 600)], pageHeight: PAGE_HEIGHT },
      { lines: [line('2', 55), line('Body', 600), line('iv', 729)], pageHeight: PAGE_HEIGHT },
      { lines: [line('- 3 -', 55), line('Body', 600), line('925', 60)], pageHeight: PAGE_HEIGHT },
    ]

    expect(texts(suppressFurniture(pages))).toEqual([['Body'], ['Body'], ['Body', '925']])
  })

  it('ignores band text longer than the furniture cap, such as a repeated table header', () => {
    const header = `SKU Product Unit price Lead time Notes ${'Column '.repeat(14)}`.trim()
    expect(header.length).toBeGreaterThan(120)
    const pages = [1, 2, 3, 4].map((i) => page(i, { header }))

    const result = texts(suppressFurniture(pages))

    for (const kept of result) expect(kept).toContain(header)
  })

  it('merges same-baseline fragments into one key before matching', () => {
    const pages = [1, 2, 3, 4].map((i) => ({
      lines: [
        line('Body', 600),
        line(`${i}`, 31.3),
        line('Chapter 1', 31.3),
        line('Publication 17 (2025)', 32.5),
      ],
      pageHeight: PAGE_HEIGHT,
    }))

    const result = texts(suppressFurniture(pages))

    expect(result[0]).toEqual(['Body', '1', 'Chapter 1', 'Publication 17 (2025)'])
    expect(result[3]).toEqual(['Body'])
  })

  it('leaves body text alone even when it repeats', () => {
    const pages = [1, 2, 3, 4].map(() => ({
      lines: [line('Repeated body sentence.', 400)],
      pageHeight: PAGE_HEIGHT,
    }))

    for (const kept of texts(suppressFurniture(pages))) {
      expect(kept).toEqual(['Repeated body sentence.'])
    }
  })

  it('skips pages without a page height or line geometry', () => {
    const pages: PdfPageLines[] = [1, 2, 3].map(() => ({
      lines: [{ text: 'Header', height: 0 }, line('Header', 729)],
    }))

    for (const kept of texts(suppressFurniture(pages))) expect(kept).toEqual(['Header', 'Header'])
  })
})

describe('normalizeFurnitureText', () => {
  it('keys mirrored facing-page footers identically', () => {
    expect(normalizeFurnitureText('6 Chapter 1 Filing Information Publication 17 (2025)')).toBe(
      normalizeFurnitureText('Publication 17 (2025) Chapter 1 Filing Information 17')
    )
  })

  it('collapses case, digits, and edge punctuation', () => {
    expect(normalizeFurnitureText('  Confidential DRAFT — Page 12 of 40. ')).toBe(
      '# # confidential draft of page'
    )
  })
})

describe('isPageNumber', () => {
  it('matches the page-number shapes', () => {
    expect(isPageNumber('Page 3', 10)).toBe(true)
    expect(isPageNumber('page 3 of 10', 10)).toBe(true)
    expect(isPageNumber('3 / 10', 10)).toBe(true)
    expect(isPageNumber('7', 10)).toBe(true)
    expect(isPageNumber('xiv', 10)).toBe(true)
    expect(isPageNumber('— 12 —', 20)).toBe(true)
  })

  it('rejects bare numbers beyond the page count and ordinary text', () => {
    expect(isPageNumber('925', 142)).toBe(false)
    expect(isPageNumber('2120', 142)).toBe(false)
    expect(isPageNumber('Chapter 1', 10)).toBe(false)
    expect(isPageNumber('civilian', 10)).toBe(false)
  })
})

describe('furnitureThreshold', () => {
  it('scales with the page count', () => {
    expect(furnitureThreshold(1)).toBeUndefined()
    expect(furnitureThreshold(2)).toBe(2)
    expect(furnitureThreshold(3)).toBe(3)
    expect(furnitureThreshold(10)).toBe(5)
    expect(furnitureThreshold(142)).toBe(71)
  })
})
