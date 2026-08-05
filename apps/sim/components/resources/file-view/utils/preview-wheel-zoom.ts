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

    const horizontalDelta = event.deltaX !== 0 ? event.deltaX : event.shiftKey ? event.deltaY : 0
    if (horizontalDelta === 0 || container.scrollWidth <= container.clientWidth) return

    event.preventDefault()
    container.scrollLeft += horizontalDelta
  }

  container.addEventListener('wheel', onWheel, { capture: true, passive: false })
  return () => container.removeEventListener('wheel', onWheel, { capture: true })
}
