import { type RefObject, useCallback, useEffect, useLayoutEffect } from 'react'

interface UseAutoSizeTextareaProps {
  textareaRef: RefObject<HTMLTextAreaElement | null>
  scrollerRef: RefObject<HTMLDivElement | null>
  value: string
  maxHeight?: number
}

/** Grows chat and Search drafts without moving the transcript during measurement. */
export function useAutoSizeTextarea({
  textareaRef,
  scrollerRef,
  value,
  maxHeight,
}: UseAutoSizeTextareaProps) {
  /**
   * Autosize: grow the textarea to its full content height; the scroller caps
   * the visible height and scrolls textarea + overlay together natively. The
   * scroller's box is locked while the textarea collapses to `auto` for
   * measurement — the scrollHeight read forces a layout at the collapsed
   * height, and without the lock that transient layout grows the chat scroll
   * container, letting the browser clamp a bottom-pinned transcript upward by
   * the input's grown height on every multi-line edit.
   */
  const autosize = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    const scroller = scrollerRef.current
    if (scroller) scroller.style.height = `${scroller.offsetHeight}px`
    textarea.style.height = 'auto'
    textarea.style.height = `${maxHeight === undefined ? textarea.scrollHeight : Math.min(textarea.scrollHeight, maxHeight)}px`
    textarea.style.overflowY = maxHeight === undefined ? 'hidden' : 'auto'
    if (scroller) scroller.style.height = ''
  }, [textareaRef, scrollerRef, maxHeight])

  useLayoutEffect(() => {
    autosize()
  }, [value, autosize])

  /**
   * The textarea carries an inline pixel height, so a width change (window
   * resize, sidebar toggle, chat column reflow) rewraps the text taller while
   * the box stays at its old height. The mirror overlay paints the full text
   * regardless, so the spilled lines render over the scroller with no textarea
   * beneath them — visible, scrollable text that swallows clicks instead of
   * placing the caret.
   *
   * Only width is compared: `autosize` writes the textarea's height, which
   * re-notifies this observer, so reacting to height would feed itself. The
   * first delivery is measured like any other — the width can change between
   * the mount-time measure and `observe()`.
   */
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    let lastWidth: number | null = null
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width
      if (width === lastWidth) return
      lastWidth = width
      autosize()
    })
    observer.observe(textarea)
    return () => observer.disconnect()
  }, [autosize, textareaRef])
}
