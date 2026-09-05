/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HeroPlatformIntro } from '@/app/(landing)/components/hero/components/hero-platform-intro/hero-platform-intro'

vi.mock('@sim/emcn', () => ({
  cn: (...values: Array<string | false | undefined>) => values.filter(Boolean).join(' '),
}))

interface PendingAnimation {
  element: Element
  frames: Keyframe[]
  options: KeyframeAnimationOptions
  finish: () => void
  cancel: ReturnType<typeof vi.fn>
}

let root: Root
let host: HTMLDivElement
let pending: PendingAnimation[]
let frame: FrameRequestCallback | undefined
let enterViewport: () => void
let motionChange: () => void
let reducedMotion: boolean
const onComplete = vi.fn()
const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate')
const originalRangeBounds = Object.getOwnPropertyDescriptor(
  Range.prototype,
  'getBoundingClientRect'
)

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  pending = []
  frame = undefined
  reducedMotion = false
  onComplete.mockClear()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frame = callback
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', () => {
    frame = undefined
  })
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return reducedMotion
    },
    addEventListener: (_event: string, callback: () => void) => {
      motionChange = callback
    },
    removeEventListener: vi.fn(),
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
      disconnect = vi.fn()
    }
  )
  vi.stubGlobal('ResizeObserver', undefined)
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.matches('svg[data-test-icon]')) return new DOMRect(24, 32, 16, 16)
    if (this.matches('[data-preview-composer]')) return new DOMRect(220, 180, 320, 80)
    if (this.matches('textarea')) return new DOMRect(232, 192, 296, 32)
    if (this.matches('[data-test-workspace]')) return new DOMRect(180, 8, 412, 384)
    return new DOMRect(0, 0, 600, 400)
  })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: vi.fn(() => new DOMRect(48, 32, 80, 16)),
  })
  const readComputedStyle = window.getComputedStyle
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudoElement) => {
    const style = readComputedStyle(element, pseudoElement)
    if (element instanceof SVGElement) {
      Object.defineProperties(style, {
        fill: { value: element.getAttribute('fill') ?? 'none' },
        stroke: { value: element.getAttribute('stroke') ?? 'none' },
        color: { value: '#737373' },
        strokeWidth: { value: '1' },
      })
    }
    return style
  })
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value(this: Element, frames: Keyframe[], options: KeyframeAnimationOptions) {
      let finish = () => {}
      const finished = new Promise<void>((resolve) => {
        finish = resolve
      })
      const cancel = vi.fn(() => ({
        contentHidden: host.querySelector('[data-preview-state] > .opacity-0') !== null,
        contentInert: host.querySelector('[data-preview-state] > [inert]') !== null,
        overlayMounted: host.querySelector('[data-preview-state] > svg') !== null,
      }))
      pending.push({ element: this, frames, options, finish, cancel })
      return { finished, cancel }
    },
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  if (originalAnimate) Object.defineProperty(Element.prototype, 'animate', originalAnimate)
  else Reflect.deleteProperty(Element.prototype, 'animate')
  if (originalRangeBounds)
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', originalRangeBounds)
  else Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect')
})

function mount(withGraphics = false) {
  act(() => {
    root.render(
      <HeroPlatformIntro onComplete={onComplete}>
        {withGraphics && (
          <div data-preview-sidebar=''>
            <div>
              <div>
                <svg data-test-icon='sidebar' viewBox='0 0 16 16' aria-hidden='true'>
                  <path d='M 2 8 L 8 2 L 14 8' fill='none' stroke='currentColor' />
                </svg>
                <span>Workspace</span>
              </div>
              <div>
                <span>Morgan</span>
              </div>
            </div>
          </div>
        )}
        <div data-preview-outline='frame' data-test-workspace=''>
          <button type='button'>Preview control</button>
          {withGraphics && (
            <div data-preview-outline='frame' data-preview-composer=''>
              <span data-preview-skeleton-label=''>What should we get done?</span>
              <textarea aria-label='Ask Sim' />
              <svg data-test-icon='composer' viewBox='0 0 16 16' aria-hidden='true'>
                <path d='M 3 3 L 13 8 L 3 13 Z' fill='currentColor' stroke='none' />
              </svg>
            </div>
          )}
        </div>
      </HeroPlatformIntro>
    )
  })
}

