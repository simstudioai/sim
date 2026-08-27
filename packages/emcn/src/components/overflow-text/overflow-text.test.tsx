/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OverflowText } from './overflow-text'

let host: HTMLDivElement
let root: Root
let resizeObserverCallback: ResizeObserverCallback
let resizeObserverCount: number
let originalFontsDescriptor: PropertyDescriptor | undefined

beforeEach(() => {
  resizeObserverCount = 0
  originalFontsDescriptor = Object.getOwnPropertyDescriptor(document, 'fonts')
  const fontEvents = new EventTarget()
  Object.defineProperty(fontEvents, 'ready', {
    configurable: true,
    value: new Promise(() => {}),
  })
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: fontEvents,
  })
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeObserverCount += 1
        resizeObserverCallback = callback
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  if (originalFontsDescriptor) {
    Object.defineProperty(document, 'fonts', originalFontsDescriptor)
  } else {
    Reflect.deleteProperty(document, 'fonts')
  }
  vi.unstubAllGlobals()
})

function setWidths(element: HTMLElement, clientWidth: number, scrollWidth: number) {
  Object.defineProperties(element, {
    clientWidth: { configurable: true, value: clientWidth },
    scrollWidth: { configurable: true, value: scrollWidth },
  })
  act(() =>
    resizeObserverCallback(
      [
        {
          target: element,
          contentRect: element.getBoundingClientRect(),
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        },
      ],
      {} as ResizeObserver
    )
  )
}

describe('OverflowText', () => {
  it('fades and reveals the full value only when clipped', () => {
    act(() =>
      root.render(<OverflowText label='A long workflow name' className='truncate text-sm' />)
    )
    const label = host.querySelector<HTMLElement>('span')
    if (!label) throw new Error('Overflow label did not render')

    setWidths(label, 80, 180)

    expect(label.classList.contains('overflow-hidden')).toBe(true)
    expect(label.classList.contains('text-clip')).toBe(true)
    expect(label.classList.contains('whitespace-nowrap')).toBe(true)
    expect(label.classList.contains('truncate')).toBe(false)
    expect(label.classList.contains('text-sm')).toBe(true)
    expect(label.className).toContain('-webkit-mask-image:linear-gradient')
    expect(label.className).toContain('mask-image:linear-gradient')

    act(() => {
      label.dispatchEvent(
        new MouseEvent('pointerover', { bubbles: true, clientX: 100, clientY: 100 })
      )
    })
    expect(document.querySelector('[data-native-surface-overlay]')?.textContent).toBe(
      'A long workflow name'
    )
  })

  it('leaves a fitting label unmasked and does not open a tooltip', () => {
    act(() => root.render(<OverflowText label='Short' />))
    const label = host.querySelector<HTMLElement>('span')
    if (!label) throw new Error('Overflow label did not render')

    setWidths(label, 100, 60)
    expect(label.className).not.toContain('mask-image:linear-gradient')

    act(() => {
      label.dispatchEvent(
        new MouseEvent('pointerover', { bubbles: true, clientX: 100, clientY: 100 })
      )
    })
    expect(document.querySelector('[data-native-surface-overlay]')).toBeNull()
  })

  it('keeps decorated visible content out of the plain tooltip label', () => {
    act(() =>
      root.render(
        <OverflowText label='Workflow production'>
          Workflow <mark>production</mark>
        </OverflowText>
      )
    )
    const label = host.querySelector<HTMLElement>('span')
    if (!label) throw new Error('Overflow label did not render')
    setWidths(label, 80, 180)

    act(() => {
      label.dispatchEvent(
        new MouseEvent('pointerover', { bubbles: true, clientX: 100, clientY: 100 })
      )
    })

    const tooltip = document.querySelector('[data-native-surface-overlay]')
    expect(tooltip?.textContent).toBe('Workflow production')
    expect(tooltip?.querySelector('mark')).toBeNull()
  })

  it('shares one resize observer across overflow labels', () => {
    act(() =>
      root.render(
        <>
          <OverflowText label='First workflow' />
          <OverflowText label='Second workflow' />
        </>
      )
    )

    expect(resizeObserverCount).toBe(1)
  })

  it('remeasures when an existing label changes', () => {
    act(() => root.render(<OverflowText label='Short' />))
    const label = host.querySelector<HTMLElement>('span')
    if (!label) throw new Error('Overflow label did not render')

    setWidths(label, 100, 60)
    expect(label.className).not.toContain('mask-image:linear-gradient')

    Object.defineProperty(label, 'scrollWidth', { configurable: true, value: 180 })
    act(() => root.render(<OverflowText label='A newly long workflow name' />))
    expect(label.className).toContain('mask-image:linear-gradient')

    Object.defineProperty(label, 'scrollWidth', { configurable: true, value: 60 })
    act(() => root.render(<OverflowText label='Short again' />))
    expect(label.className).not.toContain('mask-image:linear-gradient')
  })

  it('remeasures when loaded fonts change text width', () => {
    act(() => root.render(<OverflowText label='Workflow name' />))
    const label = host.querySelector<HTMLElement>('span')
    if (!label) throw new Error('Overflow label did not render')

    setWidths(label, 100, 60)
    expect(label.className).not.toContain('mask-image:linear-gradient')

    Object.defineProperty(label, 'scrollWidth', { configurable: true, value: 180 })
    act(() => document.fonts.dispatchEvent(new Event('loadingdone')))
    expect(label.className).toContain('mask-image:linear-gradient')

    Object.defineProperty(label, 'scrollWidth', { configurable: true, value: 60 })
    act(() => document.fonts.dispatchEvent(new Event('loadingerror')))
    expect(label.className).not.toContain('mask-image:linear-gradient')
  })
})
