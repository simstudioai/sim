/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PopoverItem, PopoverScrollArea } from './popover'

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(ui: ReactNode) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(ui))
}

describe('PopoverScrollArea', () => {
  beforeEach(() => {
    container = null
    root = null
  })

  afterEach(() => {
    if (root) act(() => root?.unmount())
    container?.remove()
  })

  it('keeps the scroll viewport flush with the popover edges', () => {
    mount(
      <PopoverScrollArea>
        <div>Items</div>
      </PopoverScrollArea>
    )

    const scrollArea = container?.querySelector<HTMLElement>('[data-popover-scroll]')
    expect(scrollArea?.parentElement?.className).toContain('overflow-hidden')
    expect(scrollArea?.parentElement?.className).toContain('-my-1.5')
    expect(scrollArea?.parentElement?.classList.contains('py-1.5')).toBe(false)
    expect(scrollArea?.classList.contains('py-1.5')).toBe(true)
    expect(scrollArea?.className).toContain('scroll-py-3')
    expect(scrollArea?.className).toContain('[&::-webkit-scrollbar]:size-1')
  })

  it('supports a panel fade variant without changing the scroll contract', () => {
    mount(
      <PopoverScrollArea fadeVariant='panel'>
        <div>Items</div>
      </PopoverScrollArea>
    )

    const scrollArea = container?.querySelector<HTMLElement>('[data-popover-scroll]')
    const fade = container?.querySelector<HTMLElement>('[data-popover-scroll-fade="top"]')
    expect(scrollArea?.className).toContain('scroll-py-12')
    expect(fade?.dataset.scrollEdgeFadeVariant).toBe('panel')
  })

  it('can hide scrollbar chrome while preserving the scroll viewport', () => {
    mount(
      <PopoverScrollArea scrollbar='hidden'>
        <div>Items</div>
      </PopoverScrollArea>
    )

    const scrollArea = container?.querySelector<HTMLElement>('[data-popover-scroll]')
    expect(scrollArea?.className).toContain('[scrollbar-width:none]')
    expect(scrollArea?.className).toContain('[&::-webkit-scrollbar]:hidden')
    expect(scrollArea?.className).toContain('overflow-y-auto')
    expect(scrollArea?.className).toContain('overflow-x-hidden')
  })

  it('can defer the bottom fade to an overlapping action surface', () => {
    mount(
      <PopoverScrollArea bottomFade={false}>
        <div>Items</div>
      </PopoverScrollArea>
    )

    expect(container?.querySelector('[data-popover-scroll-fade="top"]')).not.toBeNull()
    expect(container?.querySelector('[data-popover-scroll-fade="bottom"]')).toBeNull()
  })

  it('reveals edge fades only when more content exists in that direction', () => {
    mount(
      <PopoverScrollArea>
        <div>Items</div>
      </PopoverScrollArea>
    )

    const scrollArea = container?.querySelector<HTMLElement>('[data-popover-scroll]')
    if (!scrollArea) throw new Error('Expected popover scroll area')

    Object.defineProperties(scrollArea, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 200 },
      scrollTop: { configurable: true, value: 0, writable: true },
    })

    const topFade = container?.querySelector<HTMLElement>('[data-popover-scroll-fade="top"]')
    const bottomFade = container?.querySelector<HTMLElement>('[data-popover-scroll-fade="bottom"]')

    act(() => scrollArea.dispatchEvent(new Event('scroll', { bubbles: true })))
    expect(topFade?.className).toContain('opacity-0')
    expect(bottomFade?.className).toContain('opacity-100')

    scrollArea.scrollTop = 50
    act(() => scrollArea.dispatchEvent(new Event('scroll', { bubbles: true })))
    expect(topFade?.className).toContain('opacity-100')
    expect(bottomFade?.className).toContain('opacity-100')

    scrollArea.scrollTop = 100
    act(() => scrollArea.dispatchEvent(new Event('scroll', { bubbles: true })))
    expect(topFade?.className).toContain('opacity-100')
    expect(bottomFade?.className).toContain('opacity-0')
  })

  it('lets nested components own their icon foreground', () => {
    mount(
      <PopoverItem>
        <svg aria-label='Direct icon' />
        <span>
          <svg aria-label='Nested icon' />
        </span>
      </PopoverItem>
    )

    const item = container?.firstElementChild
    expect(item?.className).toContain('[&>svg]:text-[var(--text-icon)]')
    expect(item?.className).not.toContain('[&_svg]:text-[var(--text-icon)]')
  })
})
