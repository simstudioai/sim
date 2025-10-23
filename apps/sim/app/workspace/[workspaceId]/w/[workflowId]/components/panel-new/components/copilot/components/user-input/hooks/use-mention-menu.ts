import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@/lib/logs/console/logger'
import type { ChatContext } from '@/stores/panel-new/copilot/types'
import { MENTION_MENU_MARGINS } from '../constants'

const logger = createLogger('useMentionMenu')

interface UseMentionMenuProps {
  /** Current message text */
  message: string
  /** Currently selected contexts */
  selectedContexts: ChatContext[]
  /** Callback when a context is selected */
  onContextSelect: (context: ChatContext) => void
  /** Callback when message changes */
  onMessageChange: (message: string) => void
}

/**
 * Custom hook to manage mention menu state and navigation.
 * Handles showing/hiding the menu, tracking active items, and keyboard navigation.
 *
 * @param props - Configuration object
 * @returns Mention menu state and operations
 */
export function useMentionMenu({
  message,
  selectedContexts,
  onContextSelect,
  onMessageChange,
}: UseMentionMenuProps) {
  // Refs
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const mentionMenuRef = useRef<HTMLDivElement>(null)
  const mentionPortalRef = useRef<HTMLDivElement>(null)
  const submenuRef = useRef<HTMLDivElement>(null)
  const menuListRef = useRef<HTMLDivElement>(null)

  // State
  const [showMentionMenu, setShowMentionMenu] = useState(false)
  const [openSubmenuFor, setOpenSubmenuFor] = useState<string | null>(null)
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0)
  const [submenuActiveIndex, setSubmenuActiveIndex] = useState(0)
  const [submenuQueryStart, setSubmenuQueryStart] = useState<number | null>(null)
  const [inAggregated, setInAggregated] = useState(false)
  const [aggregatedActive, setAggregatedActive] = useState(false)
  const [mentionPortalStyle, setMentionPortalStyle] = useState<{
    top: number
    left: number
    width: number
    maxHeight: number
    showBelow: boolean
  } | null>(null)

  /**
   * Gets the current caret position in the textarea
   *
   * @returns Current caret position in the message
   */
  const getCaretPos = useCallback(() => {
    return textareaRef.current?.selectionStart ?? message.length
  }, [message.length])

  /**
   * Finds active mention query at the given position
   *
   * @param pos - Position in the text to check
   * @param textOverride - Optional text override (for checking during input)
   * @returns Active mention query object or null if no active mention
   */
  const getActiveMentionQueryAtPosition = useCallback(
    (pos: number, textOverride?: string) => {
      const text = textOverride ?? message
      const before = text.slice(0, pos)
      const atIndex = before.lastIndexOf('@')
      if (atIndex === -1) return null

      // Ensure '@' starts a token (start or whitespace before)
      if (atIndex > 0 && !/\s/.test(before.charAt(atIndex - 1))) return null

      // Check if this '@' falls inside an existing mention token
      if (selectedContexts.length > 0) {
        const labels = selectedContexts.map((c) => c.label).filter(Boolean) as string[]
        for (const label of labels) {
          const token = `@${label}`
          let fromIndex = 0
          while (fromIndex <= text.length) {
            const idx = text.indexOf(token, fromIndex)
            if (idx === -1) break
            const end = idx + token.length
            if (atIndex >= idx && atIndex < end) {
              return null
            }
            fromIndex = end
          }
        }
      }

      const segment = before.slice(atIndex + 1)
      // Close the popup if user types space immediately after @
      if (segment.length > 0 && /^\s/.test(segment)) {
        return null
      }

      return { query: segment, start: atIndex, end: pos }
    },
    [message, selectedContexts]
  )

  /**
   * Gets the submenu query text
   *
   * @returns Text typed after entering a submenu
   */
  const getSubmenuQuery = useCallback(() => {
    const pos = getCaretPos()
    if (submenuQueryStart == null) return ''
    return message.slice(submenuQueryStart, pos)
  }, [getCaretPos, message, submenuQueryStart])

  /**
   * Resets active mention query keeping only the '@'
   */
  const resetActiveMentionQuery = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    const pos = textarea.selectionStart ?? message.length
    const active = getActiveMentionQueryAtPosition(pos)
    if (!active) return

    const before = message.slice(0, active.start + 1)
    const after = message.slice(active.end)
    const next = `${before}${after}`
    onMessageChange(next)

    requestAnimationFrame(() => {
      const caretPos = before.length
      textarea.setSelectionRange(caretPos, caretPos)
      textarea.focus()
    })
  }, [message, getActiveMentionQueryAtPosition, onMessageChange])

  /**
   * Inserts text at the current cursor position
   *
   * @param text - Text to insert (e.g., "@Docs ")
   */
  const insertAtCursor = useCallback(
    (text: string) => {
      const textarea = textareaRef.current
      if (!textarea) return
      const start = textarea.selectionStart ?? message.length
      const end = textarea.selectionEnd ?? message.length
      let before = message.slice(0, start)
      const after = message.slice(end)
      // Avoid duplicate '@' if user typed trigger
      if (before.endsWith('@') && text.startsWith('@')) {
        before = before.slice(0, -1)
      }
      const next = `${before}${text}${after}`
      onMessageChange(next)
      // Move cursor to after inserted text
      setTimeout(() => {
        const pos = before.length + text.length
        textarea.setSelectionRange(pos, pos)
        textarea.focus()
      }, 0)
    },
    [message, onMessageChange]
  )

  /**
   * Replaces active mention with a label
   *
   * @param label - Label to replace the mention with
   * @returns True if replacement was successful, false if no active mention found
   */
  const replaceActiveMentionWith = useCallback(
    (label: string) => {
      const textarea = textareaRef.current
      if (!textarea) return false
      const pos = textarea.selectionStart ?? message.length
      const active = getActiveMentionQueryAtPosition(pos)
      if (!active) return false

      const before = message.slice(0, active.start)
      const after = message.slice(active.end)
      const insertion = `@${label} `
      const next = `${before}${insertion}${after}`.replace(/\s{2,}/g, ' ')
      onMessageChange(next)

      requestAnimationFrame(() => {
        const cursorPos = before.length + insertion.length
        textarea.setSelectionRange(cursorPos, cursorPos)
        textarea.focus()
      })
      return true
    },
    [message, getActiveMentionQueryAtPosition, onMessageChange]
  )

  /**
   * Scrolls active item into view in the menu
   *
   * @param index - Index of the item to scroll into view
   */
  const scrollActiveItemIntoView = useCallback((index: number) => {
    const container = menuListRef.current
    if (!container) return
    const item = container.querySelector(`[data-idx="${index}"]`) as HTMLElement | null
    if (!item) return

    const tolerance = MENTION_MENU_MARGINS.SCROLL_TOLERANCE
    const itemTop = item.offsetTop
    const itemBottom = itemTop + item.offsetHeight
    const viewTop = container.scrollTop
    const viewBottom = viewTop + container.clientHeight
    const needsScrollUp = itemTop < viewTop + tolerance
    const needsScrollDown = itemBottom > viewBottom - tolerance

    if (needsScrollUp || needsScrollDown) {
      if (needsScrollUp) {
        container.scrollTop = Math.max(0, itemTop - tolerance)
      } else {
        container.scrollTop = itemBottom + tolerance - container.clientHeight
      }
    }
  }, [])

  /**
   * Closes mention menu
   */
  const closeMentionMenu = useCallback(() => {
    setShowMentionMenu(false)
    setOpenSubmenuFor(null)
    setSubmenuQueryStart(null)
    setMentionActiveIndex(0)
    setSubmenuActiveIndex(0)
    setInAggregated(false)
  }, [])

  // Close mention menu on outside click
  useEffect(() => {
    if (!showMentionMenu) return

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node | null
      if (
        mentionMenuRef.current &&
        !mentionMenuRef.current.contains(target) &&
        (!mentionPortalRef.current || !mentionPortalRef.current.contains(target)) &&
        (!submenuRef.current || !submenuRef.current.contains(target)) &&
        textareaRef.current &&
        !textareaRef.current.contains(target as Node)
      ) {
        closeMentionMenu()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showMentionMenu, closeMentionMenu])

  return {
    // Refs
    textareaRef,
    mentionMenuRef,
    mentionPortalRef,
    submenuRef,
    menuListRef,

    // State
    showMentionMenu,
    openSubmenuFor,
    mentionActiveIndex,
    submenuActiveIndex,
    submenuQueryStart,
    inAggregated,
    aggregatedActive,
    mentionPortalStyle,

    // Setters
    setShowMentionMenu,
    setOpenSubmenuFor,
    setMentionActiveIndex,
    setSubmenuActiveIndex,
    setSubmenuQueryStart,
    setInAggregated,
    setAggregatedActive,
    setMentionPortalStyle,

    // Operations
    getCaretPos,
    getActiveMentionQueryAtPosition,
    getSubmenuQuery,
    resetActiveMentionQuery,
    insertAtCursor,
    replaceActiveMentionWith,
    scrollActiveItemIntoView,
    closeMentionMenu,
  }
}
