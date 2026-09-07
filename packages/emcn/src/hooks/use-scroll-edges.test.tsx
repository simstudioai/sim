/**
 * @vitest-environment jsdom
 */
import { act, useRef, useState } from 'react'
import { scrollFadeAttributes, useScrollEdges } from '@sim/emcn'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface ScrollMetrics {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

/** jsdom lays nothing out, so the region's metrics are stubbed onto the node. */
function setMetrics(node: HTMLElement, metrics: ScrollMetrics) {
  for (const [key, value] of Object.entries(metrics)) {
    Object.defineProperty(node, key, { configurable: true, value })
  }
}

let host: HTMLDivElement
let root: Root
let region: HTMLDivElement | null = null
let enabled = true

function Region() {
  const ref = useRef<HTMLDivElement>(null)
  const edges = useScrollEdges(ref, { enabled })
  return (
    <div
      ref={(node) => {
        ref.current = node
        region = node
      }}
      {...scrollFadeAttributes(edges)}
    />
  )
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  enabled = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  region = null
  vi.unstubAllGlobals()
})

function mountWith(metrics: ScrollMetrics) {
  act(() => {
    root.render(<Region />)
  })
  if (!region) throw new Error('region did not mount')
  setMetrics(region, metrics)
  act(() => {
    region?.dispatchEvent(new Event('scroll'))
  })
}

describe('useScrollEdges', () => {
  it('reports no edge for a region whose content fits', () => {
    mountWith({ scrollTop: 0, scrollHeight: 100, clientHeight: 100 })
    expect(region?.hasAttribute('data-scroll-fade-top')).toBe(false)
    expect(region?.hasAttribute('data-scroll-fade-bottom')).toBe(false)
  })

  it('reports only the bottom edge for an overflowing region at its top', () => {
    mountWith({ scrollTop: 0, scrollHeight: 300, clientHeight: 100 })
    expect(region?.hasAttribute('data-scroll-fade-top')).toBe(false)
    expect(region?.hasAttribute('data-scroll-fade-bottom')).toBe(true)
  })

  it('reports both edges mid-scroll and only the top edge at the end', () => {
    mountWith({ scrollTop: 100, scrollHeight: 300, clientHeight: 100 })
    expect(region?.hasAttribute('data-scroll-fade-top')).toBe(true)
    expect(region?.hasAttribute('data-scroll-fade-bottom')).toBe(true)

    setMetrics(region as HTMLElement, { scrollTop: 200, scrollHeight: 300, clientHeight: 100 })
    act(() => {
      region?.dispatchEvent(new Event('scroll'))
    })
    expect(region?.hasAttribute('data-scroll-fade-top')).toBe(true)
    expect(region?.hasAttribute('data-scroll-fade-bottom')).toBe(false)
  })

  it('treats a sub-pixel remainder as sitting at the edge', () => {
    mountWith({ scrollTop: 0.5, scrollHeight: 200.4, clientHeight: 200 })
    expect(region?.hasAttribute('data-scroll-fade-top')).toBe(false)
    expect(region?.hasAttribute('data-scroll-fade-bottom')).toBe(false)
  })

  it('accepts the element itself, for regions that mount after their owner', () => {
    function LateRegion() {
      const [node, setNode] = useState<HTMLDivElement | null>(null)
      const edges = useScrollEdges(node)
      return <div ref={setNode} {...scrollFadeAttributes(edges)} />
    }
    act(() => {
      root.render(<LateRegion />)
    })
    const element = host.querySelector<HTMLDivElement>('div')
    if (!element) throw new Error('region did not mount')
    setMetrics(element, { scrollTop: 0, scrollHeight: 300, clientHeight: 100 })
    act(() => {
      element.dispatchEvent(new Event('scroll'))
    })
    expect(element.hasAttribute('data-scroll-fade-bottom')).toBe(true)
  })

  it('reads the left and right edges of a sideways region', () => {
    function Strip() {
      const ref = useRef<HTMLDivElement>(null)
      const edges = useScrollEdges(ref, { axis: 'x' })
      return <div ref={ref} {...scrollFadeAttributes(edges)} />
    }
    act(() => {
      root.render(<Strip />)
    })
    const element = host.querySelector<HTMLDivElement>('div')
    if (!element) throw new Error('strip did not mount')
    for (const [key, value] of Object.entries({
      scrollLeft: 0,
      scrollWidth: 300,
      clientWidth: 100,
    })) {
      Object.defineProperty(element, key, { configurable: true, value })
    }
    act(() => {
      element.dispatchEvent(new Event('scroll'))
    })
    expect(element.hasAttribute('data-scroll-fade-left')).toBe(false)
    expect(element.hasAttribute('data-scroll-fade-right')).toBe(true)
    expect(element.hasAttribute('data-scroll-fade-bottom')).toBe(false)
  })

  it('reads no edge while disabled', () => {
    enabled = false
    mountWith({ scrollTop: 100, scrollHeight: 300, clientHeight: 100 })
    expect(region?.hasAttribute('data-scroll-fade-top')).toBe(false)
    expect(region?.hasAttribute('data-scroll-fade-bottom')).toBe(false)
  })
})
