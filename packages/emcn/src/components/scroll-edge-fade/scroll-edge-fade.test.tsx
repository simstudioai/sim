/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ScrollEdgeFade } from './scroll-edge-fade'

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(ui: ReactNode) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(ui))
}

describe('ScrollEdgeFade', () => {
  beforeEach(() => {
    container = null
    root = null
  })

  afterEach(() => {
    if (root) act(() => root?.unmount())
    container?.remove()
  })

  it('uses a compact edge treatment for constrained menus', () => {
    mount(<ScrollEdgeFade position='top' variant='compact' />)

    const fade = container?.querySelector<HTMLElement>('[data-scroll-edge-fade="top"]')
    expect(fade?.className).toContain('h-3')
    expect(fade?.dataset.scrollEdgeFadeVariant).toBe('compact')
  })

  it('keeps the deeper progressive treatment for panels', () => {
    mount(<ScrollEdgeFade position='bottom' variant='panel' />)

    const fade = container?.querySelector<HTMLElement>('[data-scroll-edge-fade="bottom"]')
    expect(fade?.className).toContain('h-12')
    expect(fade?.dataset.scrollEdgeFadeVariant).toBe('panel')
  })
})
