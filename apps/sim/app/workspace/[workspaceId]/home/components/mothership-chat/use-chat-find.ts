'use client'

import {
  type RefObject,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { forEachSearchOccurrence } from '@sim/utils/string'
import type { Virtualizer } from '@tanstack/react-virtual'
import { LRUCache } from 'lru-cache'
import { useFindShortcut } from '@/app/workspace/[workspaceId]/components/find-bar'
import { getOrchestratorMessageTextSegments } from '@/app/workspace/[workspaceId]/home/components/message-content'
import { sanitizeChatDisplayContent } from '@/app/workspace/[workspaceId]/home/components/message-content/components/chat-content/chat-sanitize'
import { parseSpecialTags } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'
import { getChatFindText } from '@/app/workspace/[workspaceId]/home/components/mothership-chat/chat-find-text'
import { getUserMessageText } from '@/app/workspace/[workspaceId]/home/components/user-message-content/utils'
import type { ChatMessage } from '@/app/workspace/[workspaceId]/home/types'

/**
 * Most matches a search keeps, counted back from the newest message: older history loads in
 * ahead of what is on screen, and a limit counted from the oldest would push the matches the
 * user is reading out of the list as it arrives. Within a message the first occurrences are
 * kept, the ones `findRanges` highlights.
 */
const MATCH_LIMIT = 500
const EXCLUDED_CONTENT =
  'button, [aria-hidden="true"], [data-agent-group], [data-chat-activity], [data-interaction-card], [data-chat-find-ignore], [data-footnote-ref], [data-footnotes]'
const TEXT_BLOCK = 'p, h1, h2, h3, h4, h5, h6, pre, li, td, th'

/** A find match by the message it is in and its occurrence there. */
interface ChatFindMatchIdentity {
  messageId: string
  occurrence: number
}

interface ChatFindMatch extends ChatFindMatchIdentity {
  messageIndex: number
}

interface UseChatFindProps {
  chatId?: string
  messages: ChatMessage[]
  hiddenUserByIndex: Array<boolean | undefined>
  containerRef: RefObject<HTMLDivElement | null>
  scrollElementRef: RefObject<HTMLDivElement | null>
  virtualizer: Virtualizer<HTMLDivElement, Element>
}

function getMessageSearchText(message: ChatMessage, cache: LRUCache<string, string>): string {
  if (message.role === 'user') return getUserMessageText(message.content, message.contexts)
  return getOrchestratorMessageTextSegments(message.contentBlocks ?? [], message.content)
    .map((content) => {
      const cached = cache.get(content)
      if (cached !== undefined) return cached
      const text = getChatFindText(
        parseSpecialTags(sanitizeChatDisplayContent(content), false)
          .segments.map((segment) =>
            segment.type === 'text' ? segment.content : segment.type === 'thinking' ? '' : '\uffff'
          )
          .join('')
      )
      cache.set(content, text)
      return text
    })
    .join('\uffff')
}

/** Finds text without rewriting React-owned message nodes or mounting the entire transcript. */
function findRanges(root: Element, query: string): Range[] {
  const nodes: { node: Text; start: number; offset: number; length: number }[] = []
  let text = ''
  let previousBlock: Element | null = null
  function visit(node: Node) {
    if (node instanceof Element) {
      if (node.matches('img, [data-chat-find-boundary]')) {
        text += '\uffff'
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
      const offset = node.previousSibling?.nodeName === 'BR' && node.data.startsWith('\n') ? 1 : 0
      if (nodes.length && block !== previousBlock) text += '\n'
      previousBlock = block
      nodes.push({ node, start: text.length, offset, length: node.length - offset })
      text += node.data.slice(offset)
      return
    }
    for (const child of node.childNodes) visit(child)
  }
  visit(root)
  const ranges: Range[] = []
  let nodeIndex = 0
  forEachSearchOccurrence(text, query, (start, end) => {
    if (ranges.length >= MATCH_LIMIT) return
    while (nodeIndex + 1 < nodes.length && nodes[nodeIndex + 1].start <= start) nodeIndex++
    const first = nodes[nodeIndex]
    let endIndex = nodeIndex
    while (endIndex + 1 < nodes.length && nodes[endIndex + 1].start < end) endIndex++
    const last = nodes[endIndex]
    if (!first || !last || start >= first.start + first.length || end > last.start + last.length)
      return
    const range = document.createRange()
    range.setStart(first.node, start - first.start + first.offset)
    range.setEnd(last.node, end - last.start + last.offset)
    ranges.push(range)
  })
  return ranges
}

export function useChatFind({
  chatId,
  messages,
  hiddenUserByIndex,
  containerRef,
  scrollElementRef,
  virtualizer,
}: UseChatFindProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const [textCache] = useState(
    () =>
      new LRUCache<string, string>({
        max: 10_000,
        maxSize: 8 * 1024 * 1024,
        sizeCalculation: (value, key) => Math.max(1, (value.length + key.length) * 2),
      })
  )
  const [scope, setScope] = useState(chatId)
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  /**
   * The active match by message and occurrence rather than position, so older messages
   * loading in ahead of it keep the same match active instead of shifting to another.
   */
  const [activeMatch, setActiveMatch] = useState<ChatFindMatchIdentity | null>(null)
  if (scope !== chatId) {
    setScope(chatId)
    // A pending chat adopting its id (undefined → id) is the same conversation.
    if (scope !== undefined) {
      setIsOpen(false)
      setQuery('')
      setActiveMatch(null)
    }
  }
  const deferredQuery = useDeferredValue(query)
  const term = isOpen ? deferredQuery.trim() : ''
  const result = useMemo(() => {
    const newestFirst: ChatFindMatch[][] = []
    let count = 0
    let truncated = false
    if (term) {
      for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
        const message = messages[messageIndex]
        if (!message || hiddenUserByIndex[messageIndex] || message.origin) continue
        const text = getMessageSearchText(message, textCache)
        const occurrences: ChatFindMatch[] = []
        let found = 0
        forEachSearchOccurrence(text, term, () => {
          if (count + found < MATCH_LIMIT) {
            occurrences.push({ messageIndex, messageId: message.id, occurrence: found })
          }
          found++
        })
        newestFirst.push(occurrences)
        count += occurrences.length
        if (occurrences.length < found) {
          truncated = true
          break
        }
      }
    }
    return { matches: newestFirst.reverse().flat(), truncated }
  }, [messages, hiddenUserByIndex, term, textCache])
  const pinnedIndex = activeMatch
    ? result.matches.findIndex(
        (match) =>
          match.messageId === activeMatch.messageId && match.occurrence === activeMatch.occurrence
      )
    : -1
  const currentIndex = Math.max(0, pinnedIndex)
  const active = result.matches[currentIndex]
  const messageIndex = active?.messageIndex
  const occurrence = active?.occurrence
  const isStale = query !== deferredQuery
  if (!isStale && active && pinnedIndex < 0) {
    setActiveMatch({ messageId: active.messageId, occurrence: active.occurrence })
  }
  /** Read by `step`, so stepping keeps one identity while a streaming reply rebuilds the matches. */
  const matchesRef = useRef(result.matches)
  useLayoutEffect(() => {
    matchesRef.current = result.matches
  }, [result.matches])

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
    else containerRef.current?.focus({ preventScroll: true })
  }, [containerRef])
  const close = useCallback(() => {
    setIsOpen(false)
    setQuery('')
    setActiveMatch(null)
    restoreFocus()
  }, [restoreFocus])
  useLayoutEffect(() => {
    if (restoreFocusRef.current && document.activeElement === document.body) restoreFocus()
    else restoreFocusRef.current = null
  }, [chatId, restoreFocus])
  const onQueryChange = useCallback((value: string) => {
    setQuery(value)
    setActiveMatch(null)
  }, [])
  const step = useCallback(
    (delta: number) => {
      const matches = matchesRef.current
      const target = matches[(currentIndex + delta + matches.length) % matches.length]
      if (target && !isStale) {
        setActiveMatch({ messageId: target.messageId, occurrence: target.occurrence })
      }
    },
    [currentIndex, isStale]
  )
  const next = useCallback(() => step(1), [step])
  const prev = useCallback(() => step(-1), [step])

  useEffect(() => {
    const scroller = scrollElementRef.current
    if (!scroller || !term || isStale || messageIndex === undefined) return
    virtualizer.scrollToIndex(messageIndex, { align: 'center' })
    let revealed = false
    let frame = 0
    const matches = typeof Highlight === 'undefined' ? null : new Highlight()
    const selected = typeof Highlight === 'undefined' ? null : new Highlight()
    if (matches && selected) {
      CSS.highlights.set('chat-find', matches)
      CSS.highlights.set('chat-find-active', selected)
    }
    const paint = () => {
      matches?.clear()
      selected?.clear()
      for (const row of scroller.querySelectorAll<HTMLElement>('[data-index]')) {
        const ranges = Array.from(row.querySelectorAll('[data-chat-find-content]'))
          .filter((root) => !root.closest(EXCLUDED_CONTENT))
          .flatMap((root) => findRanges(root, term))
        for (const range of ranges) matches?.add(range)
        if (Number(row.dataset.index) !== messageIndex) continue
        const range = ranges[occurrence ?? 0]
        if (!range) continue
        selected?.add(range)
        if (revealed) continue
        const rect = range.getBoundingClientRect()
        if (!rect.height) continue
        const bounds = scroller.getBoundingClientRect()
        scroller.scrollTop += rect.top - bounds.top - scroller.clientHeight / 2 + rect.height / 2
        revealed = true
      }
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(paint)
    }
    const observer = new MutationObserver(schedule)
    observer.observe(scroller, { childList: true, characterData: true, subtree: true })
    schedule()
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      if (CSS.highlights?.get('chat-find') === matches) CSS.highlights.delete('chat-find')
      if (CSS.highlights?.get('chat-find-active') === selected)
        CSS.highlights.delete('chat-find-active')
    }
  }, [term, isStale, messageIndex, occurrence, scrollElementRef, virtualizer])

  return {
    isOpen,
    query,
    currentIndex,
    count: result.matches.length,
    truncated: result.truncated,
    inputRef,
    onQueryChange,
    onKeyDown,
    next,
    prev,
    close,
    isStale,
  }
}
