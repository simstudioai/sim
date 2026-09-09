/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  calculateFitScale,
  ResponsiveDesignStage,
} from '@/app/(landing)/components/shared/responsive-design-stage/responsive-design-stage'

let resizeObserver: ResizeObserverMock | null = null

class ResizeObserverMock implements ResizeObserver {
  private readonly callback: ResizeObserverCallback
  private target: Element | null = null

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    resizeObserver = this
  }

  observe(target: Element) {
    this.target = target
  }

  unobserve() {
    this.target = null
  }

  disconnect() {
    this.target = null
  }

  deliver(width: number, height: number) {
    if (!this.target) throw new Error('ResizeObserver has no observed target')
    this.callback(
      [{ target: this.target, contentRect: { width, height } } as ResizeObserverEntry],
      this
    )
  }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  resizeObserver = null
  vi.stubGlobal('CSS', { supports: vi.fn(() => true) })
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

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

describe('ResponsiveDesignStage', () => {
  it.each([
    { width: 280, height: 400, supportsZoom: true },
    { width: 280, height: 400, supportsZoom: false },
    { width: 350, height: 340, supportsZoom: true },
    { width: 350, height: 340, supportsZoom: false },
  ])(
    'fits an uncapped $width × $height stage with zoom support: $supportsZoom',
    ({ width, height, supportsZoom }) => {
      vi.stubGlobal('CSS', { supports: vi.fn(() => supportsZoom) })
      act(() => {
        root.render(
          createElement(
            ResponsiveDesignStage,
            { width, height, maxScale: Number.POSITIVE_INFINITY },
            createElement('span', null, 'Preview')
          )
        )
      })

      const surface = container.firstElementChild?.firstElementChild
      if (!(surface instanceof HTMLElement) || !resizeObserver) {
        throw new Error('responsive stage did not mount')
      }
      const observer = resizeObserver

      act(() => observer.deliver(width * 2, height * 1.5))
      expect(surface.style.zoom).toBe(supportsZoom ? '1.5' : '1')
      expect(surface.style.transform).toBe(supportsZoom ? '' : 'scale(1.5)')
      expect(surface.style.opacity).toBe('1')

      act(() => observer.deliver(width / 2, height * 2))
      expect(surface.style.zoom).toBe(supportsZoom ? '0.5' : '1')
      expect(surface.style.transform).toBe(supportsZoom ? '' : 'scale(0.5)')
      expect(surface.style.opacity).toBe('1')
    }
  )

  it('hides an already visible surface until a measurable size returns', () => {
    act(() => {
      root.render(
        createElement(
          ResponsiveDesignStage,
          { width: 1000, height: 500 },
          createElement('span', null, 'Preview')
        )
      )
    })

    const surface = container.firstElementChild?.firstElementChild
    if (!(surface instanceof HTMLElement) || !resizeObserver) {
      throw new Error('responsive stage did not mount')
    }
    const observer = resizeObserver

    act(() => observer.deliver(500, 250))
    expect(surface.style.opacity).toBe('1')
    expect(surface.style.zoom).toBe('0.5')

    act(() => observer.deliver(0, 250))
    expect(surface.style.opacity).toBe('0')

    act(() => observer.deliver(500, 250))
    expect(surface.style.opacity).toBe('1')
    expect(surface.style.zoom).toBe('0.5')
  })
})
