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

    // Copy all text rendering properties exactly (but NOT color - overlay needs visible text)
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

    // Copy box model properties exactly to ensure identical text flow
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

    // Copy text wrapping and breaking properties
    overlay.style.whiteSpace = styles.whiteSpace
    overlay.style.wordBreak = styles.wordBreak
    overlay.style.wordWrap = styles.wordWrap
    overlay.style.overflowWrap = styles.overflowWrap
    overlay.style.textAlign = styles.textAlign
    overlay.style.boxSizing = styles.boxSizing
    overlay.style.borderRadius = styles.borderRadius
    overlay.style.direction = styles.direction
    overlay.style.hyphens = (styles as any).hyphens ?? ''

    // Critical: Match dimensions exactly
    const textareaWidth = textarea.clientWidth
    const textareaHeight = textarea.clientHeight

    overlay.style.width = `${textareaWidth}px`
    overlay.style.height = `${textareaHeight}px`

    // Match max-height behavior
    const computedMaxHeight = styles.maxHeight
    if (computedMaxHeight && computedMaxHeight !== 'none') {
      overlay.style.maxHeight = computedMaxHeight
    }

    // Ensure scroll positions are perfectly synced
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

    // Store current cursor position to determine if user is typing at the end
    const cursorPos = textarea.selectionStart ?? 0
    const isAtEnd = cursorPos === message.length
    const wasScrolledToBottom =
      textarea.scrollHeight - textarea.scrollTop - textarea.clientHeight < 5

    // Reset height to auto to get proper scrollHeight
    textarea.style.height = 'auto'
    overlay.style.height = 'auto'

    // Force a reflow to ensure accurate scrollHeight
    void textarea.offsetHeight
    void overlay.offsetHeight

    // Get the scroll height (this includes all content, including trailing newlines)
    const scrollHeight = textarea.scrollHeight
    const nextHeight = Math.min(scrollHeight, MAX_TEXTAREA_HEIGHT)

    // Apply height to BOTH elements simultaneously
    const heightString = `${nextHeight}px`
    const overflowString = scrollHeight > MAX_TEXTAREA_HEIGHT ? 'auto' : 'hidden'

    textarea.style.height = heightString
    textarea.style.overflowY = overflowString
    overlay.style.height = heightString
    overlay.style.overflowY = overflowString

    // Force another reflow after height change
    void textarea.offsetHeight
    void overlay.offsetHeight

    // Maintain scroll behavior: if user was at bottom or typing at end, keep them at bottom
    if ((isAtEnd || wasScrolledToBottom) && scrollHeight > nextHeight) {
      const scrollValue = scrollHeight
      textarea.scrollTop = scrollValue
      overlay.scrollTop = scrollValue
    } else {
      // Otherwise, sync scroll positions
      overlay.scrollTop = textarea.scrollTop
      overlay.scrollLeft = textarea.scrollLeft
    }

    // Sync all other styles after height change
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

    // Initial sync
    syncOverlayStyles.current()

    // Observe the CONTAINER - when pills wrap, container height changes
    if (typeof ResizeObserver !== 'undefined' && !containerResizeObserverRef.current) {
      containerResizeObserverRef.current = new ResizeObserver(() => {
        // Container size changed (pills wrapped) - sync immediately
        syncOverlayStyles.current()
      })
      containerResizeObserverRef.current.observe(containerRef)
    }

    // ALSO observe the textarea for its own size changes
    if (typeof ResizeObserver !== 'undefined' && !textareaResizeObserverRef.current) {
      textareaResizeObserverRef.current = new ResizeObserver(() => {
        syncOverlayStyles.current()
      })
      textareaResizeObserverRef.current.observe(textarea)
    }

    // Setup MutationObserver to detect style changes
    const mutationObserver = new MutationObserver(() => {
      syncOverlayStyles.current()
    })
    mutationObserver.observe(textarea, {
      attributes: true,
      attributeFilter: ['style', 'class'],
    })

    // Listen to window resize events (for browser window resizing)
    const handleResize = () => syncOverlayStyles.current()
    window.addEventListener('resize', handleResize)

    // Cleanup
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