function beginDrawing() {
  act(() => enterViewport())
  act(() => frame?.(0))
}

function state() {
  return host.querySelector('[data-preview-state]')?.getAttribute('data-preview-state')
}

function animationFor(element: Element | null | undefined) {
  const animation = pending.find((candidate) => candidate.element === element)
  if (!animation) throw new Error('Expected an animation for the preview element')
  return animation
}

function startsAt(animation: PendingAnimation) {
  return Number(animation.options.delay ?? 0)
}

function endsAt(animation: PendingAnimation) {
  return startsAt(animation) + Number(animation.options.duration)
}

describe('HeroPlatformIntro', () => {
  it('waits for visibility and finishes the chrome fade before enabling controls or starting chat', async () => {
    mount()
    expect(state()).toBe('waiting')
    expect(pending).toHaveLength(0)
    expect(host.querySelector('[inert]')).not.toBeNull()
    beginDrawing()
    expect(state()).toBe('drawing')
    expect(onComplete).not.toHaveBeenCalled()
    expect(host.querySelector('svg rect[pathLength="1"]')).not.toBeNull()
    await act(async () =>
      pending.find((animation) => animation.element.hasAttribute('inert'))?.finish()
    )
    expect(state()).toBe('ready')
    expect(host.querySelector('[inert]')).toBeNull()
    expect(host.querySelector('svg')).toBeNull()
    expect(onComplete).toHaveBeenCalledExactlyOnceWith(false)
    act(() => enterViewport())
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('draws the frame and sidebar before the composer, then waits for all drawing before revealing content', () => {
    mount(true)
    beginDrawing()
    const overlay = host.querySelector('[data-preview-state] > svg')
    const outlines = overlay?.querySelectorAll('g:first-child > rect')
    const outerFrame = animationFor(outlines?.[0])
    const workspaceFrame = animationFor(outlines?.[1])
    const composerFrame = animationFor(outlines?.[2])
    const sidebarIcon = animationFor(overlay?.querySelector('[data-test-icon="sidebar"] path'))
    const composerIcon = animationFor(overlay?.querySelector('[data-test-icon="composer"] path'))
    const content = animationFor(host.querySelector('[data-preview-state] > div'))
    const overlayFade = animationFor(overlay)

    expect(startsAt(outerFrame)).toBeLessThan(startsAt(workspaceFrame))
    expect(startsAt(workspaceFrame)).toBeLessThan(startsAt(sidebarIcon))
    expect(endsAt(sidebarIcon)).toBeLessThanOrEqual(startsAt(composerFrame))
    expect(startsAt(composerFrame)).toBeLessThan(startsAt(composerIcon))
    for (const animation of pending) {
      if (animation === content || animation === overlayFade) continue
      expect(endsAt(animation)).toBeLessThanOrEqual(startsAt(content))
    }
    expect(overlayFade.options).toEqual(content.options)
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('draws filled icons before filling them without competing animations on their properties', () => {
    mount(true)
    beginDrawing()
    const overlay = host.querySelector('[data-preview-state] > svg')
    const icons = overlay?.querySelectorAll('[data-preview-icons] path')
    expect(icons).toHaveLength(2)
    for (const icon of icons ?? []) {
      expect(pending.filter((animation) => animation.element === icon)).toHaveLength(1)
      expect(icon.getAttribute('stroke-dashoffset')).toBe('1')
      expect(icon.getAttribute('fill-opacity')).toBe('0')
    }
    const filled = animationFor(overlay?.querySelector('[data-test-icon="composer"] path'))
    const strokeComplete = filled.frames.findIndex((frame) => frame.strokeDashoffset === 0)
    const fillVisible = filled.frames.findIndex((frame) => Number(frame.fillOpacity) > 0)
    expect(strokeComplete).toBeGreaterThan(0)
    expect(fillVisible).toBeGreaterThan(strokeComplete)
    expect(filled.frames[strokeComplete].fillOpacity).toBe(0)
    expect(filled.frames[strokeComplete].offset).toBeGreaterThan(0)
    expect(filled.frames[strokeComplete].offset).toBeLessThan(1)
    const outlined = animationFor(overlay?.querySelector('[data-test-icon="sidebar"] path'))
    expect(outlined.frames.every((frame) => frame.fillOpacity === 0)).toBe(true)
  })

  it('reveals skeleton bars once without brightness reversals before the shared handoff', () => {
    mount(true)
    beginDrawing()
    const skeletons = host.querySelectorAll('[data-preview-skeleton] rect')
    expect(skeletons.length).toBeGreaterThan(0)
    for (const bar of skeletons) {
      const animation = animationFor(bar)
      const opacity = animation.frames.map((frame) => Number(frame.opacity))
      expect(opacity[0]).toBe(0)
      expect(opacity.at(-1)).toBeGreaterThan(0)
      expect(opacity.every((value, index) => index === 0 || value >= opacity[index - 1])).toBe(true)
    }
  })

  it('keeps final animation styles until the real content is visible and the overlay has unmounted', async () => {
    mount(true)
    beginDrawing()
    const reveal = animationFor(host.querySelector('[data-preview-state] > div'))
    expect(pending.every((animation) => animation.cancel.mock.calls.length === 0)).toBe(true)
    await act(async () => reveal.finish())
    expect(state()).toBe('ready')
    for (const animation of pending) {
      expect(animation.cancel).toHaveBeenCalledTimes(1)
      expect(animation.cancel.mock.results[0].value).toEqual({
        contentHidden: false,
        contentInert: false,
        overlayMounted: false,
      })
    }
    expect(onComplete).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('settles safely after a layout resize without replaying or completing twice', async () => {
    let resize: (() => void) | undefined
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resize = () => callback([], this as ResizeObserver)
        }
        observe = vi.fn()
        disconnect = vi.fn()
      }
    )
    mount(true)
    beginDrawing()
    act(() => resize?.())
    expect(state()).toBe('drawing')
    const preview = host.querySelector('[data-preview-state]')
    if (!preview) throw new Error('Expected the platform preview')
    vi.spyOn(preview, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 400))
    act(() => resize?.())
    expect(state()).toBe('ready')
    expect(host.querySelector('[inert]')).toBeNull()
    for (const animation of pending) {
      expect(animation.cancel.mock.results[0].value).toEqual({
        contentHidden: false,
        contentInert: false,
        overlayMounted: false,
      })
    }
    await act(async () => pending.forEach((animation) => animation.finish()))
    act(() => enterViewport())
    expect(onComplete).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('waits for the painting to decode before drawing the platform', async () => {
    const stage = document.createElement('div')
    stage.dataset.previewStage = ''
    host.before(stage)
    stage.append(host)
    const background = document.createElement('img')
    background.dataset.previewBackground = ''
    Object.defineProperty(background, 'complete', { value: false })
    let loaded = () => {}
    background.decode = () =>
      new Promise<void>((resolve) => {
        loaded = resolve
      })
    stage.append(background)
    mount()
    beginDrawing()
    expect(state()).toBe('waiting')
    expect(pending).toHaveLength(0)
    await act(async () => loaded())
    act(() => frame?.(0))
    expect(state()).toBe('drawing')
    expect(onComplete).not.toHaveBeenCalled()
    stage.before(host)
    stage.remove()
  })

  it('shows the completed preview immediately when reduced motion is enabled', () => {
    reducedMotion = true
    mount()
    expect(state()).toBe('ready')
    expect(pending).toHaveLength(0)
    expect(host.querySelector('[inert]')).toBeNull()
    expect(onComplete).toHaveBeenCalledExactlyOnceWith(true)
  })

  it('settles immediately if reduced motion is enabled during the drawing', async () => {
    mount()
    beginDrawing()
    act(() => {
      reducedMotion = true
      motionChange()
    })
    expect(state()).toBe('ready')
    expect(pending.every((animation) => animation.cancel.mock.calls.length > 0)).toBe(true)
    await act(async () => pending.forEach((animation) => animation.finish()))
    expect(onComplete).toHaveBeenCalledExactlyOnceWith(true)
  })

  it('cancels the entrance on unmount without starting the chat', async () => {
    mount()
    beginDrawing()
    act(() => root.unmount())
    await act(async () => pending.forEach((animation) => animation.finish()))
    expect(pending.every((animation) => animation.cancel.mock.calls.length > 0)).toBe(true)
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('falls back to the finished preview when Web Animations are unavailable', () => {
    Reflect.deleteProperty(Element.prototype, 'animate')
    mount()
    expect(state()).toBe('ready')
    expect(onComplete).toHaveBeenCalledExactlyOnceWith(true)
  })
})
