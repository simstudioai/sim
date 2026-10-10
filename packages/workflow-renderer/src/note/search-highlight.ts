import { forEachSearchOccurrence, projectEscapedMarkdownForSearch } from '@sim/utils/string'
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
 * Visits every occurrence of `query` in a note's markdown SOURCE, reporting each
 * start in source coordinates.
 *
 * Matches against the text the markdown renders as, exactly as the search index
 * does for a field declaring `searchTextFormat: 'markdown'` — the card has to
 * agree with the panel about what counts as an occurrence, or the ordinal it is
 * handed points at a different hit than the one the user is on.
 */
export function forEachNoteSourceOccurrence(
  content: string,
  query: string,
  visit: (sourceStart: number) => void
): void {
  const projection = projectEscapedMarkdownForSearch(content)
  forEachSearchOccurrence(projection.text, query, (start) => {
    visit(projection.starts[start])
  })
}

/**
 * How many occurrences of `query` start before `offset` in `content` — the
 * ordinal of the occurrence that starts there. Both are source coordinates.
 */
export function countNoteSearchOccurrencesBefore(
  content: string,
  query: string,
  offset: number
): number {
  let count = 0
  forEachNoteSourceOccurrence(content, query, (start) => {
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

    /*
     * Every other element ends the run, `<strong>` and `<a>` included.
     *
     * `<br>` is the one boundary that stands for a character the source really
     * has. Every other inline element stands for syntax the render DROPS —
     * `**`, `_`, a backtick, a link's `](url)` — so joining across one invents
     * an adjacency that exists on screen but not in the markdown the indexer
     * scans. That is not merely a spurious extra mark: `occurrenceIndex` counts
     * source occurrences, so a fabricated hit appearing earlier in the document
     * steals the current ordinal and paints the wrong one.
     *
     * Nothing real is lost. A match spanning `a**b**c` would have to contain
     * the asterisks to exist in the source at all, and a match wholly inside
     * the element is still found — the element simply starts its own run.
     */
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
      forEachSearchOccurrence(text, query, (start, end) => {
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
