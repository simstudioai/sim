/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HeroPlatformIntro } from '@/app/(landing)/components/hero/components/hero-platform-intro/hero-platform-intro'

let root: Root
let host: HTMLDivElement
let enterViewport: () => void
let motionChange: () => void
let reducedMotion: boolean
const onComplete = vi.fn()
const onClick = vi.fn()
const disconnect = vi.fn()
const removeMotionListener = vi.fn()

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  reducedMotion = false
  vi.clearAllMocks()
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return reducedMotion
    },
    addEventListener: (_event: string, callback: () => void) => {
      motionChange = callback
    },
    removeEventListener: removeMotionListener,
  }))
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        enterViewport = () =>
          callback(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            this as IntersectionObserver
          )
      }
      observe = vi.fn()
      disconnect = disconnect
    }
  )
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function mount() {
  act(() => {
    root.render(
      <HeroPlatformIntro onComplete={onComplete}>
        <button type='button' onClick={onClick}>
          Preview control
        </button>
      </HeroPlatformIntro>
    )
  })
}

describe('HeroPlatformIntro', () => {
  it('exposes usable content immediately and starts the exchange only once visible', () => {
    mount()
    expect(host.querySelector('[inert], [aria-hidden="true"], .opacity-0, svg')).toBeNull()
    act(() => host.querySelector('button')?.click())
    expect(onClick).toHaveBeenCalledOnce()
    expect(onComplete).not.toHaveBeenCalled()

    act(() => enterViewport())
    expect(onComplete).toHaveBeenCalledExactlyOnceWith(false)
    expect(disconnect).toHaveBeenCalled()
    act(() => enterViewport())
    expect(onComplete).toHaveBeenCalledOnce()
  })

  it.each(['pointerdown', 'focusin'])('preserves visitor control after early %s', (eventName) => {
    mount()
    act(() => host.querySelector('button')?.dispatchEvent(new Event(eventName, { bubbles: true })))
    expect(disconnect).toHaveBeenCalled()
    act(() => enterViewport())
    act(() => {
      reducedMotion = true
      motionChange()
    })
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('does not wait for the painting to decode', () => {
    const stage = document.createElement('div')
    stage.dataset.previewStage = ''
    host.before(stage)
    stage.append(host)
    const background = document.createElement('img')
    background.dataset.previewBackground = ''
    Object.defineProperty(background, 'complete', { value: false })
    background.decode = vi.fn()
    stage.append(background)

    mount()
    act(() => enterViewport())
    expect(background.decode).not.toHaveBeenCalled()
    expect(onComplete).toHaveBeenCalledExactlyOnceWith(false)
    stage.before(host)
    stage.remove()
  })

  it('shows the completed preview immediately with reduced motion', () => {
    reducedMotion = true
    mount()
    expect(onComplete).toHaveBeenCalledExactlyOnceWith(true)
  })

  it('settles when reduced motion is enabled before the preview enters view', () => {
    mount()
    act(() => {
      reducedMotion = true
      motionChange()
    })
    act(() => enterViewport())
    expect(onComplete).toHaveBeenCalledExactlyOnceWith(true)
  })

  it('disconnects on unmount without starting the exchange from a queued callback', () => {
    mount()
    act(() => root.unmount())
    act(() => enterViewport())
    expect(onComplete).not.toHaveBeenCalled()
    expect(disconnect).toHaveBeenCalled()
    expect(removeMotionListener).toHaveBeenCalledWith('change', motionChange)
  })

  it('starts without waiting when IntersectionObserver is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    mount()
    expect(onComplete).toHaveBeenCalledExactlyOnceWith(false)
  })
})
