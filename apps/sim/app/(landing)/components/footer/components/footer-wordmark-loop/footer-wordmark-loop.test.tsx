/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WORDMARK_PATHS } from '@/lib/branding/wordmark'
import { FooterWordmarkLoop } from '@/app/(landing)/components/footer/components/footer-wordmark-loop/footer-wordmark-loop'

const SHAPES = ['metaballs', 'relay', 'compass', 'corners', 'burst', 'squeeze', 'thinking'] as const

/** One full pass of the master film, in ms. */
const CYCLE_MS = 17_100

let pending: FrameRequestCallback[] = []
let clock = 0
let root: Root | null = null
let host: HTMLDivElement | null = null

/**
 * Drives the captured frame callbacks to `ms` on the loop's own clock in 50ms
 * steps - under the loop's 100ms per-frame cap, so no choreography is skipped.
 */
function advanceTo(ms: number): void {
  while (clock < ms) {
    clock = Math.min(clock + 50, ms)
    const frame = pending.shift()
    if (!frame) throw new Error('the loop stopped requesting frames')
    const now = clock
    act(() => frame(now))
  }
}

function attr(selector: string, name: string): string | null {
  return host?.querySelector(selector)?.getAttribute(name) ?? null
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  pending = []
  clock = 0
  const stubs = {
    requestAnimationFrame: (cb: FrameRequestCallback) => pending.push(cb),
    cancelAnimationFrame: () => {
      pending = []
    },
    matchMedia: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  }
  for (const [name, value] of Object.entries(stubs)) {
    vi.stubGlobal(name, value)
    Object.assign(window, { [name]: value })
  }
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root?.render(<FooterWordmarkLoop />))
  const anchor = pending.shift()
  if (!anchor) throw new Error('the loop never started')
  act(() => anchor(0))
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  host?.remove()
  host = null
  vi.unstubAllGlobals()
})

describe('FooterWordmarkLoop', () => {
  it('server-renders the crisp wordmark as the resting frame', () => {
    const html = renderToStaticMarkup(<FooterWordmarkLoop />)

    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('data-stage="wm" opacity="1"')
    expect(html).toContain('data-stage="orb" opacity="0"')
    expect(html).toContain('stdDeviation="0.55"')
    for (const shape of SHAPES) {
      expect(html).toContain(`data-stage="${shape}" opacity="0"`)
    }
    for (const d of WORDMARK_PATHS) {
      expect(html).toContain(`d="${d}"`)
    }
  })

  it('plays the master timeline: wordmark, orb, the seven shapes, orb, wordmark', () => {
    expect(attr('[data-stage="wm"]', 'opacity')).toBe('1.0000')
    expect(attr('[data-goo]', 'stdDeviation')).toBe('0.550')

    advanceTo(2700)
    expect(attr('[data-stage="wm"]', 'opacity')).toBe('0.0000')
    expect(attr('[data-stage="orb"]', 'opacity')).toBe('1.0000')
    expect(attr('[data-goo]', 'stdDeviation')).toBe('5.000')

    advanceTo(3900)
    expect(attr('[data-stage="metaballs"]', 'opacity')).toBe('1.0000')
    expect(attr('[data-stage="orb"]', 'opacity')).toBe('0.0000')
    expect(attr('[data-anim="metaballsA"]', 'transform')).not.toBe('translate(0.000 0.000)')

    advanceTo(7000)
    expect(attr('[data-stage="compass"]', 'opacity')).toBe('1.0000')
    expect(attr('[data-stage="metaballs"]', 'opacity')).toBe('0.0000')

    advanceTo(9700)
    expect(attr('[data-stage="burst"]', 'opacity')).toBe('1.0000')

    advanceTo(16000)
    expect(attr('[data-stage="wm"]', 'opacity')).toBe('1.0000')
    expect(attr('[data-stage="thinking"]', 'opacity')).toBe('0.0000')
    expect(attr('[data-goo]', 'stdDeviation')).toBe('0.550')

    advanceTo(CYCLE_MS + 2700)
    expect(attr('[data-stage="orb"]', 'opacity')).toBe('1.0000')
    expect(attr('[data-stage="wm"]', 'opacity')).toBe('0.0000')
  })

  it('stops requesting frames on unmount', () => {
    advanceTo(500)
    act(() => root?.unmount())
    root = null
    expect(pending).toHaveLength(0)
  })
})
