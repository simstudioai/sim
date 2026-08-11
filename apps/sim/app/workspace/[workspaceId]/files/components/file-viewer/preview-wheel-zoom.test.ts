/**
 * @vitest-environment jsdom
 *
 * A mouse whose wheel reports only `deltaY` has no native gesture for reaching a preview
 * table's horizontal overflow short of dragging the scrollbar, so the tabular previews bind
 * `bindPreviewHorizontalWheel`. It must move the container on a horizontal gesture, stay out
 * of the way otherwise, and — unlike the zooming variant — leave ctrl/cmd+wheel to the browser
 * so page zoom still works over a table.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { bindPreviewHorizontalWheel } from '@/app/workspace/[workspaceId]/files/components/file-viewer/preview-wheel-zoom'

/** jsdom does no layout, so scrollWidth/clientWidth are stubbed to model an overflowing container. */
function makeContainer({ scrollWidth = 2000, clientWidth = 1000 } = {}): HTMLElement {
  const el = document.createElement('div')
  Object.defineProperty(el, 'scrollWidth', { value: scrollWidth, configurable: true })
  Object.defineProperty(el, 'clientWidth', { value: clientWidth, configurable: true })
  el.scrollLeft = 0
  document.body.appendChild(el)
  return el
}

function wheel(el: HTMLElement, init: WheelEventInit): WheelEvent {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init })
  el.dispatchEvent(event)
  return event
}

describe('bindPreviewHorizontalWheel', () => {
  let container: HTMLElement
  let unbind: () => void

  beforeEach(() => {
    document.body.innerHTML = ''
    container = makeContainer()
    unbind = bindPreviewHorizontalWheel(container)
  })

  it("scrolls by a trackpad's horizontal delta", () => {
    const event = wheel(container, { deltaX: 120, deltaY: 0 })

    expect(container.scrollLeft).toBe(120)
    expect(event.defaultPrevented).toBe(true)
  })

  it('maps shift+wheel to horizontal for a vertical-only mouse', () => {
    const event = wheel(container, { deltaX: 0, deltaY: 120, shiftKey: true })

    expect(container.scrollLeft).toBe(120)
    expect(event.defaultPrevented).toBe(true)
  })

  /**
   * Cancelling a wheel event is all-or-nothing, so a diagonal trackpad pan must have its
   * vertical movement re-applied by hand — otherwise `preventDefault` silently eats it.
   */
  it('keeps the vertical movement of a diagonal pan', () => {
    Object.defineProperty(container, 'scrollHeight', { value: 5000, configurable: true })
    Object.defineProperty(container, 'clientHeight', { value: 500, configurable: true })

    wheel(container, { deltaX: 40, deltaY: 90 })

    expect(container.scrollLeft).toBe(40)
    expect(container.scrollTop).toBe(90)
  })

  it('does not also spend a shift gesture vertically', () => {
    wheel(container, { deltaX: 0, deltaY: 120, shiftKey: true })

    expect(container.scrollLeft).toBe(120)
    expect(container.scrollTop).toBe(0)
  })

  /**
   * `deltaMode` is not always pixels — Firefox reports mouse wheels in lines — while scroll
   * offsets always are, so a three-line notch added raw would move the table three pixels.
   */
  it('converts a line-mode delta to pixels', () => {
    wheel(container, { deltaX: 3, deltaY: 0, deltaMode: WheelEvent.DOM_DELTA_LINE })

    expect(container.scrollLeft).toBe(48)
  })

  it('converts a page-mode delta to the container width', () => {
    wheel(container, { deltaX: 1, deltaY: 0, deltaMode: WheelEvent.DOM_DELTA_PAGE })

    expect(container.scrollLeft).toBe(1000)
  })

  it('leaves a plain vertical wheel alone so the container still scrolls down', () => {
    const event = wheel(container, { deltaX: 0, deltaY: 120 })

    expect(container.scrollLeft).toBe(0)
    expect(event.defaultPrevented).toBe(false)
  })

  /** Zoom is the browser's here — the tabular previews have no zoom of their own. */
  it.each([
    ['ctrl', { ctrlKey: true }],
    ['cmd', { metaKey: true }],
  ])('leaves %s+wheel to the browser', (_label, modifier) => {
    const event = wheel(container, { deltaX: 120, deltaY: 0, ...modifier })

    expect(container.scrollLeft).toBe(0)
    expect(event.defaultPrevented).toBe(false)
  })

  it('does nothing when the container has no horizontal overflow', () => {
    const fitted = makeContainer({ scrollWidth: 1000, clientWidth: 1000 })
    const unbindFitted = bindPreviewHorizontalWheel(fitted)

    const event = wheel(fitted, { deltaX: 120, deltaY: 0 })

    expect(fitted.scrollLeft).toBe(0)
    expect(event.defaultPrevented).toBe(false)
    unbindFitted()
  })

  it('stops scrolling once unbound', () => {
    unbind()

    wheel(container, { deltaX: 120, deltaY: 0 })

    expect(container.scrollLeft).toBe(0)
  })

  it('scrolls a child gesture, since the listener captures', () => {
    const cell = document.createElement('td')
    container.appendChild(cell)

    wheel(cell, { deltaX: 80, deltaY: 0 })

    expect(container.scrollLeft).toBe(80)
  })
})
