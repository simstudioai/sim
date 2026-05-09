/**
 * Bind browser pinch/ctrl-wheel zoom and horizontal wheel gestures for preview scroll containers.
 */
export function bindPreviewWheelZoom(
  container: HTMLElement,
  onZoom: (event: WheelEvent) => void
): () => void {
  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey) {
      event.preventDefault()
      onZoom(event)
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
