import { describe, expect, it } from 'vitest'
import { calculateFitScale } from '@/app/(landing)/components/shared/responsive-design-stage/responsive-design-stage'

describe('calculateFitScale', () => {
  it('fits the design surface to the limiting host dimension', () => {
    expect(
      calculateFitScale({
        availableWidth: 1080,
        availableHeight: 620,
        designWidth: 1280,
        designHeight: 735,
        inset: 0,
        maxScale: 1,
      })
    ).toBeCloseTo(620 / 735)
  })

  it('reserves the requested inset before calculating the scale', () => {
    expect(
      calculateFitScale({
        availableWidth: 500,
        availableHeight: 700,
        designWidth: 560,
        designHeight: 700,
        inset: 20,
        maxScale: 1,
      })
    ).toBeCloseTo(480 / 560)
  })

  it('does not upscale beyond the configured maximum', () => {
    expect(
      calculateFitScale({
        availableWidth: 1600,
        availableHeight: 1000,
        designWidth: 1280,
        designHeight: 735,
        inset: 0,
        maxScale: 1,
      })
    ).toBe(1)
  })

  it('does not apply a scale before the host has measurable space', () => {
    expect(
      calculateFitScale({
        availableWidth: 0,
        availableHeight: 620,
        designWidth: 1280,
        designHeight: 735,
        inset: 0,
        maxScale: 1,
      })
    ).toBe(0)
  })
})
