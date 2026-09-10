interface ScreenPoint {
  x: number
  y: number
}

interface PlanePoint {
  x: number
  z: number
}

/** The slab outline winds clockwise from above; its outward normal must face the camera. */
export function isFrontFacingEdge(start: PlanePoint, end: PlanePoint, towardCamera: PlanePoint) {
  return -(end.z - start.z) * towardCamera.x + (end.x - start.x) * towardCamera.z > 0
}

interface LayerEdgeHit {
  index: number
  distance: number
}

/** Measure in screen pixels so narrow plane edges remain equally reachable at every size. */
export function distanceToSegment(point: ScreenPoint, start: ScreenPoint, end: ScreenPoint) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared
    ? Math.max(
        0,
        Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)
      )
    : 0
  return Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy)
}

/** Use the same forgiving edge bands in both directions, with a small spatial deadband. */
export function pickLayerEdge(hits: LayerEdgeHit[], active: number | null) {
  const nearest = hits.reduce<LayerEdgeHit | null>(
    (best, hit) => (hit.distance <= 14 && (!best || hit.distance < best.distance) ? hit : best),
    null
  )
  if (!nearest) return null
  const current = hits.find((hit) => hit.index === active)
  if (current && current.distance <= 14 && current.distance <= nearest.distance + 1.5) {
    return current.index
  }
  return nearest.index
}
