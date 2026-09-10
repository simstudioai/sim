/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getStrokeProgress, STACK_MOTIFS } from '@/app/(landing)/components/sim-stack/stack-motifs'
import {
  getStackAssemblyProgress,
  getStackLayerProgress,
  getStackShadowStrength,
  getStackSpacing,
  getStackSurfaceProgress,
  STACK_LAYER_REST,
  STACK_SCROLL_END,
} from '@/app/(landing)/components/sim-stack/stack-timeline'

describe('Stack illustration timeline', () => {
  it('finishes arriving before drawing and holds the camera during the trace', () => {
    for (let index = 1; index < STACK_SCROLL_END; index++) {
      expect(getStackLayerProgress(index + 0.21, index)).toEqual({ entrance: 1, drawing: 0 })
      expect(getStackLayerProgress(index + 0.45, index).drawing).toBeGreaterThan(0)
      expect(getStackLayerProgress(index + 0.45, index).drawing).toBeLessThan(1)
      expect(getStackAssemblyProgress(index + 0.25)).toBe(index)
      expect(getStackAssemblyProgress(index + 0.7)).toBe(index)
    }
  })
  it('builds the first plane from empty through outline, chrome, label, then icon', () => {
    expect(getStackSurfaceProgress(0, 0)).toEqual({ outline: 0, fill: 0, label: 0 })
    expect(getStackSurfaceProgress(0.15, 0).outline).toBeGreaterThan(0)
    expect(getStackSurfaceProgress(0.26, 0)).toEqual({ outline: 1, fill: 0, label: 0 })
    expect(getStackSurfaceProgress(0.35, 0).fill).toBeCloseTo(0.5)
    expect(getStackSurfaceProgress(0.44, 0)).toEqual({ outline: 1, fill: 1, label: 0 })
    expect(getStackSurfaceProgress(0.515, 0).label).toBeCloseTo(0.5)
    expect(getStackLayerProgress(0.59, 0).drawing).toBe(0)
    expect(getStackLayerProgress(0.7, 0).drawing).toBeCloseTo(0.5)
    expect(getStackLayerProgress(0.82, 0).drawing).toBe(1)
    expect(getStackSurfaceProgress(0.15, 0).fill).toBe(0)
    for (let index = 1; index < STACK_SCROLL_END; index++) {
      expect(getStackSurfaceProgress(index + 0.21, index).fill).toBe(1)
      expect(getStackSurfaceProgress(index + 0.36, index).label).toBe(1)
    }
  })
  it('finishes the arrival fade before descending planes overlap the stack', () => {
    for (let index = 1; index < STACK_SCROLL_END; index++) {
      expect(getStackSurfaceProgress(index - 0.1, index).fill).toBeCloseTo(0)
      expect(getStackSurfaceProgress(index - 0.0998, index).fill).toBeLessThan(0.001)
      expect(getStackSurfaceProgress(index - 0.0625, index).fill).toBeCloseTo(0.5)
      expect(getStackSurfaceProgress(index + 0.21, index).fill).toBe(1)
      expect(getStackSurfaceProgress(index - 0.02, index).fill).toBe(1)
      expect(getStackLayerProgress(index - 0.02, index).entrance).toBeLessThan(0.3)
      expect(getStackSurfaceProgress(index + 0.05, index).label).toBe(0)
    }
  })
  it('lands each navigation target on a complete illustration before the next slab appears', () => {
    for (let index = 0; index < STACK_SCROLL_END; index++) {
      expect(getStackLayerProgress(index + STACK_LAYER_REST, index)).toEqual({
        entrance: 1,
        drawing: 1,
      })
      expect(getStackLayerProgress(index + STACK_LAYER_REST, index + 1).entrance).toBe(0)
    }
  })
  it('closes the spacing only as the Sim cover arrives and reopens on reverse scroll', () => {
    expect(getStackSpacing(4.82)).toBe(1)
    expect(getStackSpacing(5.05)).toBeCloseTo(0.7)
    expect(getStackSpacing(5.82)).toBeCloseTo(0.4)
    expect(getStackSpacing(6)).toBeCloseTo(0.4)
    expect(getStackSpacing(5.05)).toBeGreaterThan(getStackSpacing(5.82))
    expect(getStackSpacing(4.82)).toBe(1)
  })
  it('introduces shadows continuously without changing shadows on already covered planes', () => {
    expect(getStackShadowStrength(2.9, 2)).toBe(0)
    expect(getStackShadowStrength(2.902, 2)).toBeLessThan(0.001)
    expect(getStackShadowStrength(3.05, 2)).toBeCloseTo(0.5)
    expect(getStackShadowStrength(3.2, 2)).toBe(1)
    expect(getStackShadowStrength(3.05, 1)).toBe(1)
    expect(getStackShadowStrength(3.05, 2)).toBeLessThan(getStackShadowStrength(3.2, 2))
    expect(getStackShadowStrength(6, 5)).toBe(0)
  })
  it('unwinds drawings with reverse progress and completes every contour', () => {
    for (const paths of STACK_MOTIFS) {
      paths.forEach((_, index) => {
        expect(getStrokeProgress(0, index, paths.length)).toBe(0)
        expect(getStrokeProgress(1, index, paths.length)).toBeCloseTo(1)
        const forward = getStrokeProgress(0.65, index, paths.length)
        const backward = getStrokeProgress(0.35, index, paths.length)
        expect(backward).toBeLessThanOrEqual(forward)
      })
      expect(getStrokeProgress(0.2, 0, paths.length)).toBeGreaterThan(0)
      expect(getStrokeProgress(0.2, paths.length - 1, paths.length)).toBe(0)
    }
  })
})
