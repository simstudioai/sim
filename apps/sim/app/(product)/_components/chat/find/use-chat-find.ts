'use client'

import {
  type RefObject,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { useFindShortcut } from '@/platform/lib/data/find-shortcut'
import { locateOccurrences, type TextPiece } from '@/platform/shared/text-occurrences'

/**
 * The thread's searchable text: a person's message and an assistant's prose. Activity, cards and
 * automated notices are not marked, so find never reaches into them.
 */
const FIND_ROOT = '[data-chat-find]'
/**
 * Most matches a search keeps, counted back from the newest message, so the matches nearest the
 * conversation's end stay in the list. Within a message the first occurrences are kept.
 */
const MATCH_LIMIT = 500
const EXCLUDED_CONTENT =
  'button, section, [aria-hidden="true"], [role="status"], [role="alert"], [data-footnotes], [data-footnote-ref]'
const TEXT_BLOCK = 'p, h1, h2, h3, h4, h5, h6, pre, li, td, th'
/** Stands in for an image, so a match never joins the text on either side of one. */
const BOUNDARY = '￿'
/** The CSS highlight names the conversation paints. */
const MATCH_HIGHLIGHT = 'chat-find'
const ACTIVE_HIGHLIGHT = 'chat-find-active'

/** A match by the searchable root it is in and its occurrence there, which streaming keeps stable. */
interface ChatFindMatchIdentity {
  root: Element
  occurrence: number
}

interface ChatFindMatch extends ChatFindMatchIdentity {
  range: Range
}

interface FindTally {
  term: string
  index: number
  count: number
  truncated: boolean
}

/** Finds text in rendered nodes without rewriting what React owns. */
function rangesIn(root: Element, term: string, limit: number): Range[] {
  const nodes: Text[] = []
  const pieces: TextPiece[] = []
  let text = ''
  let previousBlock: Element | null = null
  function visit(node: Node) {
    if (node instanceof Element) {
      if (node.matches('img')) {
        text += BOUNDARY
        return
      }
      if (node.matches(EXCLUDED_CONTENT)) return
      if (node.tagName === 'BR') {
        text += '\n'
        return
      }
    }
    if (node instanceof Text) {
      const block = node.parentElement?.closest(TEXT_BLOCK) ?? null
      if (!block && !node.data.trim()) return
      const skip = node.previousSibling?.nodeName === 'BR' && node.data.startsWith('\n') ? 1 : 0
      if (nodes.length && block !== previousBlock) text += '\n'
      previousBlock = block
      nodes.push(node)
      pieces.push({ start: text.length, skip, length: node.length - skip })
      text += node.data.slice(skip)
      return
    }
    for (const child of node.childNodes) visit(child)
  }
  visit(root)
  return locateOccurrences(text, pieces, term, limit).map(
    ({ first, startOffset, last, endOffset }) => {
      const range = document.createRange()
      range.setStart(nodes[first], startOffset)
      range.setEnd(nodes[last], endOffset)
      return range
    }
  )
}

function findMatches(thread: Element, term: string) {
  const roots = Array.from(thread.querySelectorAll(FIND_ROOT))
  const newestFirst: ChatFindMatch[][] = []
  let count = 0
  let truncated = false
  for (let index = roots.length - 1; index >= 0 && !truncated; index--) {
    const root = roots[index]
    const remaining = MATCH_LIMIT - count
    const ranges = rangesIn(root, term, remaining + 1)
    truncated = ranges.length > remaining
    const kept = ranges
      .slice(0, remaining)
      .map((range, occurrence) => ({ root, occurrence, range }))
    newestFirst.push(kept)
    count += kept.length
  }
  return { matches: newestFirst.reverse().flat(), truncated }
}

interface UseChatFindProps {
  chatId?: string
  /** The rendered thread find reads. */
  threadRef: RefObject<HTMLElement | null>
  /** The thread's scroll viewport, which also takes focus back when the opener is gone. */
  viewportRef: RefObject<HTMLElement | null>
}

/**
 * Find in chat: Cmd/Ctrl+F inside the conversation opens it, matches paint through the CSS Custom
 * Highlight API, and the active match scrolls to the middle of the viewport. It reads the rendered
 * thread, so fixture and live transcripts behave alike and a streaming reply joins the results.
 */
export function useChatFind({ chatId, threadRef, viewportRef }: UseChatFindProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const [scope, setScope] = useState(chatId)
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  /** Pinned by identity, so a streaming reply rebuilding the matches keeps the same one active. */
  const [active, setActive] = useState<ChatFindMatchIdentity | null>(null)
  const [tally, setTally] = useState<FindTally | null>(null)
  if (scope !== chatId) {
    setScope(chatId)
    // A pending chat adopting its id (undefined → id) is the same conversation.
    if (scope !== undefined) {
      setIsOpen(false)
      setQuery('')
      setActive(null)
    }
  }
  const deferredQuery = useDeferredValue(query)
  const term = isOpen ? deferredQuery.trim() : ''
  const isStale = query !== deferredQuery
  /** Read by `step`: the matches the tally's index points into. */
  const matchesRef = useRef<readonly ChatFindMatch[]>([])

  const open = useCallback(() => {
    if (document.activeElement instanceof HTMLElement && !inputRef.current) {
      restoreFocusRef.current = document.activeElement
    }
    setIsOpen(true)
  }, [])
  const onKeyDown = useFindShortcut({ enabled: true, inputRef, containerRef, onOpen: open })

  const restoreFocus = useCallback(() => {
    const target = restoreFocusRef.current
    restoreFocusRef.current = null
    if (target?.isConnected) target.focus({ preventScroll: true })
    else viewportRef.current?.focus({ preventScroll: true })
  }, [viewportRef])
  const close = useCallback(() => {
    setIsOpen(false)
    setQuery('')
    setActive(null)
    restoreFocus()
  }, [restoreFocus])
  useLayoutEffect(() => {
    if (restoreFocusRef.current && document.activeElement === document.body) restoreFocus()
    else restoreFocusRef.current = null
  }, [chatId, restoreFocus])
  const onQueryChange = useCallback((value: string) => {
    setQuery(value)
    setActive(null)
  }, [])
  const step = useCallback(
    (direction: 1 | -1) => {
      const matches = matchesRef.current
      if (!tally || !matches.length) return
      const target = matches[(tally.index + direction + matches.length) % matches.length]
      setActive({ root: target.root, occurrence: target.occurrence })
    },
    [tally]
  )

  useEffect(() => {
    const thread = threadRef.current
    const scroller = viewportRef.current
    if (!term || !thread || !scroller) return
    let revealed = false
    let frame = 0
    const all = typeof Highlight === 'undefined' ? null : new Highlight()
    const current = typeof Highlight === 'undefined' ? null : new Highlight()
    if (all && current) {
      CSS.highlights.set(MATCH_HIGHLIGHT, all)
      CSS.highlights.set(ACTIVE_HIGHLIGHT, current)
    }
    const paint = () => {
      const { matches, truncated } = findMatches(thread, term)
      matchesRef.current = matches
      const pinned = active
        ? matches.findIndex(
            (match) => match.root === active.root && match.occurrence === active.occurrence
          )
        : -1
      const index = Math.max(0, pinned)
      const target = matches[index]
      all?.clear()
      current?.clear()
      for (const match of matches) all?.add(match.range)
      if (target) current?.add(target.range)
      setTally((previous) =>
        previous?.term === term &&
        previous.index === index &&
        previous.count === matches.length &&
        previous.truncated === truncated
          ? previous
          : { term, index, count: matches.length, truncated }
      )
      if (!target) return
      // Pinning re-runs this effect, which reveals the match it pinned.
      if (pinned < 0) {
        setActive({ root: target.root, occurrence: target.occurrence })
        return
      }
      if (revealed) return
      const rect = target.range.getBoundingClientRect()
      if (!rect.height) return
      const bounds = scroller.getBoundingClientRect()
      scroller.scrollTop += rect.top - bounds.top - scroller.clientHeight / 2 + rect.height / 2
      revealed = true
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(paint)
    }
    const observer = new MutationObserver(schedule)
    observer.observe(thread, { childList: true, characterData: true, subtree: true })
    schedule()
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      if (CSS.highlights?.get(MATCH_HIGHLIGHT) === all) CSS.highlights.delete(MATCH_HIGHLIGHT)
      if (CSS.highlights?.get(ACTIVE_HIGHLIGHT) === current) CSS.highlights.delete(ACTIVE_HIGHLIGHT)
    }
  }, [term, active, threadRef, viewportRef])

  return {
    containerRef,
    inputRef,
    isOpen,
    query,
    /** Holds the last tally while a new term is searched, so the count never blanks on typing. */
    results: term && tally ? tally : undefined,
    /** Stepping waits until the matches describe the typed term. */
    canStep: !isStale && tally?.term === term && tally.count > 0,
    onKeyDown,
    onQueryChange,
    step,
    close,
  }
}
