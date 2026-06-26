import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'

/** The imperative `onKeyDown` every suggestion list forwards from the popup. */
export interface SuggestionKeyDownHandler {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

interface SuggestionKeyboard extends SuggestionKeyDownHandler {
  activeIndex: number
  setActiveIndex: Dispatch<SetStateAction<number>>
}

/**
 * Shared arrow/enter/tab navigation for the `/` and `@` suggestion lists. Owns the active-row state,
 * resets it when the items change, scrolls the active row into view, and exposes an `onKeyDown` handle
 * for the suggestion plugin. Up/Down wrap; Enter and Tab both accept the active item (Tab matches the
 * chat composer). The handle is stable and reads live values through a ref, because the suggestion
 * plugin captures it once via `ReactRenderer.ref` while the items may still be loading.
 */
export function useSuggestionKeyboard<T>(
  items: T[],
  onSelect: (item: T) => void,
  containerRef: RefObject<HTMLElement | null>
): SuggestionKeyboard {
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    setActiveIndex(0)
  }, [items])

  useEffect(() => {
    containerRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, containerRef])

  const latest = useRef({ items, activeIndex, onSelect })
  latest.current = { items, activeIndex, onSelect }

  const onKeyDown = useCallback(({ event }: { event: KeyboardEvent }) => {
    const { items, activeIndex, onSelect } = latest.current
    if (items.length === 0) return false
    if (event.key === 'ArrowUp') {
      setActiveIndex((i) => (i + items.length - 1) % items.length)
      return true
    }
    if (event.key === 'ArrowDown') {
      setActiveIndex((i) => (i + 1) % items.length)
      return true
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      // Clamp in case a filter shrank the list this frame before the active-index reset committed.
      const item = items[Math.min(activeIndex, items.length - 1)]
      if (!item) return false
      onSelect(item)
      return true
    }
    return false
  }, [])

  return { activeIndex, setActiveIndex, onKeyDown }
}
