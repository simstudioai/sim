/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { assessPdfTextLayer } from '@/lib/knowledge/documents/pdf-text-layer'

/** Roughly the character volume of a typeset page. */
const page = (n: number) =>
  'The Supplier shall provide the Services described in this Statement of Work. '.repeat(n)

describe('assessPdfTextLayer', () => {
  it('accepts an ordinary typeset document', () => {
    expect(assessPdfTextLayer(page(60), 2)).toEqual({ usable: true })
  })

  /**
   * A parser limit stops extraction partway, so the text that came back is plenty
   * by volume but is only part of the document. Accepting it would index a
   * fragment and drop the rest from search without saying so.
   */
  it('rejects an extraction that stopped at a parser limit', () => {
    expect(assessPdfTextLayer(page(200), 3, true)).toEqual({ usable: false, reason: 'truncated' })
  })

  it('rejects a scan, which carries no text at all', () => {
    expect(assessPdfTextLayer('', 12)).toEqual({ usable: false, reason: 'no-text' })
    expect(assessPdfTextLayer('   \n  ', 12)).toEqual({ usable: false, reason: 'no-text' })
  })

  /** A scan often still yields a header or a stamp — present, but not the content. */
  it('rejects text too sparse to be the document', () => {
    expect(assessPdfTextLayer('CONFIDENTIAL', 40)).toEqual({
      usable: false,
      reason: 'sparse-text',
    })
  })

  /**
   * A CID-keyed font with no `ToUnicode` map extracts as raw character ids. There
   * is plenty of it, so a length check passes and the document would be indexed as
   * gibberish — the failure mode a characters-per-page test alone cannot see.
   */
  it('rejects raw CID escapes from a font with no Unicode mapping', () => {
    const cid = '/31 /8 /18 /12 /44 /9 /27 /15 /3 /62 '.repeat(40)

    expect(assessPdfTextLayer(cid, 1)).toEqual({ usable: false, reason: 'cid-escapes' })
  })

  it('rejects a text layer that decoded to replacement characters', () => {
    expect(assessPdfTextLayer('�'.repeat(500), 1)).toEqual({
      usable: false,
      reason: 'unreadable-encoding',
    })
  })

  /** Real prose contains slashes and digits; only a dominant share is disqualifying. */
  it('keeps a document that merely mentions figures and dates', () => {
    const prose = `${page(40)} Payment of /50 net 30, effective 01/04/2026, ref /12 /9.`

    expect(assessPdfTextLayer(prose, 1)).toEqual({ usable: true })
  })

  it('keeps accented and non-Latin prose, which is ordinary text', () => {
    expect(assessPdfTextLayer('Zusammenfassung über Verträge. '.repeat(40), 1)).toEqual({
      usable: true,
    })
    expect(assessPdfTextLayer('契約の概要について説明します。'.repeat(40), 1)).toEqual({
      usable: true,
    })
  })

  /** An unparseable page count must still apply a floor rather than divide by zero. */
  it('treats an unknown page count as a single page', () => {
    expect(assessPdfTextLayer('short', 0)).toEqual({ usable: false, reason: 'sparse-text' })
    expect(assessPdfTextLayer(page(40), 0)).toEqual({ usable: true })
  })

  it('scales the threshold with length, so one good page does not carry a long scan', () => {
    const onePageOfText = page(30)

    expect(assessPdfTextLayer(onePageOfText, 1)).toEqual({ usable: true })
    expect(assessPdfTextLayer(onePageOfText, 200)).toEqual({
      usable: false,
      reason: 'sparse-text',
    })
  })
})
