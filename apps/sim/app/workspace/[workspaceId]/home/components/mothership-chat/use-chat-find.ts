'use client'

import {
  type RefObject,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { forEachSearchOccurrence } from '@sim/utils/string'
import type { Virtualizer } from '@tanstack/react-virtual'
import { useFindShortcut } from '@/app/workspace/[workspaceId]/components/find-bar'
import { getOrchestratorMessageTextSegments } from '@/app/workspace/[workspaceId]/home/components/message-content'
import { sanitizeChatDisplayContent } from '@/app/workspace/[workspaceId]/home/components/message-content/components/chat-content/chat-sanitize'
import { parseSpecialTags } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'
import { getChatFindText } from '@/app/workspace/[workspaceId]/home/components/mothership-chat/chat-find-text'
import { getUserMessageText } from '@/app/workspace/[workspaceId]/home/components/user-message-content/utils'
import type { ChatMessage } from '@/app/workspace/[workspaceId]/home/types'

const MATCH_LIMIT = 500
const EXCLUDED_CONTENT =
  'button, [aria-hidden="true"], [data-agent-group], [data-chat-activity], [data-interaction-card], [data-chat-find-ignore]'
const TEXT_BLOCK = 'p, h1, h2, h3, h4, h5, h6, pre, li, td, th'

interface UseChatFindProps {
  chatId?: string
  messages: ChatMessage[]
  hiddenUserByIndex: Array<boolean | undefined>
  containerRef: RefObject<HTMLDivElement | null>
  scrollElementRef: RefObject<HTMLDivElement | null>
  virtualizer: Virtualizer<HTMLDivElement, Element>
  detachAutoScroll: () => void
}

function getMessageSearchText(message: ChatMessage): string {
  if (message.role === 'user') return getUserMessageText(message.content, message.contexts)
  return getOrchestratorMessageTextSegments(message.contentBlocks ?? [], message.content)
    .map((content) =>
      getChatFindText(
        parseSpecialTags(sanitizeChatDisplayContent(content), false)
          .segments.map((segment) =>
            segment.type === 'text' ? segment.content : segment.type === 'thinking' ? '' : '\uffff'
          )
          .join('')
      )
    )
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
  detachAutoScroll,
}: UseChatFindProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const [scope, setScope] = useState(chatId)
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  if (scope !== chatId) {
    setScope(chatId)
    setIsOpen(false)
    setQuery('')
    setIndex(0)
  }
  const deferredQuery = useDeferredValue(query)
  const term = isOpen ? deferredQuery.trim() : ''
  const result = useMemo(() => {
    const matches: { messageIndex: number; occurrence: number }[] = []
    let truncated = false
    if (term) {
      for (const [messageIndex, message] of messages.entries()) {
        if (hiddenUserByIndex[messageIndex] || message.origin === 'task') continue
        const text = getMessageSearchText(message)
        let occurrence = 0
        forEachSearchOccurrence(text, term, () => {
          if (matches.length < MATCH_LIMIT) matches.push({ messageIndex, occurrence: occurrence++ })
          else truncated = true
        })
        if (truncated) break
      }
    }
    return { matches, truncated }
  }, [messages, hiddenUserByIndex, term])
  const currentIndex = Math.min(index, Math.max(0, result.matches.length - 1))
  const active = result.matches[currentIndex]
  const messageIndex = active?.messageIndex
  const occurrence = active?.occurrence
  const isStale = query !== deferredQuery

  const open = useCallback(() => {
    if (document.activeElement instanceof HTMLElement && !inputRef.current) {
      restoreFocusRef.current = document.activeElement
    }
    setIsOpen(true)
  }, [])
  useFindShortcut({ enabled: true, inputRef, containerRef, onOpen: open })

  const close = useCallback(() => {
    setIsOpen(false)
    setQuery('')
    setIndex(0)
    const target = restoreFocusRef.current
    if (target?.isConnected) target.focus({ preventScroll: true })
    else containerRef.current?.focus({ preventScroll: true })
  }, [containerRef])
  const onQueryChange = useCallback((value: string) => {
    setQuery(value)
    setIndex(0)
  }, [])
  const step = useCallback(
    (delta: number) => {
      if (result.matches.length && !isStale)
        setIndex((currentIndex + delta + result.matches.length) % result.matches.length)
    },
    [currentIndex, result.matches.length, isStale]
  )
  const next = useCallback(() => step(1), [step])
  const prev = useCallback(() => step(-1), [step])

  useEffect(() => {
    const scroller = scrollElementRef.current
    if (!scroller || !term || isStale || messageIndex === undefined) return
    detachAutoScroll()
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
  }, [term, isStale, messageIndex, occurrence, scrollElementRef, virtualizer, detachAutoScroll])

  return {
    isOpen,
    query,
    currentIndex,
    count: result.matches.length,
    truncated: result.truncated,
    inputRef,
    onQueryChange,
    next,
    prev,
    close,
    isStale,
  }
}
