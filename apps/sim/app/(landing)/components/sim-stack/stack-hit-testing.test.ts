/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  distanceToSegment,
  isFrontFacingEdge,
  pickLayerEdge,
} from '@/app/(landing)/components/sim-stack/stack-hit-testing'

describe('stack edge targets', () => {
  const bands = (y: number) =>
    Array.from({ length: 6 }, (_, index) => ({ index, distance: Math.abs(y - (100 - index * 20)) }))

  it('selects every layer immediately in either direction', () => {
    let active: number | null = null
    for (const index of [5, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5]) {
      active = pickLayerEdge(bands(100 - index * 20), active)
      expect(active).toBe(index)
    }
  })

  it('keeps the current selection through small boundary jitter in both directions', () => {
    expect(pickLayerEdge(bands(90), 0)).toBe(0)
    expect(pickLayerEdge(bands(89.5), 0)).toBe(0)
    expect(pickLayerEdge(bands(88), 0)).toBe(1)
    expect(pickLayerEdge(bands(90.5), 1)).toBe(1)
    expect(pickLayerEdge(bands(92), 1)).toBe(0)
  })

  it('accepts nearby cursor positions but releases outside the edge band', () => {
    expect(pickLayerEdge(bands(113), null)).toBe(0)
    expect(pickLayerEdge(bands(115), 0)).toBeNull()
  })

  it('measures diagonal edges and clamps at their endpoints', () => {
    expect(distanceToSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 10 })).toBe(0)
    expect(distanceToSegment({ x: 13, y: 14 }, { x: 0, y: 0 }, { x: 10, y: 10 })).toBe(5)
    expect(distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5)
  })
})

describe('front-facing stack edges', () => {
  const view = { x: 10, z: 13 }

  it('accepts the front and right rims and rejects the rear and left rims', () => {
    expect(isFrontFacingEdge({ x: -2, z: 2 }, { x: 2, z: 2 }, view)).toBe(true)
    expect(isFrontFacingEdge({ x: 2, z: 2 }, { x: 2, z: -2 }, view)).toBe(true)
    expect(isFrontFacingEdge({ x: 2, z: -2 }, { x: -2, z: -2 }, view)).toBe(false)
    expect(isFrontFacingEdge({ x: -2, z: -2 }, { x: -2, z: 2 }, view)).toBe(false)
  })

  it('follows camera rotation and excludes edge-on or degenerate segments', () => {
    expect(isFrontFacingEdge({ x: 2, z: 2 }, { x: 2, z: -2 }, { x: -10, z: 13 })).toBe(false)
    expect(isFrontFacingEdge({ x: -2, z: -2 }, { x: -2, z: 2 }, { x: -10, z: 13 })).toBe(true)
    expect(isFrontFacingEdge({ x: 0, z: 0 }, { x: 10, z: 13 }, view)).toBe(false)
    expect(isFrontFacingEdge({ x: 1, z: 1 }, { x: 1, z: 1 }, view)).toBe(false)
  })
})
