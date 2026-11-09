/**
 * Wheel gestures for preview scroll areas: Ctrl/Cmd+wheel and trackpad pinch zoom the preview
 * instead of the page, and a mouse wheel with Shift reaches a table's horizontal overflow.
 */

const WHEEL_LINE_HEIGHT_PX = 16

function horizontalDeltaOf(event: WheelEvent): number {
  return event.deltaX !== 0 ? event.deltaX : event.shiftKey ? event.deltaY : 0
}

/** Shift remaps `deltaY` onto the horizontal axis, leaving that gesture no vertical part. */
function verticalDeltaOf(event: WheelEvent): number {
  return event.deltaX !== 0 ? event.deltaY : 0
}

/** A wheel delta in pixels: Firefox reports mouse wheels in lines. */
function toPixels(delta: number, event: WheelEvent, pageSize: number): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return delta * WHEEL_LINE_HEIGHT_PX
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return delta * pageSize
  return delta
}

/** Cancelling a wheel event is all or nothing, so this then owes the container both axes. */
function applyHorizontalWheel(container: HTMLElement, event: WheelEvent): void {
  const horizontalDelta = horizontalDeltaOf(event)
  if (horizontalDelta === 0 || container.scrollWidth <= container.clientWidth) return
  event.preventDefault()
  container.scrollLeft += toPixels(horizontalDelta, event, container.clientWidth)
  container.scrollTop += toPixels(verticalDeltaOf(event), event, container.clientHeight)
}

/** Horizontal wheel scrolling for a wide table, leaving Ctrl/Cmd+wheel to the browser. */
export function bindHorizontalWheel(container: HTMLElement): () => void {
  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) return
    applyHorizontalWheel(container, event)
  }
  container.addEventListener('wheel', onWheel, { capture: true, passive: false })
  return () => container.removeEventListener('wheel', onWheel, { capture: true })
}

/**
 * Pinch and Ctrl/Cmd+wheel zoom. With `onPan`, a plain two-finger scroll pans a transformed view
 * instead of scrolling; otherwise it scrolls natively, sideways included.
 */
export function bindWheelZoom(
  container: HTMLElement,
  onZoom: (event: WheelEvent) => void,
  onPan?: (event: WheelEvent) => void
): () => void {
  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault()
      onZoom(event)
      return
    }
    if (onPan) {
      event.preventDefault()
      onPan(event)
      return
    }
    applyHorizontalWheel(container, event)
  }
  container.addEventListener('wheel', onWheel, { capture: true, passive: false })
  return () => container.removeEventListener('wheel', onWheel, { capture: true })
}
