'use client'

import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react'

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
  /** Container ref for observing layout shifts */
  containerRef: HTMLDivElement | null
}

/**
 * Custom hook to auto-resize textarea and sync with overlay.
 * Uses ResizeObserver for accurate, event-driven synchronization without arbitrary timeouts.
 *
 * @param props - Configuration object
 * @returns Overlay ref for highlight rendering
 */
export function useTextareaAutoResize({
  message,
  panelWidth,
  selectedContexts,
  textareaRef,
  containerRef,
}: UseTextareaAutoResizeProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const containerResizeObserverRef = useRef<ResizeObserver | null>(null)
  const textareaResizeObserverRef = useRef<ResizeObserver | null>(null)

  /**
   * Syncs all styles and dimensions between textarea and overlay.
   * Called immediately when DOM changes are detected.
   */
  const syncOverlayStyles = useRef(() => {
    const textarea = textareaRef.current
    const overlay = overlayRef.current
    if (!textarea || !overlay || typeof window === 'undefined') return

    const styles = window.getComputedStyle(textarea)

    overlay.style.font = styles.font
    overlay.style.fontSize = styles.fontSize
    overlay.style.fontFamily = styles.fontFamily
    overlay.style.fontWeight = styles.fontWeight
    overlay.style.fontStyle = styles.fontStyle
    overlay.style.fontVariant = styles.fontVariant
    overlay.style.letterSpacing = styles.letterSpacing
    overlay.style.lineHeight = styles.lineHeight
    overlay.style.fontKerning = (styles as any).fontKerning ?? ''
    overlay.style.fontFeatureSettings = (styles as any).fontFeatureSettings ?? ''
    overlay.style.textRendering = (styles as any).textRendering ?? ''
    ;(overlay.style as any).tabSize = (styles as any).tabSize ?? ''
    ;(overlay.style as any).MozTabSize = (styles as any).MozTabSize ?? ''
    overlay.style.textTransform = styles.textTransform
    overlay.style.textIndent = styles.textIndent

    overlay.style.padding = styles.padding
    overlay.style.paddingTop = styles.paddingTop
    overlay.style.paddingRight = styles.paddingRight
    overlay.style.paddingBottom = styles.paddingBottom
    overlay.style.paddingLeft = styles.paddingLeft
    overlay.style.margin = styles.margin
    overlay.style.marginTop = styles.marginTop
    overlay.style.marginRight = styles.marginRight
    overlay.style.marginBottom = styles.marginBottom
    overlay.style.marginLeft = styles.marginLeft
    overlay.style.border = styles.border
    overlay.style.borderWidth = styles.borderWidth

    overlay.style.whiteSpace = styles.whiteSpace
    overlay.style.wordBreak = styles.wordBreak
    overlay.style.wordWrap = styles.wordWrap
    overlay.style.overflowWrap = styles.overflowWrap
    overlay.style.textAlign = styles.textAlign
    overlay.style.boxSizing = styles.boxSizing
    overlay.style.borderRadius = styles.borderRadius
    overlay.style.direction = styles.direction
    overlay.style.hyphens = (styles as any).hyphens ?? ''

    const textareaWidth = textarea.clientWidth
    const textareaHeight = textarea.clientHeight

    overlay.style.width = `${textareaWidth}px`
    overlay.style.height = `${textareaHeight}px`

    const computedMaxHeight = styles.maxHeight
    if (computedMaxHeight && computedMaxHeight !== 'none') {
      overlay.style.maxHeight = computedMaxHeight
    }

    overlay.scrollTop = textarea.scrollTop
    overlay.scrollLeft = textarea.scrollLeft
  })

  /**
   * Auto-resize textarea based on content.
   * Uses useLayoutEffect to run synchronously AFTER DOM mutations but BEFORE browser paint.
   * This ensures we sync after React commits changes to the DOM.
   */
  useLayoutEffect(() => {
    const textarea = textareaRef.current
    const overlay = overlayRef.current
    if (!textarea || !overlay) return

    const cursorPos = textarea.selectionStart ?? 0
    const isAtEnd = cursorPos === message.length
    const wasScrolledToBottom =
      textarea.scrollHeight - textarea.scrollTop - textarea.clientHeight < 5

    textarea.style.height = 'auto'
    overlay.style.height = 'auto'

    void textarea.offsetHeight
    void overlay.offsetHeight

    const scrollHeight = textarea.scrollHeight
    const nextHeight = Math.min(scrollHeight, MAX_TEXTAREA_HEIGHT)

    const heightString = `${nextHeight}px`
    const overflowString = scrollHeight > MAX_TEXTAREA_HEIGHT ? 'auto' : 'hidden'

    textarea.style.height = heightString
    textarea.style.overflowY = overflowString
    overlay.style.height = heightString
    overlay.style.overflowY = overflowString

    void textarea.offsetHeight
    void overlay.offsetHeight

    if ((isAtEnd || wasScrolledToBottom) && scrollHeight > nextHeight) {
      const scrollValue = scrollHeight
      textarea.scrollTop = scrollValue
      overlay.scrollTop = scrollValue
    } else {
      overlay.scrollTop = textarea.scrollTop
      overlay.scrollLeft = textarea.scrollLeft
    }

    syncOverlayStyles.current()
  }, [message, selectedContexts, textareaRef])

  /**
   * Sync scroll position between textarea and overlay
   */
  useEffect(() => {
    const textarea = textareaRef.current
    const overlay = overlayRef.current

    if (!textarea || !overlay) return

    const handleScroll = () => {
      overlay.scrollTop = textarea.scrollTop
      overlay.scrollLeft = textarea.scrollLeft
    }

    textarea.addEventListener('scroll', handleScroll, { passive: true })
    return () => textarea.removeEventListener('scroll', handleScroll)
  }, [textareaRef])

  /**
   * Setup ResizeObserver on the CONTAINER to catch layout shifts when pills wrap.
   * This is critical because when pills wrap, the textarea moves but doesn't resize.
   */
  useLayoutEffect(() => {
    const textarea = textareaRef.current
    const overlay = overlayRef.current
    if (!textarea || !overlay || !containerRef || typeof window === 'undefined') return

    syncOverlayStyles.current()

    if (typeof ResizeObserver !== 'undefined' && !containerResizeObserverRef.current) {
      containerResizeObserverRef.current = new ResizeObserver(() => {
        syncOverlayStyles.current()
      })
      containerResizeObserverRef.current.observe(containerRef)
    }

    if (typeof ResizeObserver !== 'undefined' && !textareaResizeObserverRef.current) {
      textareaResizeObserverRef.current = new ResizeObserver(() => {
        syncOverlayStyles.current()
      })
      textareaResizeObserverRef.current.observe(textarea)
    }

    const mutationObserver = new MutationObserver(() => {
      syncOverlayStyles.current()
    })
    mutationObserver.observe(textarea, {
      attributes: true,
      attributeFilter: ['style', 'class'],
    })

    const handleResize = () => syncOverlayStyles.current()
    window.addEventListener('resize', handleResize)

    return () => {
      mutationObserver.disconnect()
      window.removeEventListener('resize', handleResize)
    }
  }, [panelWidth, textareaRef, containerRef])

  /**
   * Cleanup ResizeObservers on unmount
   */
  useEffect(() => {
    return () => {
      if (containerResizeObserverRef.current) {
        containerResizeObserverRef.current.disconnect()
        containerResizeObserverRef.current = null
      }
      if (textareaResizeObserverRef.current) {
        textareaResizeObserverRef.current.disconnect()
        textareaResizeObserverRef.current = null
      }
    }
  }, [])

  return {
    overlayRef,
  }
}
