import { useRef } from 'react'

/**
 * `Modal` closes when a confirm settles. A dialog with steps, or whose work outlives the request it
 * started, calls `hold()` inside its confirm to stay open for that one settle. Dismissing and
 * Cancel still close it.
 */
export function useHeldModal(onClose: () => void) {
  const held = useRef(false)
  return {
    hold: () => {
      held.current = true
    },
    onOpenChange: (open: boolean) => {
      if (open) return
      if (held.current) held.current = false
      else onClose()
    },
  }
}
