import type { MouseEvent } from 'react'

/** Anchors pointer-less activations to the control that opened the menu. */
export function getContextMenuPosition(event: MouseEvent) {
  if (event.clientX !== 0 || event.clientY !== 0) {
    return { x: event.clientX, y: event.clientY }
  }
  const bounds = event.currentTarget.getBoundingClientRect()
  return { x: bounds.left, y: bounds.bottom }
}
