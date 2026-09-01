'use client'

import type React from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChatMessage } from '@/app/workspace/[workspaceId]/home/types'
import './chat-find.css'

/** Highlight-registry name for matches in every mounted matching message. */
const MATCH_HIGHLIGHT = 'sim-chat-find'
/** Highlight-registry name for matches inside the message being stepped on. */
const ACTIVE_HIGHLIGHT = 'sim-chat-find-active'

const NO_MATCHES: readonly number[] = []
const NO_CONTENT: readonly string[] = []

/**
 * Every occurrence of `term` under `root`, as DOM ranges. `term` must already
 * be lowercased — the caller lowercases once per keystroke rather than once
 * per text node.
 *
 * Occurrences are collected per text node, so a term broken across nodes by
 * inline markup (`**post**gres`) is not found. Stitching node boundaries would
 * mean rebuilding each message's full text on every keystroke to buy a case
 * nobody searches for.
 */
export function collectHighlightRanges(root: Element, term: string): Range[] {
  const ranges: Range[] = []
  if (term.length === 0) return ranges
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.nodeValue
    if (!text || text.length < term.length) continue
    const haystack = text.toLowerCase()
    let from = haystack.indexOf(term)
    while (from !== -1) {
      const range = document.createRange()
      range.setStart(node, from)
      range.setEnd(node, from + term.length)
      ranges.push(range)
      from = haystack.indexOf(term, from + term.length)
    }
  }
  return ranges
}

interface LowercaseEntry {
  source: string
  lower: string
}

/**
 * Message content, lowercased once and kept until that message's content
 * changes. Matching re-runs on every keystroke and the transcript is the
 * haystack, so lowercasing it per character would allocate a copy of the whole
 * conversation each time. Only the streaming row's content actually moves;
 * every other entry is reused verbatim.
 *
 * The map is rebuilt from the live message list on each pass, so entries for
 * messages that have gone away are dropped rather than accumulating, and it is
 * released outright while the find bar is closed.
 */
function useLowercasedContent(messages: ChatMessage[], enabled: boolean): readonly string[] {
  const cacheRef = useRef<Map<string, LowercaseEntry> | null>(null)
  cacheRef.current ??= new Map()
  return useMemo(() => {
    const previous = cacheRef.current as Map<string, LowercaseEntry>
    if (!enabled) {
      if (previous.size > 0) cacheRef.current = new Map()
      return NO_CONTENT
    }
    const next = new Map<string, LowercaseEntry>()
    const lowercased = messages.map((message) => {
      const source = message.content ?? ''
      const cached = previous.get(message.id)
      const entry = cached?.source === source ? cached : { source, lower: source.toLowerCase() }
      next.set(message.id, entry)
      return entry.lower
    })
    cacheRef.current = next
    return lowercased
  }, [messages, enabled])
}

export interface UseChatFindOptions {
  messages: ChatMessage[]
  /** The element whose direct children are the mounted rows, keyed `data-index`. */
  rowsRef: React.RefObject<HTMLElement | null>
  /** The virtualizer's rendered items, in order. Only their indexes are read. */
  renderedItems: readonly { index: number }[]
  /** Brings a message index into view; the virtualizer's scroll-to. */
  revealMessage: (index: number) => void
}

export interface ChatFind {
  isOpen: boolean
  query: string
  setQuery: (query: string) => void
  /** Number of messages containing the term. */
  matchCount: number
  /** 0-based position within those messages. Clamped; 0 when there are none. */
  activeIndex: number
  goToNext: () => void
  goToPrev: () => void
  close: () => void
  inputRef: React.RefObject<HTMLInputElement | null>
}

/**
 * Cmd/Ctrl+F over the chat transcript, driving the shared {@link FindBar}.
 *
 * Matches are counted per MESSAGE, not per occurrence. The transcript is
 * virtualized, so a per-occurrence tally would have to come from the raw
 * message content — which is not what the reader sees: markdown syntax,
 * special-tag markup and synthesized card labels all differ between the stored
 * string and the rendered turn. The count would then disagree with the
 * highlights the user can actually see. Counting messages is exact against the
 * thing being counted, and every occurrence inside a matching message is still
 * painted, so nothing is hidden — only the tally is coarser.
 */
