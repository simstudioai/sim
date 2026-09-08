/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { TableOfContents } from '@sim/emcn'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let host: HTMLDivElement
let root: Root
const scrollIntoView = vi.fn()
const matchMedia = vi.fn()

function clickSection(options: MouseEventInit = {}) {
  const link = host.querySelector<HTMLAnchorElement>('a')!
  let intercepted = false
  host.addEventListener(
    'click',
    (event) => {
      intercepted = event.defaultPrevented
      event.preventDefault()
    },
    { once: true }
  )
  act(() => {
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...options }))
  })
  return intercepted
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', matchMedia)
  matchMedia.mockReturnValue({ matches: false })
  window.history.replaceState({ navigation: 'preserved' }, '', '/')
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => {
    root.render(
      <>
        <TableOfContents items={[{ id: 'pricing', label: 'Pricing' }]} />
        <section id='pricing'>Pricing details</section>
      </>
    )
  })
  host.querySelector<HTMLElement>('#pricing')!.scrollIntoView = scrollIntoView
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  window.history.replaceState(null, '', '/')
  vi.clearAllMocks()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('TableOfContents navigation', () => {
  it('smoothly scrolls to the target and preserves history state without duplicate entries', () => {
    const pushState = vi.spyOn(window.history, 'pushState')

    expect(clickSection()).toBe(true)
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    expect(window.location.hash).toBe('#pricing')
    expect(window.history.state).toEqual({ navigation: 'preserved' })

    clickSection()
    expect(pushState).toHaveBeenCalledTimes(1)
  })

  it('skips animation when reduced motion is preferred', () => {
    matchMedia.mockReturnValue({ matches: true })

    clickSection()

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'instant', block: 'start' })
  })

  it.each([{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }])(
    'preserves native link behavior for modified clicks: %j',
    (modifier) => {
      expect(clickSection(modifier)).toBe(false)
      expect(scrollIntoView).not.toHaveBeenCalled()
      expect(window.location.hash).toBe('')
    }
  )
})
