import type { Element, Root, Text } from 'hast'

/**
 * Which occurrence of a workflow search query a note should paint as current.
 *
 * `occurrenceIndex` counts occurrences in the note's **markdown source**, in
 * document order, because that is the only thing the search index and the card
 * share: a match carries a character range into the raw value, and the read
 * view renders a tree that has thrown those offsets away.
 *
 * The two agree whenever the query occurs in text markdown also renders — the
 * ordinary case, and every case for the plain prose notes are usually made of.
 * They diverge when an occurrence lives somewhere the read view does not print
 * (a link's URL, an image's `src`, an HTML attribute), which shifts every later
 * occurrence's rendered position by one. The mark then lands on a neighbouring
 * occurrence rather than nowhere, so search still leads to the right region of
 * the note. Closing that gap means carrying source offsets through the markdown
 * pipeline, which is a much larger change than the miss is worth.
 */
export interface NoteSearchHighlight {
  query: string
  occurrenceIndex: number
}

export interface NoteSearchHighlightOptions {
  query: string
}

/** Half-open character range of a search hit inside a note's title. */
export interface NoteSearchRange {
  start: number
  end: number
}

/**
 * Hast property name for a mark's ordinal. Hast spells `data-*` attributes in
 * camelCase and the JSX runtime converts them back, so the DOM attribute — and
 * the prop the `mark` component receives — is `data-note-search-index`.
 */
export const NOTE_SEARCH_MARK_INDEX_PROPERTY = 'dataNoteSearchIndex'

/**
 * Visits every occurrence of `query` in `text`, case-insensitively and without
 * overlaps.
 *
 * Deliberately the same scan the workflow search indexer runs over the raw
 * value (`findTextRanges`): counting and marking have to agree on what "the
 * third occurrence" means, and an overlapping scan here against a
 * non-overlapping one there would silently offset every mark in a note whose
 * query self-overlaps (`aa` in `aaaa`).
 */
export function forEachNoteSearchOccurrence(
  text: string,
  query: string,
  visit: (start: number, end: number) => void
): void {
  if (!query) return

  const haystack = text.toLowerCase()
  const needle = query.toLowerCase()
  const step = Math.max(needle.length, 1)

  let index = haystack.indexOf(needle)
  while (index !== -1) {
    visit(index, index + needle.length)
    index = haystack.indexOf(needle, index + step)
  }
}

/**
 * How many occurrences of `query` start before `offset` in `content` — the
 * ordinal of the occurrence that starts there.
 */
export function countNoteSearchOccurrencesBefore(
  content: string,
  query: string,
  offset: number
): number {
  let count = 0
  forEachNoteSearchOccurrence(content, query, (start) => {
    if (start < offset) count += 1
  })
  return count
}

interface MarkCounter {
  value: number
}

/**
 * Splits a text node around every occurrence, wrapping each in a `mark` that
 * carries its document-order ordinal. Returns an empty list when the node holds
 * no occurrence, so an untouched node keeps its identity in the tree.
 */
function splitTextNode(node: Text, query: string, counter: MarkCounter): Array<Element | Text> {
  const { value } = node
  const pieces: Array<Element | Text> = []
  let cursor = 0

  forEachNoteSearchOccurrence(value, query, (start, end) => {
    if (start > cursor) {
      pieces.push({ type: 'text', value: value.slice(cursor, start) })
    }
    pieces.push({
      type: 'element',
      tagName: 'mark',
      properties: { [NOTE_SEARCH_MARK_INDEX_PROPERTY]: String(counter.value) },
      children: [{ type: 'text', value: value.slice(start, end) }],
    })
    counter.value += 1
    cursor = end
  })

  if (pieces.length === 0) return []
  if (cursor < value.length) {
    pieces.push({ type: 'text', value: value.slice(cursor) })
  }
  return pieces
}

function markNode(node: Root | Element, query: string, counter: MarkCounter): void {
  for (let index = 0; index < node.children.length; index += 1) {
    const child = node.children[index]

    if (child.type === 'element') {
      markNode(child, query, counter)
      continue
    }
    if (child.type !== 'text') continue

    const pieces = splitTextNode(child, query, counter)
    if (pieces.length === 0) continue

    node.children.splice(index, 1, ...pieces)
    /* Past the pieces just spliced in: their own text carries the match, and
       re-scanning it would mark the inside of a mark. */
    index += pieces.length - 1
  }
}

/**
 * Rehype plugin that wraps every rendered occurrence of `query` in a `mark`.
 *
 * Runs **after** Streamdown's own defaults rather than replacing them, so
 * sanitization and hardening have already had the tree: these marks are
 * generated from text that survived both, carry no user-supplied markup, and
 * would otherwise be stripped as unknown tags.
 *
 * Must be used as a plugin **tuple** — `[noteSearchHighlightPlugin, { query }]`.
 * Streamdown caches one processor per plugin list and keys it on each plugin's
 * function name plus its serialized options, so a closure-per-query would key
 * every query to the same empty name and paint the second query's note with the
 * first query's marks.
 */
export function noteSearchHighlightPlugin({ query }: NoteSearchHighlightOptions) {
  return (tree: Root): void => {
    if (!query) return
    markNode(tree, query, { value: 0 })
  }
}
