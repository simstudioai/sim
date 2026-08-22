interface BindPreviewWheelZoomOptions {
  /**
   * Called for non-modifier wheel events (two-finger scroll). When provided,
   * the container's native scrolling is suppressed and the consumer drives
   * pan via `deltaX` / `deltaY`. Use for transform-based viewers (e.g. image)
   * where the content is not a real scroll container.
   */
  onPan?: (event: WheelEvent) => void
}

/**
 * Horizontal component of a wheel gesture: a trackpad's own `deltaX`, or `deltaY`
 * while Shift is held — the only horizontal gesture available on a mouse whose
 * wheel reports `deltaY` alone.
 */
function horizontalDeltaOf(event: WheelEvent): number {
  return event.deltaX !== 0 ? event.deltaX : event.shiftKey ? event.deltaY : 0
}

/**
 * Vertical component still owed to the container once the horizontal one is taken.
 * Shift *remaps* `deltaY` onto the horizontal axis, so that gesture has no vertical
 * component left to spend; an ordinary diagonal trackpad pan does.
 */
function verticalDeltaOf(event: WheelEvent): number {
  return event.deltaX !== 0 ? event.deltaY : 0
}

/**
 * Rough pixel height of one wheel "line". A wheel delta is only in pixels when `deltaMode`
 * says so — Firefox reports mouse wheels in lines — while scroll offsets are always pixels,
 * so a three-line notch added raw would move the table three pixels.
 */
const WHEEL_LINE_HEIGHT_PX = 16

/** Convert a wheel delta to pixels. `pageSize` is the container extent along that axis. */
function toPixels(delta: number, event: WheelEvent, pageSize: number): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return delta * WHEEL_LINE_HEIGHT_PX
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return delta * pageSize
  return delta
}

/**
 * Scroll `container` for a wheel gesture carrying a horizontal component. No-op when the
 * gesture is purely vertical or the container has nothing to scroll sideways, leaving the
 * event to scroll natively.
 *
 * Cancelling a wheel event is all-or-nothing, so once `preventDefault` is called this owes
 * the container *both* axes — a diagonal pan that only had its `deltaX` applied would lose
 * its vertical movement entirely.
 */
function applyHorizontalWheel(container: HTMLElement, event: WheelEvent): void {
  const horizontalDelta = horizontalDeltaOf(event)
  if (horizontalDelta === 0 || container.scrollWidth <= container.clientWidth) return

  event.preventDefault()
  container.scrollLeft += toPixels(horizontalDelta, event, container.clientWidth)
  container.scrollTop += toPixels(verticalDeltaOf(event), event, container.clientHeight)
}

/**
 * Bind horizontal wheel gestures for a preview scroll container that has no zoom of its
 * own — the tabular CSV/XLSX previews, whose table is wider than its frame. A mouse whose
 * wheel reports only `deltaY` otherwise has no way to reach that overflow short of dragging
 * the scrollbar. Unlike {@link bindPreviewWheelZoom} this leaves `ctrl`/`cmd`+wheel alone,
 * so browser page zoom still works over a table.
 */
export function bindPreviewHorizontalWheel(container: HTMLElement): () => void {
  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) return
    applyHorizontalWheel(container, event)
  }

  container.addEventListener('wheel', onWheel, { capture: true, passive: false })
  return () => container.removeEventListener('wheel', onWheel, { capture: true })
}

/**
 * Bind browser pinch/ctrl-wheel zoom and horizontal wheel gestures for preview
 * scroll containers. Trackpad pinch fires `wheel` with `ctrlKey=true`; without
 * a non-passive native listener the browser falls back to page zoom. `metaKey`
 * is also accepted so Cmd+scroll zooms on macOS, matching Figma/tldraw/Excalidraw.
 */
export function bindPreviewWheelZoom(
  container: HTMLElement,
  onZoom: (event: WheelEvent) => void,
  options: BindPreviewWheelZoomOptions = {}
): () => void {
  const { onPan } = options

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
