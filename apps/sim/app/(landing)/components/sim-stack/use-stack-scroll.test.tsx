/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStackScroll } from '@/app/(landing)/components/sim-stack/use-stack-scroll'

let root: Root
let host: HTMLDivElement
let trackTop: number
let trackHeight: number
let reduced: boolean
let shortViewport: boolean
let changeReducedMotion: (() => void) | undefined
let changeMotion: (() => void) | undefined
const scrollTo = vi.fn()

function Harness() {
  const { trackRef, stageRef, progress, active, isPlaying, selectLayer, togglePlayback } =
    useStackScroll()
  return (
    <main>
      <div ref={trackRef} data-track>
        <div ref={stageRef} data-stage />
      </div>
      <output data-progress={progress} data-playing={isPlaying}>
        {active}
      </output>
      <button type='button' onClick={() => selectLayer(3)}>
        Agents
      </button>
      <button type='button' onClick={togglePlayback}>
        {isPlaying ? 'Pause' : progress >= 5.81 ? 'Replay' : 'Play'}
      </button>
      <h2 id='platform-heading' tabIndex={-1}>
        Platform
      </h2>
    </main>
  )
}

function flush() {
  act(() => vi.runOnlyPendingTimers())
}
function click(label: string) {
  const button = [...host.querySelectorAll('button')].find((el) => el.textContent === label)
  act(() => button?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })))
  act(() => button?.click())
}

beforeEach(() => {
  vi.useFakeTimers()
  trackHeight = 4600
  trackTop = 62
  reduced = false
  shortViewport = false
  changeReducedMotion = undefined
  changeMotion = undefined
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 16)
  )
  vi.stubGlobal('cancelAnimationFrame', clearTimeout)
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return reduced || (query.includes('max-height') && shortViewport)
    },
    addEventListener: (_: string, callback: () => void) => {
      if (query.includes('max-height')) changeMotion = callback
      else changeReducedMotion = callback
    },
    removeEventListener: vi.fn(),
  }))
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function () {
    return this.hasAttribute('data-track') ? trackHeight : 938
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    return new DOMRect(
      0,
      this.hasAttribute('data-track') ? trackTop : 0,
      1440,
      this.hasAttribute('data-track') ? trackHeight : 938
    )
  })
  scrollTo.mockClear()
  host = document.createElement('div')
  scrollTo.mockImplementation(({ top }: ScrollToOptions) => {
    const next = top ?? 0
    trackTop -= next - host.scrollTop
    host.scrollTop = next
    host.dispatchEvent(new Event('scroll'))
  })
  host.scrollTo = scrollTo
  document.body.append(host)
  root = createRoot(host)
  act(() => root.render(<Harness />))
  flush()
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Sim stack scroll navigation', () => {
  it('builds from the foundation, clamps at the casing, and reverses with page scroll', () => {
    expect(host.querySelector('output')?.textContent).toBe('0')
    trackTop = -4000
    act(() => host.dispatchEvent(new Event('scroll')))
    flush()
    expect(host.querySelector('output')?.textContent).toBe('5')
    trackTop = 62
    act(() => host.dispatchEvent(new Event('scroll')))
    flush()
    expect(host.querySelector('output')?.textContent).toBe('0')
  })
  it('holds the selected animation frame while the viewport changes the scroll distance', () => {
    click('Agents')
    flush()
    const selected = progress()
    trackHeight = 3800
    act(() => window.dispatchEvent(new Event('resize')))
    flush()
    expect(progress()).toBeCloseTo(selected)
    expect(host.querySelector('output')?.textContent).toBe('3')
    trackHeight = 5200
    act(() => window.dispatchEvent(new Event('resize')))
    flush()
    expect(progress()).toBeCloseTo(selected)
  })
  it('seeks the actual page scroll port when selecting a layer', () => {
    click('Agents')
    expect(scrollTo).toHaveBeenCalledWith({ top: (3.82 / 6) * (4600 - 938), behavior: 'smooth' })
  })
  it('shows the complete static stack and allows selection without scrolling for reduced motion', () => {
    reduced = true
    act(() => changeMotion?.())
    expect(host.querySelector('output')?.getAttribute('data-progress')).toBe('6')
    click('Agents')
    expect(host.querySelector('output')?.textContent).toBe('3')
    expect(host.querySelector('output')?.getAttribute('data-progress')).toBe('3.82')
    expect(scrollTo).not.toHaveBeenCalled()
  })
  it('plays, pauses on click, and resumes without restarting', () => {
    click('Play')
    act(() => vi.advanceTimersByTime(600))
    expect(progress()).toBeGreaterThan(0)
    click('Pause')
    flush()
    const paused = progress()
    act(() => vi.advanceTimersByTime(1000))
    expect(progress()).toBe(paused)
    expect(playing()).toBe('false')
    click('Play')
    act(() => vi.advanceTimersByTime(300))
    expect(progress()).toBeGreaterThan(paused)
  })
  it('hands control back to scrolling immediately on wheel input', () => {
    click('Play')
    act(() => vi.advanceTimersByTime(300))
    act(() => host.dispatchEvent(new Event('wheel')))
    expect(playing()).toBe('false')
    trackTop = -1800
    act(() => host.dispatchEvent(new Event('scroll')))
    flush()
    expect(host.querySelector('output')?.textContent).toBe('3')
  })
  it('stops at the complete stack and replays from the empty scene', () => {
    click('Play')
    act(() => vi.advanceTimersByTime(19000))
    expect(progress()).toBeCloseTo(5.82)
    expect(playing()).toBe('false')
    click('Replay')
    expect(progress()).toBe(0)
    act(() => vi.advanceTimersByTime(300))
    expect(progress()).toBeGreaterThan(0)
    expect(progress()).toBeLessThan(0.2)
  })
  it('keeps playback time independent of browser scroll rounding', () => {
    scrollTo.mockImplementation(({ top }: ScrollToOptions) => {
      const next = Math.round(top ?? 0)
      trackTop -= next - host.scrollTop
      host.scrollTop = next
      host.dispatchEvent(new Event('scroll'))
    })
    click('Play')
    act(() => vi.advanceTimersByTime(17600))
    expect(progress()).toBeCloseTo(5.82, 2)
    expect(playing()).toBe('false')
  })
  it('plays complete steps in place when reduced motion is requested', () => {
    reduced = true
    act(() => changeMotion?.())
    click('Replay')
    expect(progress()).toBe(0.82)
    act(() => vi.advanceTimersByTime(3100))
    expect(progress()).toBeCloseTo(1.82)
    expect(scrollTo).not.toHaveBeenCalled()
    click('Pause')
    expect(playing()).toBe('false')
  })
  it('reacts to reduced-motion changes even when short viewport mode is already active', () => {
    shortViewport = true
    act(() => changeMotion?.())
    click('Agents')
    click('Play')
    act(() => vi.advanceTimersByTime(300))
    expect(playing()).toBe('true')
    reduced = true
    act(() => changeReducedMotion?.())
    expect(playing()).toBe('false')
    expect(progress()).toBe(6)
  })
  it('pauses playback when the tab becomes hidden', () => {
    click('Play')
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(playing()).toBe('false')
  })
})

function progress() {
  return Number(host.querySelector('output')?.getAttribute('data-progress'))
}
function playing() {
  return host.querySelector('output')?.getAttribute('data-playing')
}
