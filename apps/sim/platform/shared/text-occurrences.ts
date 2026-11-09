import { forEachSearchOccurrence } from '@sim/utils/string'

/** One text node's share of a searched text. */
export interface TextPiece {
  /** Where the node's counted characters begin in the searched text. */
  start: number
  /** Leading characters of the node left out of the text, such as the newline after a line break. */
  skip: number
  /** How many of the node's characters the text counts. */
  length: number
}

/** An occurrence by the pieces it starts and ends in, with offsets into those nodes. */
interface PieceRange {
  first: number
  startOffset: number
  last: number
  endOffset: number
}

/**
 * Locates `query` in `text` (case- and whitespace-insensitive) as ranges over the text nodes it was
 * assembled from, so a match can span inline formatting. Separators between pieces belong to no
 * node, so an occurrence that starts or ends in one has no range and is skipped. Keeps the first
 * `limit` occurrences.
 */
export function locateOccurrences(
  text: string,
  pieces: readonly TextPiece[],
  query: string,
  limit: number
): PieceRange[] {
  const ranges: PieceRange[] = []
  let first = 0
  forEachSearchOccurrence(text, query, (start, end) => {
    if (ranges.length >= limit) return
    while (first + 1 < pieces.length && pieces[first + 1].start <= start) first++
    let last = first
    while (last + 1 < pieces.length && pieces[last + 1].start < end) last++
    const head = pieces[first]
    const tail = pieces[last]
    if (!head || !tail || start >= head.start + head.length || end > tail.start + tail.length)
      return
    ranges.push({
      first,
      startOffset: start - head.start + head.skip,
      last,
      endOffset: end - tail.start + tail.skip,
    })
  })
  return ranges
}
