import { type RefObject, useEffect } from 'react'

interface UseChatInputFocusProps {
  textareaRef: RefObject<HTMLTextAreaElement | null>
}

/** Focuses a newly opened chat without interrupting typing elsewhere or an inactive window. */
export function useChatInputFocus({ textareaRef }: UseChatInputFocusProps) {
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (!document.hasFocus()) return
      const active = document.activeElement
      if (
        active instanceof HTMLElement &&
        (['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) || active.isContentEditable)
      ) {
        return
      }
      textareaRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [textareaRef])
}