export function useChatFind({
  messages,
  rowsRef,
  renderedItems,
  revealMessage,
}: UseChatFindOptions): ChatFind {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [steppedIndex, setSteppedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const term = isOpen ? query.trim().toLowerCase() : ''
  const lowercased = useLowercasedContent(messages, isOpen)

  const matchingIndexes = useMemo(() => {
    if (term.length === 0) return NO_MATCHES
    const found: number[] = []
    for (let index = 0; index < lowercased.length; index++) {
      if (lowercased[index].includes(term)) found.push(index)
    }
    return found.length > 0 ? found : NO_MATCHES
  }, [lowercased, term])

  /**
   * Clamped rather than reset: a streaming turn can drop the match the user was
   * on, and snapping back to the first one would move the viewport under them.
   */
  const activeIndex =
    matchingIndexes.length > 0 ? Math.min(steppedIndex, matchingIndexes.length - 1) : 0

  const matchingIndexesRef = useRef(matchingIndexes)
  matchingIndexesRef.current = matchingIndexes
  const activeIndexRef = useRef(activeIndex)
  activeIndexRef.current = activeIndex
  const revealMessageRef = useRef(revealMessage)
  revealMessageRef.current = revealMessage

  const goTo = useCallback((next: number) => {
    const matches = matchingIndexesRef.current
    if (matches.length === 0) return
    const wrapped = ((next % matches.length) + matches.length) % matches.length
    setSteppedIndex(wrapped)
    revealMessageRef.current(matches[wrapped])
  }, [])

  const goToNext = useCallback(() => goTo(activeIndexRef.current + 1), [goTo])
  const goToPrev = useCallback(() => goTo(activeIndexRef.current - 1), [goTo])

  /**
   * A new term resets to and reveals its first match. Keyed on the term, not on
   * the match list: the list is rebuilt on every streaming flush, and
   * re-revealing then would yank a user who has stepped elsewhere back to the
   * top of the transcript.
   */
  useEffect(() => {
    setSteppedIndex(0)
    if (term.length === 0) return
    const first = matchingIndexesRef.current[0]
    if (first !== undefined) revealMessageRef.current(first)
  }, [term])

  /**
   * Identity for the rendered window. Repainting has to follow rows mounting
   * and unmounting, but `renderedItems` is a fresh array on every scroll frame;
   * collapsing it to a string means the paint below runs when the window
   * actually changed rather than once per frame.
   */
  const renderedWindow = useMemo(
    () => (isOpen ? renderedItems.map((item) => item.index).join(',') : ''),
    [isOpen, renderedItems]
  )

  /**
   * Paint the highlights over the mounted rows. Runs before paint so a row
   * revealed by stepping is highlighted in the same frame it lands in, and
   * touches no React state — the transcript never re-renders for a keystroke.
   */
  const paintedRef = useRef(false)
  useLayoutEffect(() => {
    const registry = typeof CSS !== 'undefined' ? CSS.highlights : undefined
    if (!registry) return
    const root = rowsRef.current
    if (!isOpen || term.length === 0 || matchingIndexes.length === 0 || !root) {
      // The window signature is a dependency, so with the bar closed this runs
      // on every scroll. Nothing to erase means nothing to do.
      if (!paintedRef.current) return
      paintedRef.current = false
      registry.delete(MATCH_HIGHLIGHT)
      registry.delete(ACTIVE_HIGHLIGHT)
      return
    }
    const matching = new Set(matchingIndexes)
    const activeMessageIndex = matchingIndexes[activeIndex]
    const matchHighlight = new Highlight()
    const activeHighlight = new Highlight()
    for (const row of root.querySelectorAll<HTMLElement>(':scope > [data-index]')) {
      const index = Number(row.dataset.index)
      if (!matching.has(index)) continue
      const target = index === activeMessageIndex ? activeHighlight : matchHighlight
      for (const range of collectHighlightRanges(row, term)) target.add(range)
    }
    registry.set(MATCH_HIGHLIGHT, matchHighlight)
    registry.set(ACTIVE_HIGHLIGHT, activeHighlight)
    paintedRef.current = true
  }, [isOpen, term, matchingIndexes, activeIndex, renderedWindow, rowsRef])

  /** The registry is global; a chat that goes away must not leave paint behind. */
  useEffect(
    () => () => {
      const registry = typeof CSS !== 'undefined' ? CSS.highlights : undefined
      if (!registry) return
      registry.delete(MATCH_HIGHLIGHT)
      registry.delete(ACTIVE_HIGHLIGHT)
    },
    []
  )

  const close = useCallback(() => {
    setIsOpen(false)
    setQuery('')
    setSteppedIndex(0)
  }, [])

  useEffect(() => {
    const handleFindShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      // Caps Lock reports 'F'.
      if (event.key.toLowerCase() !== 'f') return
      // A surface nested in this route — the desktop browser panel — scopes its
      // own handler to its element, so it runs first and marks the press taken.
      if (event.defaultPrevented) return
      event.preventDefault()
      setIsOpen(true)
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
    document.addEventListener('keydown', handleFindShortcut)
    return () => document.removeEventListener('keydown', handleFindShortcut)
  }, [])

  return {
    isOpen,
    query,
    setQuery,
    matchCount: matchingIndexes.length,
    activeIndex,
    goToNext,
    goToPrev,
    close,
    inputRef,
  }
}
