import type { KeyboardEvent } from 'react'

/** What a key asks of a focused resize separator: move it left or right, or jump to a bound. */
export type SeparatorKey = 'left' | 'right' | 'min' | 'max'

/**
 * Reads a plain key press on a focused `role='separator'` resize handle. Arrows are the visual
 * direction the divider moves in; Home and End are the controlled pane's minimum and maximum
 * size. Null for modified or IME-composing presses and every other key.
 */
export function readSeparatorKey(event: KeyboardEvent): SeparatorKey | null {
  if (
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.nativeEvent.isComposing ||
    event.keyCode === 229
  ) {
    return null
  }
  switch (event.key) {
    case 'ArrowLeft':
      return 'left'
    case 'ArrowRight':
      return 'right'
    case 'Home':
      return 'min'
    case 'End':
      return 'max'
    default:
      return null
  }
}
