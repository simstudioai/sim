/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockOpenPdfDocument } = vi.hoisted(() => ({
  mockOpenPdfDocument: vi.fn(),
}))

vi.mock('@/lib/file-parsers/pdfjs-server', () => ({
  openPdfDocument: mockOpenPdfDocument,
}))

import { MAX_PDF_TEXT_CHARS, PdfParser } from '@/lib/file-parsers/pdf-parser'

const PAGE_HEIGHT = 792
const BODY = 11
const PITCH = 14.4
const PARAGRAPH_GAP = 20.4

interface PositionedItem {
  str: string
  hasEOL: boolean
  transform: number[]
  width: number
  height: number
  dir: 'ltr'
}

interface BareItem {
  str: string
  hasEOL: boolean
}

type StreamItem = PositionedItem | BareItem

/** A positioned item the way pdf.js emits it for horizontal text. */
function item(str: string, x: number, y: number, height = BODY): PositionedItem {
  return {
    str,
    hasEOL: false,
    transform: [height, 0, 0, height, x, y],
    width: str.length * 5,
    height,
    dir: 'ltr',
  }
}

/** pdf.js marks a line change with an empty item positioned on the next baseline. */
function eol(x: number, y: number): PositionedItem {
  return { str: '', hasEOL: true, transform: [0, 0, 0, 0, x, y], width: 0, height: 0, dir: 'ltr' }
}

/** Body lines at the in-paragraph pitch, each preceded by pdf.js's EOL marker. */
function paragraph(texts: string[], top: number, x = 90): PositionedItem[] {
  return texts.flatMap((text, index) => {
    const y = top - index * PITCH
    return [eol(x, y), item(text, x, y)]
  })
}

function buildPage(items: StreamItem[]) {
  const read = vi
    .fn()
    .mockResolvedValueOnce({ value: { items }, done: false })
    .mockResolvedValue({ done: true })
  return {
    cleanup: vi.fn(),
    getViewport: () => ({ height: PAGE_HEIGHT }),
    streamTextContent: () => ({
      getReader: () => ({ read, cancel: vi.fn().mockResolvedValue(undefined) }),
    }),
  }
}

function pdfWithPages(pages: StreamItem[][]) {
  const built = pages.map(buildPage)
  return {
    numPages: pages.length,
    getPage: vi.fn(async (pageNumber: number) => built[pageNumber - 1]),
    destroy: vi.fn().mockResolvedValue(undefined),
  }
}

function pageWithFurniture(body: PositionedItem[], pageNumber: number): PositionedItem[] {
  return [
    item('ACME Corp — Internal Use Only', 373, 729),
    ...body,
    eol(90, 55),
    item(`Confidential draft, do not distribute — Page ${pageNumber} of 3`, 90, 55),
  ]
}

