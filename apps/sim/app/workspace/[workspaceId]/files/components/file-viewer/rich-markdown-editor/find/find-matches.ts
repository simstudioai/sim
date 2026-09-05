import { forEachSearchOccurrence } from '@sim/utils/string'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

/** One match, as a document position range that `Decoration.inline` can be built from. */
export interface FindMatch {
  from: number
  to: number
}

export interface FindResult {
  matches: readonly FindMatch[]
  /** More matches existed than the cap allowed; the tail was dropped. */
  truncated: boolean
}

/**
 * Cap on matches collected per search. A find bar is a navigation affordance, not a report: past a
 * few hundred hits the tally stops meaning anything, while the decoration set it would build grows
 * with the document. The bar renders the cap as `500+` so the number on screen is never a lie.
 */
export const FIND_MATCH_LIMIT = 500

export const EMPTY_FIND_RESULT: FindResult = { matches: [], truncated: false }

/**
 * Stands in for one position of a non-text inline node (an image, a mention chip) so a match can
 * never span one — searching `ab` must not join the `a` before an image to the `b` after it. U+FFFF
 * is not whitespace, so the shared scan's whitespace folding leaves it alone. Segment checks exclude
 * atoms even when a query contains this character, without excluding genuine U+FFFF text.
 */
const ATOM_PLACEHOLDER = '￿'

/** A run of the flattened block text, and the document position its first character sits at. */
interface TextSegment {
  textStart: number
  docStart: number
  isText: boolean
}

/**
 * Case-insensitive, non-overlapping search of `query` across every textblock in `doc`, returning
 * document position ranges.
 *
 * What counts as an occurrence is not decided here — {@link forEachSearchOccurrence} owns that for
 * the whole app (workflow search, the canvas Note card, and this), including the whitespace fold
 * that makes a typed space match a non-breaking one. This module only supplies the text to scan and
 * maps the indices back to ProseMirror positions.
 *
 * Text is flattened per textblock rather than per text node, so a term still matches when it runs
 * across a mark boundary (`he**llo**`), and never across a block boundary — which no on-screen line
 * does. Each block flattens to a string whose length equals the block's content size, so a string
 * index maps back to a document position by walking the segment it falls in.
 */
export function findMatches(
  doc: ProseMirrorNode,
  query: string,
  limit: number = FIND_MATCH_LIMIT
): FindResult {
  if (query.trim().length === 0) return EMPTY_FIND_RESULT

  const matches: FindMatch[] = []
  let truncated = false

  doc.descendants((node, pos) => {
    if (truncated) return false
    if (!node.isTextblock) return true

    // The common paragraph is a single text node, where the mapping is a constant offset and the
    // segment table is pure garbage. Only a block mixing marks or atoms needs one built.
    const soleChild = node.childCount === 1 ? node.firstChild : null
    const soleText = soleChild?.isText ? (soleChild.text ?? null) : null

    let text = soleText ?? ''
    let segments: TextSegment[] | null = null
    if (soleText === null) {
      const built: TextSegment[] = []
      node.forEach((child, offset) => {
        built.push({ textStart: text.length, docStart: pos + 1 + offset, isText: child.isText })
        text += child.isText && child.text ? child.text : ATOM_PLACEHOLDER.repeat(child.nodeSize)
      })
      segments = built
    }

    let segmentIndex = 0
    forEachSearchOccurrence(text, query, (start, end) => {
      if (truncated) return
      if (segments) {
        while (
          segmentIndex + 1 < segments.length &&
          segments[segmentIndex + 1].textStart <= start
        ) {
          segmentIndex++
        }
        for (
          let index = segmentIndex;
          index < segments.length && segments[index].textStart < end;
          index++
        ) {
          if (!segments[index].isText) return
        }
      }
      if (matches.length >= limit) {
        truncated = true
        return
      }
      if (!segments) {
        matches.push({ from: pos + 1 + start, to: pos + 1 + end })
        return
      }
      const segment = segments[segmentIndex]
      const from = segment.docStart + (start - segment.textStart)
      matches.push({ from, to: from + (end - start) })
    })

    // Textblocks do not nest, so there is nothing below one to search.
    return false
  })

  return matches.length === 0 && !truncated ? EMPTY_FIND_RESULT : { matches, truncated }
}
