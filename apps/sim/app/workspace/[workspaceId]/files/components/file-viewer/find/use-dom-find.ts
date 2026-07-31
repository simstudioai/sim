'use client'

import { useCallback } from 'react'
import { useRegisterFindController } from './find-context'
import { buildFindRegex, findMatches } from './find-matches'
import { FIND_PRIORITY, type FindController, type FindResultReporter } from './types'

const HIGHLIGHT_ALL = 'file-find'
const HIGHLIGHT_CURRENT = 'file-find-current'

/** Feature-detect the CSS Custom Highlight API (paints without mutating the DOM). */
function highlightApiAvailable(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined'
}

interface TextNodeIndex {
  /** The full concatenated text of the container, with `\n` separators at block boundaries. */
  text: string
  nodes: Text[]
  /** `starts[i]` is the offset of `nodes[i]` within `text`. */
  starts: number[]
}

/** Tags that break a match: text in different cells/paragraphs/list-items must not match across them. */
const BLOCK_TAGS = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'DD',
  'DIV',
  'DL',
  'DT',
  'FIELDSET',
  'FIGCAPTION',
  'FIGURE',
  'FOOTER',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'HR',
  'LI',
  'MAIN',
  'NAV',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'TABLE',
  'TBODY',
  'TD',
  'TFOOT',
  'TH',
  'THEAD',
  'TR',
  'UL',
])

/** The nearest block-level ancestor of `node` within `root` (or `root` itself), identity-comparable. */
function nearestBlock(node: Text, root: HTMLElement): Element {
  let el = node.parentElement
  while (el && el !== root && !BLOCK_TAGS.has(el.tagName)) {
    el = el.parentElement
  }
  return el ?? root
}

/**
 * Collects the container's visible text nodes and their offsets, so match offsets map back to DOM
 * ranges. Inserts a `\n` separator (mapped to -1) between text nodes in different block-level elements
 * so a query never matches across cell/paragraph boundaries, while text split only by inline marks
 * (e.g. `<b>`) stays contiguous.
 */
function indexTextNodes(root: HTMLElement): TextNodeIndex {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      const tag = parent.tagName
      if (tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT
      return node.nodeValue && node.nodeValue.length > 0
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT
    },
  })

  const nodes: Text[] = []
  const starts: number[] = []
  let text = ''
  let prevBlock: Element | null = null
  let current = walker.nextNode() as Text | null
  while (current) {
    const block = nearestBlock(current, root)
    if (prevBlock !== null && block !== prevBlock) text += '\n'
    prevBlock = block
    starts.push(text.length)
    nodes.push(current)
    text += current.nodeValue ?? ''
    current = walker.nextNode() as Text | null
  }
  return { text, nodes, starts }
}

/** Finds the text node and in-node offset for a global offset via binary search over `starts`. */
function locate(index: TextNodeIndex, offset: number): { node: Text; offset: number } | null {
  const { nodes, starts } = index
  if (nodes.length === 0) return null
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  const node = nodes[lo]
  const local = offset - starts[lo]
  return { node, offset: Math.min(local, node.nodeValue?.length ?? 0) }
}

function toRange(index: TextNodeIndex, start: number, end: number): Range | null {
  const from = locate(index, start)
  const to = locate(index, end)
  if (!from || !to) return null
  const range = document.createRange()
  range.setStart(from.node, from.offset)
  range.setEnd(to.node, to.offset)
  return range
}

export interface DomMatches {
  ranges: Range[]
  /** True when the highlight cap dropped some matches. */
  capped: boolean
}

/**
 * Finds every match of `regex` in a DOM subtree and returns DOM Ranges. Concatenates the container's
 * visible text (across element boundaries, so a match can span adjacent inline nodes) and maps match
 * offsets back to `(node, offset)` Ranges. Exported for testing.
 */
