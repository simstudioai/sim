/**
 * Minimum average characters per page for an embedded text layer to be trusted.
 *
 * A typeset page carries roughly 1,500–3,000 characters and a scanned image
 * carries none, so this sits an order of magnitude below real prose and well above
 * the handful of characters a scan contributes from a header or a stamp. The gap
 * either side is wide enough that the exact value does not matter.
 */
const MIN_CHARS_PER_PAGE = 100

/**
 * Share of characters that must be ordinary printable text.
 *
 * A text layer with a broken encoding extracts as mojibake or replacement
 * characters: present in quantity, but not words.
 */
const MIN_PRINTABLE_RATIO = 0.8

/**
 * Share of characters that may look like CID escapes before the layer is rejected.
 *
 * A CID-keyed font with no `ToUnicode` map extracts as the raw character ids —
 * `/31 /8 /18 /12` — rather than glyphs. It passes a length check comfortably while
 * containing no readable text at all. Common in documents from older generators and
 * in anything using subset fonts, which is much of the contract and procurement
 * material that reaches a knowledge base.
 */
const MAX_CID_ESCAPE_RATIO = 0.5

/** Runs of the form `/31 /8`, the raw output of a CID font with no Unicode map. */
const CID_ESCAPE_PATTERN = /\/i?\d+/g

/** Characters that count as ordinary text: printable ASCII, whitespace, and Latin-1+. */
const PRINTABLE_PATTERN = /[\p{L}\p{N}\p{P}\p{Zs}\n\r\t]/gu

export type PdfTextLayerVerdict =
  | { usable: true }
  | {
      usable: false
      reason: 'no-text' | 'truncated' | 'sparse-text' | 'unreadable-encoding' | 'cid-escapes'
    }

function countMatches(text: string, pattern: RegExp): number {
  let total = 0
  for (const match of text.matchAll(pattern)) total += match[0].length
  return total
}

/**
 * Judges whether a PDF's embedded text layer can be indexed as-is, or whether the
 * document has to go through OCR to be readable.
 *
 * Extracting a text layer costs nothing and covers the large majority of PDFs;
 * OCR is a per-document call to an external service. Asking this question first
 * means only the documents that actually need OCR pay for it, and it removes the
 * dependency on that service for everything else.
 *
 * Four ways a text layer fails, none caught by the others: there is no text (a
 * scan), extraction stopped at a parser limit so what came back is only part of
 * the document, the text is too sparse to be the document's real content, or
 * there is plenty of text but it is not language — a broken encoding, or raw CID
 * codes from a font with no Unicode mapping.
 *
 * Known limitation: this judges the document as a whole, so a file that mixes
 * typeset pages with scanned inserts can average out above the threshold and keep
 * its partial text. Routing per page would catch that, and needs per-page
 * extraction this does not currently have.
 */
export function assessPdfTextLayer(
  text: string,
  pageCount: number,
  truncated = false
): PdfTextLayerVerdict {
  const trimmed = text.trim()
  if (trimmed.length === 0) return { usable: false, reason: 'no-text' }

  /**
   * Checked before anything measuring volume, because a truncated extraction has
   * plenty of text by definition and would otherwise read as healthy. Accepting it
   * would index part of a document and silently drop the rest from search, so the
   * document goes to OCR, which reads it whole.
   */
  if (truncated) return { usable: false, reason: 'truncated' }

  /**
   * An unknown page count (a PDF whose header would not parse) is treated as a
   * single page: it still applies a floor, without inventing a page count that
   * would scale the threshold arbitrarily.
   */
  const pages = pageCount > 0 ? pageCount : 1
  if (trimmed.length / pages < MIN_CHARS_PER_PAGE) return { usable: false, reason: 'sparse-text' }

  const cidChars = countMatches(trimmed, CID_ESCAPE_PATTERN)
  if (cidChars / trimmed.length > MAX_CID_ESCAPE_RATIO) {
    return { usable: false, reason: 'cid-escapes' }
  }

  const printableChars = countMatches(trimmed, PRINTABLE_PATTERN)
  if (printableChars / trimmed.length < MIN_PRINTABLE_RATIO) {
    return { usable: false, reason: 'unreadable-encoding' }
  }

  return { usable: true }
}
