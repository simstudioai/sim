/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HeroPlatformLoopMount } from '@/app/(landing)/components/hero/components/hero-platform-loop/hero-platform-loop-mount'

vi.mock('next/dynamic', () => ({
  default: () => () => <div>Desktop demo</div>,
}))

let host: HTMLDivElement
let root: Root
let desktopMedia: EventTarget & { matches: boolean }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  desktopMedia = Object.assign(new EventTarget(), { matches: false })
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => desktopMedia)
  )
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

describe('HeroPlatformLoopMount', () => {
  it('leaves the desktop demo unmounted on mobile and responds to breakpoint changes', () => {
    act(() => root.render(<HeroPlatformLoopMount />))
    expect(host.textContent).toBe('')

    act(() => {
      desktopMedia.matches = true
      desktopMedia.dispatchEvent(new Event('change'))
    })
    expect(host.textContent).toBe('Desktop demo')

    act(() => {
      desktopMedia.matches = false
      desktopMedia.dispatchEvent(new Event('change'))
    })
    expect(host.textContent).toBe('')
  })

  it('keeps the server render empty even when the client viewport is desktop', () => {
    desktopMedia.matches = true
    expect(renderToStaticMarkup(<HeroPlatformLoopMount />)).toBe('')
    expect(window.matchMedia).not.toHaveBeenCalled()
  })
})