export function computeDomMatches(root: HTMLElement, regex: RegExp): DomMatches {
  const index = indexTextNodes(root)
  const { ranges, capped } = findMatches(index.text, regex)
  const domRanges = ranges
    .map((r) => toRange(index, r.start, r.end))
    .filter((r): r is Range => r !== null)
  return { ranges: domRanges, capped }
}

interface DomControllerState {
  ranges: Range[]
  currentIndex: number
  truncated: boolean
}

function createDomFindController(
  getContainer: () => HTMLElement | null,
  truncated: boolean,
  report: FindResultReporter
): FindController {
  const state: DomControllerState = { ranges: [], currentIndex: -1, truncated: false }
  const supportsHighlight = highlightApiAvailable()

  const clearHighlights = () => {
    if (!supportsHighlight) return
    CSS.highlights.delete(HIGHLIGHT_ALL)
    CSS.highlights.delete(HIGHLIGHT_CURRENT)
  }

  const paint = () => {
    if (!supportsHighlight) return
    if (state.ranges.length === 0) {
      clearHighlights()
      return
    }
    CSS.highlights.set(HIGHLIGHT_ALL, new Highlight(...state.ranges))
    const current = state.ranges[state.currentIndex]
    if (current) CSS.highlights.set(HIGHLIGHT_CURRENT, new Highlight(current))
    else CSS.highlights.delete(HIGHLIGHT_CURRENT)
  }

  const revealCurrent = () => {
    const range = state.ranges[state.currentIndex]
    if (!range) return
    const rect = range.getBoundingClientRect()
    const el = range.startContainer.parentElement
    if (el && (rect.height > 0 || rect.width > 0)) {
      el.scrollIntoView({ block: 'center' })
    }
  }

  const reportResult = () =>
    report({
      count: state.ranges.length,
      currentIndex: state.currentIndex,
      truncated: state.truncated,
    })

  return {
    priority: FIND_PRIORITY.readOnly,
    search: (query, flags) => {
      const container = getContainer()
      const regex = buildFindRegex(query, flags)
      if (!container || !regex) {
        state.ranges = []
        state.currentIndex = -1
        state.truncated = false
        clearHighlights()
        reportResult()
        return
      }
      const { ranges, capped } = computeDomMatches(container, regex)
      state.ranges = ranges
      state.currentIndex = state.ranges.length > 0 ? 0 : -1
      state.truncated = truncated || capped
      paint()
      revealCurrent()
      reportResult()
    },
    next: () => {
      if (state.ranges.length === 0) return
      state.currentIndex = (state.currentIndex + 1) % state.ranges.length
      paint()
      revealCurrent()
      reportResult()
    },
    prev: () => {
      if (state.ranges.length === 0) return
      state.currentIndex = (state.currentIndex - 1 + state.ranges.length) % state.ranges.length
      paint()
      revealCurrent()
      reportResult()
    },
    focusTarget: () => getContainer()?.focus?.(),
    dispose: () => {
      state.ranges = []
      state.currentIndex = -1
      clearHighlights()
    },
  }
}

interface UseDomFindControllerOptions {
  /** True when the surface only renders a capped window of a larger file (shows the `+` count). */
  truncated?: boolean
  /** Extra deps that should re-register the controller (e.g. once async content has rendered). */
  deps?: React.DependencyList
}

/**
 * Registers a find-only controller over a read-only DOM container (CSV/XLSX table, `<pre>` text,
 * large-CSV preview). Highlights via the CSS Custom Highlight API when available — zero DOM mutation,
 * so it never re-renders the (row-capped) table — and always supports count + scroll-to-match.
 */
export function useDomFindController(
  containerRef: React.RefObject<HTMLElement | null>,
  { truncated = false, deps = [] }: UseDomFindControllerOptions = {}
) {
  const factory = useCallback(
    (report: FindResultReporter) =>
      createDomFindController(() => containerRef.current, truncated, report),
    [containerRef, truncated]
  )

  useRegisterFindController(factory, [truncated, ...deps])
}
