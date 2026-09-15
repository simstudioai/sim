/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { Lightbox } from '@sim/emcn'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ usePathname: () => '/introduction' }))

let root: Root
let container: HTMLDivElement

function button(label: string): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (!element) throw new Error(`Missing button: ${label}`)
  return element
}

function media(): HTMLImageElement {
  const element = document.querySelector<HTMLImageElement>('[role="dialog"] img')
  if (!element) throw new Error('Missing lightbox image')
  return element
}

function wheel(init: WheelEventInit): WheelEvent {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init })
  act(() => media().dispatchEvent(event))
  return event
}

async function click(label: string) {
  await act(async () => button(label).click())
}

describe('Lightbox interactions', () => {
  beforeEach(async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () =>
      root.render(
        <Lightbox src='/image.png' alt='Example image'>
          <button type='button' aria-label='Open image'>
            Preview
          </button>
        </Lightbox>
      )
    )
    await click('Open image')
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    document.body.replaceChildren()
    document.body.removeAttribute('style')
    vi.restoreAllMocks()
  })

  it.each([{ ctrlKey: true }, { metaKey: true }])(
    'zooms the media in both directions and cancels page zoom for %j',
    (modifier) => {
      const zoomIn = wheel({ ...modifier, deltaY: -40 })
      expect(zoomIn.defaultPrevented).toBe(true)
      expect(Number(media().style.zoom)).toBeCloseTo(Math.exp(0.2))

      const zoomOut = wheel({ ...modifier, deltaY: 40 })
      expect(zoomOut.defaultPrevented).toBe(true)
      expect(Number(media().style.zoom)).toBeCloseTo(1)
    }
  )

  it('leaves ordinary vertical scrolling available without changing zoom', () => {
    const event = wheel({ deltaY: 40 })
    expect(event.defaultPrevented).toBe(false)
    expect(media().style.zoom).toBe('1')
  })

  it('keeps toolbar controls open, clamps zoom, and resets to fit', async () => {
    await click('Zoom in')
    expect(media().style.zoom).toBe('1.25')
    await click('Zoom out')
    expect(media().style.zoom).toBe('1')

    wheel({ ctrlKey: true, deltaY: -10000 })
    expect(media().style.zoom).toBe('4')
    expect(button('Zoom in').disabled).toBe(true)
    wheel({ ctrlKey: true, deltaY: 10000 })
    expect(media().style.zoom).toBe('0.25')
    expect(button('Zoom out').disabled).toBe(true)
    await click('Reset zoom (25%)')
    expect(media().style.zoom).toBe('1')
  })

  it('preserves the point beneath the gesture when zoom changes', () => {
    const frame = button('Close media viewer')
    const viewport = frame.parentElement?.parentElement
    if (!viewport) throw new Error('Missing viewport')
    const getBounds = vi.spyOn(frame, 'getBoundingClientRect')
    getBounds.mockReturnValueOnce(new DOMRect(100, 100, 400, 300))
    getBounds.mockReturnValueOnce(new DOMRect(100, 100, 800, 600))

    wheel({ ctrlKey: true, deltaY: -Math.log(2) / 0.005, clientX: 200, clientY: 175 })

    expect(viewport.scrollLeft).toBeCloseTo(100)
    expect(viewport.scrollTop).toBeCloseTo(75)
  })

  it('closes on the image, restores focus, and binds gestures again after reopening', async () => {
    const oldMedia = media()
    wheel({ ctrlKey: true, deltaY: -40 })
    await click('Close media viewer')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await vi.waitFor(() => expect(document.activeElement).toBe(button('Open image')))
    const detachedWheel = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -40,
    })
    oldMedia.dispatchEvent(detachedWheel)
    expect(detachedWheel.defaultPrevented).toBe(false)

    await click('Open image')
    expect(media().style.zoom).toBe('1')
    expect(wheel({ ctrlKey: true, deltaY: -40 }).defaultPrevented).toBe(true)
    expect(Number(media().style.zoom)).toBeGreaterThan(1)
  })

  it('dismisses on the viewport background and Escape', async () => {
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
    await act(async () => dialog?.click())
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await click('Open image')
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
})
