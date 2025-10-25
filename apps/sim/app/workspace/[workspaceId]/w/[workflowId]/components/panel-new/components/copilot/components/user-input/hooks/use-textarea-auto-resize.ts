'use client'

import { type RefObject, useEffect, useRef } from 'react'

/**
 * Maximum textarea height in pixels
 */
const MAX_TEXTAREA_HEIGHT = 120

interface UseTextareaAutoResizeProps {
  /** Current message content */
  message: string
  /** Width of the panel */
  panelWidth: number
  /** Selected mention contexts */
  selectedContexts: any[]
  /** External textarea ref to sync with */
  textareaRef: RefObject<HTMLTextAreaElement | null>
}

/**
 * Custom hook to auto-resize textarea and sync with overlay
 * Manages textarea height based on content without using inline styles
 *
 * @param props - Configuration object
 * @returns Overlay ref for highlight rendering
 */
export function useTextareaAutoResize({
  message,
  panelWidth,
  selectedContexts,
  textareaRef,
}: UseTextareaAutoResizeProps) {
  const overlayRef = useRef<HTMLDivElement>(null)

  /**
   * Auto-resize textarea based on content
   */
  useEffect(() => {
    const textarea = textareaRef.current
    const overlay = overlayRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      const nextHeight = Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT)
      textarea.style.height = `${nextHeight}px`
      textarea.style.overflowY = textarea.scrollHeight > MAX_TEXTAREA_HEIGHT ? 'auto' : 'hidden'

      if (overlay) {
        overlay.style.height = `${nextHeight}px`
        overlay.style.overflowY = textarea.scrollHeight > MAX_TEXTAREA_HEIGHT ? 'auto' : 'hidden'
      }
    }
  }, [message])

  /**
   * Sync scroll position between textarea and overlay
   */
  useEffect(() => {
    const textarea = textareaRef.current
    const overlay = overlayRef.current

    if (!textarea || !overlay) return

    const handleScroll = () => {
      overlay.scrollTop = textarea.scrollTop
    }

    textarea.addEventListener('scroll', handleScroll)
    return () => textarea.removeEventListener('scroll', handleScroll)
  }, [])

  /**
   * Sync overlay styles with textarea computed styles
   */
  useEffect(() => {
    const textarea = textareaRef.current
    const overlay = overlayRef.current
    if (!textarea || !overlay || typeof window === 'undefined') return

    const syncOverlayStyles = () => {
      const styles = window.getComputedStyle(textarea)
      overlay.style.font = styles.font
      overlay.style.letterSpacing = styles.letterSpacing
      overlay.style.padding = styles.padding
      overlay.style.lineHeight = styles.lineHeight
      overlay.style.color = styles.color
      overlay.style.whiteSpace = styles.whiteSpace
      overlay.style.wordBreak = styles.wordBreak
      overlay.style.width = `${textarea.clientWidth}px`
      overlay.style.height = `${textarea.clientHeight}px`
      overlay.style.borderRadius = styles.borderRadius
    }

    syncOverlayStyles()

    let resizeObserver: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => syncOverlayStyles())
      resizeObserver.observe(textarea)
    }
    window.addEventListener('resize', syncOverlayStyles)

    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', syncOverlayStyles)
    }
  }, [panelWidth, message, selectedContexts])

  return {
    overlayRef,
  }
}