describe('PdfParser structure reconstruction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rebuilds paragraphs, headings, hyphenation, fused XObject text, and furniture', async () => {
    const firstParagraph = [
      'The revised rollout was flagged on 4 June by the Platform team. A rollback',
      'path exists and was rehearsed twice during the dry run. Stakeholders should',
      'review the attached appendix before the next checkpoint, and the owning',
      'team retains sign-off authority for scope changes above five percent.',
      'Exceptions require written approval from a director or above. This',
      'supersedes the guidance the Infrastructure team circulated on 14 March.',
    ]
    const p1Top = 676.6
    const p2Top = p1Top - 5 * PITCH - PARAGRAPH_GAP
    const p3Top = p2Top - 2 * PITCH - PARAGRAPH_GAP
    const p4Top = p3Top - 2 * PITCH - PARAGRAPH_GAP
    const cautionY = p4Top - 34.6
    const formY = cautionY - PITCH

    const pageOne = pageWithFurniture(
      [
        eol(90, 692),
        item('Memo: Office Relocation Timeline', 90, 692, 15.4),
        ...paragraph(firstParagraph, p1Top),
        eol(90, p2Top),
        item('The capacity model was archived on 25 June by the Infra', 90, p2Top),
        item('-', 365, p2Top),
        ...paragraph(
          [
            'structure team. Historical figures were restated to align with the model.',
            'Open questions are tracked in the shared register and reviewed weekly.',
          ],
          p2Top - PITCH
        ),
        ...paragraph(
          [
            'We compared attention-',
            'based models with attention-based baselines on the same hardware.',
            'Latency stayed under the objective for most sampled requests.',
          ],
          p3Top
        ),
        ...paragraph(['Keep records that support an item of income'], p4Top),
        item('CAUTION', 320, cautionY),
        item('Form 8815', 90, formY),
        item('RECORDS', 160, formY),
      ],
      1
    )
    const pageTwo = pageWithFurniture(paragraph(['Second page body text.'], p1Top), 2)
    const pageThree = pageWithFurniture(paragraph(['Third page body text.'], p1Top), 3)
    mockOpenPdfDocument.mockResolvedValueOnce(pdfWithPages([pageOne, pageTwo, pageThree]))

    const result = await new PdfParser().parseBuffer(Buffer.from('%PDF-1.4'), {
      pdfTextMode: 'complete',
    })

    expect(result.content).toBe(
      [
        'ACME Corp — Internal Use Only',
        '',
        'Memo: Office Relocation Timeline',
        '',
        ...firstParagraph,
        '',
        'The capacity model was archived on 25 June by the Infrastructure team. Historical figures were restated to align with the model.',
        'Open questions are tracked in the shared register and reviewed weekly.',
        '',
        'We compared attention-based models with attention-based baselines on the same hardware.',
        'Latency stayed under the objective for most sampled requests.',
        '',
        'Keep records that support an item of income',
        '',
        'CAUTION',
        'Form 8815 RECORDS',
        '',
        'Confidential draft, do not distribute — Page 1 of 3',
        '',
        'Second page body text.',
        '',
        'Third page body text.',
      ].join('\n')
    )
    expect(result.metadata).toMatchObject({ pageCount: 3, truncated: false })
  })

  it('keeps preview mode output structured as well', async () => {
    mockOpenPdfDocument.mockResolvedValueOnce(
      pdfWithPages([
        paragraph(['First line.', 'Second line.'], 700),
        paragraph(['Next page.'], 700),
      ])
    )

    const result = await new PdfParser().parseBuffer(Buffer.from('%PDF-1.4'))

    expect(result.content).toBe('First line.\nSecond line.\n\nNext page.')
    expect(result.metadata).toMatchObject({ pageCount: 2, truncated: false })
  })

  it('still parses when a page cannot report its viewport', async () => {
    const pdf = pdfWithPages([
      [...paragraph(['Header'], 760), ...paragraph(['Body one.'], 700)],
      [...paragraph(['Header'], 760), ...paragraph(['Body two.'], 700)],
      [...paragraph(['Header'], 760), ...paragraph(['Body three.'], 700)],
    ])
    for (let pageNumber = 1; pageNumber <= 3; pageNumber++) {
      const page = await pdf.getPage(pageNumber)
      page.getViewport = () => {
        throw new Error('no viewport')
      }
    }
    mockOpenPdfDocument.mockResolvedValueOnce(pdf)

    const result = await new PdfParser().parseBuffer(Buffer.from('%PDF-1.4'), {
      pdfTextMode: 'complete',
    })

    expect(result.content).toBe('Header\nBody one.\n\nHeader\nBody two.\n\nHeader\nBody three.')
  })

  it('keeps the free separator when the character budget cuts an item short', async () => {
    const first = item('A'.repeat(MAX_PDF_TEXT_CHARS - 5), 90, 700)
    const second = item('tail text', first.transform[4] + first.width + 6, 700)
    mockOpenPdfDocument.mockResolvedValueOnce(pdfWithPages([[first, second]]))

    const result = await new PdfParser().parseBuffer(Buffer.from('%PDF-1.4'))

    expect(result.content.slice(MAX_PDF_TEXT_CHARS - 8, MAX_PDF_TEXT_CHARS)).toBe('AAA tail')
    expect(result.metadata?.truncated).toBe(true)
  })

  it('flags preview output as truncated when paragraph breaks push it past the budget', async () => {
    const long = MAX_PDF_TEXT_CHARS - 20
    mockOpenPdfDocument.mockResolvedValueOnce(
      pdfWithPages([
        [
          item('A'.repeat(long), 90, 700),
          eol(90, 700 - PITCH),
          item('B'.repeat(9), 90, 700 - PITCH),
          eol(90, 700 - 4 * PITCH),
          item('C'.repeat(9), 90, 700 - 4 * PITCH),
        ],
      ])
    )

    const result = await new PdfParser().parseBuffer(Buffer.from('%PDF-1.4'))

    expect(result.content).toContain('\n[... PDF text truncated at parser limits')
    expect(result.metadata?.truncated).toBe(true)
    expect(result.content.indexOf('[...')).toBe(MAX_PDF_TEXT_CHARS + 1)
  })

  it('falls back to hasEOL line breaks when items carry no geometry', async () => {
    mockOpenPdfDocument.mockResolvedValueOnce(
      pdfWithPages([
        [
          { str: 'alpha', hasEOL: true },
          { str: 'beta', hasEOL: false },
          { str: 'gamma', hasEOL: false },
        ],
      ])
    )

    const result = await new PdfParser().parseBuffer(Buffer.from('%PDF-1.4'), {
      pdfTextMode: 'complete',
    })

    expect(result.content).toBe('alpha\nbetagamma')
  })
})
