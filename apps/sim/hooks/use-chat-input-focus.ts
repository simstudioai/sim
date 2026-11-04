import { createContext, type RefObject, useContext, useEffect, useImperativeHandle } from 'react'
import { isMobileViewport } from '@/hooks/use-is-mobile'

/** Requests textarea focus without interrupting dialogs and reports whether that textarea is active. */
export interface ChatInputFocusHandle {
  focus: () => void
  isFocused: () => boolean
}

export const ChatInputFocusContext = createContext<RefObject<ChatInputFocusHandle | null> | null>(
  null
)

interface UseChatInputFocusProps {
  textareaRef: RefObject<HTMLTextAreaElement | null>
}

/** Focuses a newly opened chat without interrupting typing elsewhere or an inactive window. */
export function useChatInputFocus({ textareaRef }: UseChatInputFocusProps) {
  const requestedFocus = useContext(ChatInputFocusContext)
  useImperativeHandle(
    requestedFocus,
    () => ({
      focus: () => {
        if (!document.querySelector('[role="dialog"], dialog[open]')) textareaRef.current?.focus()
      },
      isFocused: () =>
        textareaRef.current !== null && document.activeElement === textareaRef.current,
    }),
    [textareaRef]
  )
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (isMobileViewport() || !document.hasFocus()) return
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
