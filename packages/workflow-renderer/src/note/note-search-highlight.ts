import { foldSearchWhitespace } from '@sim/utils/string'
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
 * (a link's URL, an image's `src`, an HTML attribute) or spans two blocks,
 * which shifts every later occurrence's rendered position by one. The mark then
 * lands on a neighbouring occurrence rather than nowhere, so search still leads
 * to the right region of the note. Closing that gap means carrying source
 * offsets through the markdown pipeline, which is a much larger change than the
 * miss is worth.
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
 * Elements that do not interrupt a run of text. Text either side of one reads
 * as a single phrase, so the scan below joins across them — the same thing the
 * browser's own find does in `a<strong>b</strong>c`.
 *
 * An allowlist rather than a block-level denylist: raw HTML can put any tag in
 * this tree, and treating something unrecognised as a break can only ever miss
 * a match, while treating it as inline could invent one that is not on screen.
 */
const INLINE_TAG_NAMES: ReadonlySet<string> = new Set([
  'a',
  'abbr',
  'b',
  'br',
  'cite',
  'code',
  'del',
  'em',
  'i',
  'ins',
  'kbd',
  'mark',
  'q',
  's',
  'samp',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'u',
  'var',
])

/**
 * Visits every occurrence of `query` in `text`, case-insensitively and without
 * overlaps.
 *
 * Deliberately the same scan the workflow search indexer runs over the raw
 * value (`findTextRanges`), down to folding whitespace with the shared
 * {@link foldSearchWhitespace}: counting and marking have to agree on what "the
 * third occurrence" means. An overlapping scan here against a non-overlapping
 * one there would silently offset every mark in a note whose query
 * self-overlaps (`aa` in `aaaa`), and an unfolded one would miss a phrase the
 * indexer matched across a line break.
 *
 * Case sensitivity is not plumbed through: the search panel is the only caller
 * of the indexer and never enables it. If it ever does, this is the second
 * place that has to change.
 */
export function forEachNoteSearchOccurrence(
  text: string,
  query: string,
  visit: (start: number, end: number) => void
): void {
  if (!query) return

  /* Folding is length-preserving, so every index below is also a valid index
     into the caller's unfolded string. */
  const haystack = foldSearchWhitespace(text).toLowerCase()
  const needle = foldSearchWhitespace(query).toLowerCase()
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

/** A text node and where its own text begins within its run. */
interface TextRun {
  node: Text
  start: number
}

/** A slice of one text node that a mark has to wrap, and which match it belongs to. */
interface NodeMark {
  start: number
  end: number
  ordinal: number
}

/**
 * Collects the runs of text that read continuously on screen.
 *
 * A run ends at any non-inline element, so text in two paragraphs is never
 * joined into a phrase the reader cannot see. Within a run every inline
 * boundary is crossed, including the `<br>` that `remark-breaks` puts at a soft
 * line break — that break is a single `\n` in the source, which the fold turns
 * into a single space, so the run reproduces it as one.
 */
interface RunBuilder {
  runs: TextRun[][]
  current: TextRun[] | null
  length: number
}

/** Appends text to the open run, opening one if none is. */
function appendText(builder: RunBuilder, node: Text): void {
  if (!builder.current) {
    builder.current = []
    builder.runs.push(builder.current)
  }
  builder.current.push({ node, start: builder.length })
  builder.length += node.value.length
}

function endRun(builder: RunBuilder): void {
  builder.current = null
  builder.length = 0
}

function collectTextRuns(node: Root | Element, builder: RunBuilder): void {
  for (const child of node.children) {
    if (child.type === 'text') {
      appendText(builder, child)
      continue
    }
    if (child.type !== 'element') continue

    if (child.tagName === 'br') {
      /* The newline this stands for is a single `\n` in the source, which the
         fold turns into a single space — reproduce it so a phrase the indexer
         matched across a soft break also matches here. The node is synthetic
         and never reaches the tree; it only carries the offset. */
      if (builder.current) appendText(builder, { type: 'text', value: ' ' })
      continue
    }

    /* An inline element continues the run — the builder state is shared, so
       descending is all it takes. Anything else breaks it either side. */
    if (INLINE_TAG_NAMES.has(child.tagName)) {
      collectTextRuns(child, builder)
      continue
    }

    endRun(builder)
    collectTextRuns(child, builder)
    endRun(builder)
  }
}

/** Splits a text node at its marked slices, wrapping each in a `mark`. */
function splitTextNode(node: Text, marks: NodeMark[]): Array<Element | Text> {
  const { value } = node
  const pieces: Array<Element | Text> = []
  let cursor = 0

  for (const mark of marks) {
    if (mark.start > cursor) {
      pieces.push({ type: 'text', value: value.slice(cursor, mark.start) })
    }
    pieces.push({
      type: 'element',
      tagName: 'mark',
      properties: { [NOTE_SEARCH_MARK_INDEX_PROPERTY]: String(mark.ordinal) },
      children: [{ type: 'text', value: value.slice(mark.start, mark.end) }],
    })
    cursor = mark.end
  }

  if (pieces.length === 0) return []
  if (cursor < value.length) {
    pieces.push({ type: 'text', value: value.slice(cursor) })
  }
  return pieces
}

function applyMarks(node: Root | Element, marksByNode: Map<Text, NodeMark[]>): void {
  for (let index = 0; index < node.children.length; index += 1) {
    const child = node.children[index]

    if (child.type === 'element') {
      applyMarks(child, marksByNode)
      continue
    }
    if (child.type !== 'text') continue

    const marks = marksByNode.get(child)
    if (!marks) continue

    const pieces = splitTextNode(child, marks)
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
 * A match spanning an inline boundary — a soft line break, a bold word — is
 * wrapped as several marks sharing one ordinal, so it paints as one hit. A
 * per-text-node scan could not see those at all: `remark-breaks` alone was
 * enough to hide any phrase the indexer matched across a newline, leaving it
 * counted in the panel and highlighted nowhere on the card.
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

    const builder: RunBuilder = { runs: [], current: null, length: 0 }
    collectTextRuns(tree, builder)

    const marksByNode = new Map<Text, NodeMark[]>()
    let ordinal = 0

    for (const run of builder.runs) {
      const text = run.map((entry) => entry.node.value).join('')
      forEachNoteSearchOccurrence(text, query, (start, end) => {
        const current = ordinal
        ordinal += 1
        for (const entry of run) {
          const nodeStart = entry.start
          const nodeEnd = nodeStart + entry.node.value.length
          const from = Math.max(start, nodeStart)
          const to = Math.min(end, nodeEnd)
          if (from >= to) continue
          const marks = marksByNode.get(entry.node)
          const mark = { start: from - nodeStart, end: to - nodeStart, ordinal: current }
          if (marks) marks.push(mark)
          else marksByNode.set(entry.node, [mark])
        }
      })
    }

    if (marksByNode.size === 0) return
    applyMarks(tree, marksByNode)
  }
}
