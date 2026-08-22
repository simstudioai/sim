/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  BLOCK_Z_BASE,
  CONTAINER_CHILD_Z_BASE,
  EDGE_Z_BASE,
  EDGE_Z_MAX,
  getBlockZIndex,
  getEdgeZIndex,
} from './canvas-layers'

/**
 * Nesting depths an edge is tiered by. Stops short of the band's ceiling: past
 * it every edge saturates at the same tier, which is checked on its own below.
 */
const DEPTHS = [undefined, 0, 1, 2, 5]

describe('getEdgeZIndex', () => {
  it('puts a highlighted edge over every ordinary one, however deeply nested', () => {
    /* The reported bug: a highlighted edge kept its own container's depth, so an
       ordinary edge one level deeper painted over it and cut the highlight. */
    const highlighted = getEdgeZIndex(undefined, { isHighlighted: true })

    for (const depth of DEPTHS) {
      expect(getEdgeZIndex(depth)).toBeLessThan(highlighted)
    }
  })

  it('keeps a highlighted edge below the cards', () => {
    /* Elevating highlighted edges over the cards drew them across the chrome of
       their own endpoints, so the highlighted tier stays inside the edge band. */
    const highlighted = getEdgeZIndex(undefined, { isHighlighted: true })

    expect(highlighted).toBeLessThan(BLOCK_Z_BASE)
    expect(highlighted).toBeLessThan(getBlockZIndex(BLOCK_Z_BASE))
    expect(highlighted).toBeLessThan(CONTAINER_CHILD_Z_BASE)
  })

  it('leaves the in-flight connection line above everything in the band', () => {
    expect(getEdgeZIndex(undefined, { isHighlighted: true })).toBeLessThan(EDGE_Z_MAX)
    for (const depth of DEPTHS) {
      expect(getEdgeZIndex(depth)).toBeLessThan(EDGE_Z_MAX)
    }
  })

  it('still orders ordinary edges by the depth they are nested at', () => {
    expect(getEdgeZIndex(undefined)).toBe(EDGE_Z_BASE)
    expect(getEdgeZIndex(0)).toBeGreaterThan(getEdgeZIndex(undefined))
    expect(getEdgeZIndex(1)).toBeGreaterThan(getEdgeZIndex(0))
  })

  it('keeps every edge clear of the container bodies it crosses', () => {
    /* Containers are numbered from 0 by nesting depth; an edge sharing a body's
       z loses the equal-z tiebreak to DOM order and is drawn behind it. */
    for (const depth of DEPTHS) {
      expect(getEdgeZIndex(depth)).toBeGreaterThan(depth ?? 0)
      expect(getEdgeZIndex(depth, { isHighlighted: true })).toBeGreaterThan(depth ?? 0)
    }
  })

  it('saturates rather than growing past the band', () => {
    /* The band is fixed, so beyond its ceiling every edge shares the deepest
       tier and no longer clears a container nested that far — true before this
       change too, at a ceiling of `EDGE_Z_MAX` rather than one below the
       highlighted tier. Nothing in the editor nests anywhere near it. */
    expect(getEdgeZIndex(40)).toBe(getEdgeZIndex(8))
    expect(getEdgeZIndex(8)).toBeLessThan(getEdgeZIndex(undefined, { isHighlighted: true }))
  })
})
