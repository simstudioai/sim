/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TabStrip, type TabStripItem } from './tab-strip'

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(ui: ReactNode): void {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(ui))
}

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

const tabs: TabStripItem[] = [
  { id: 'pinned', title: 'Pinned', pinned: true },
  { id: 'one', title: 'One', active: true },
  { id: 'two', title: 'Two' },
]

function renderStrip(items: TabStripItem[], onSelect = vi.fn(), onClose = vi.fn()): ReactNode {
  return <TabStrip tabs={items} onSelect={onSelect} onClose={onClose} onNew={() => {}} />
}

function tabButton(id: string): HTMLButtonElement {
  const button = container?.querySelector<HTMLButtonElement>(`[data-tab-strip-button="${id}"]`)
  if (!button) throw new Error(`Missing tab button ${id}`)
  return button
}

function scrollRow(): HTMLDivElement {
  const row = container?.querySelector<HTMLDivElement>('.overflow-x-auto')
  if (!row) throw new Error('Missing scrolling tab row')
  return row
}

describe('TabStrip interactions', () => {
  it('uses one keyboard tab stop and exposes tab semantics', () => {
    mount(renderStrip(tabs))

    expect(container?.querySelector('[role="tablist"]')).not.toBeNull()
    expect(tabButton('one').getAttribute('aria-selected')).toBe('true')
    expect(tabButton('one').tabIndex).toBe(0)
    expect(tabButton('two').tabIndex).toBe(-1)
    expect(container?.querySelector<HTMLButtonElement>('[aria-label="Close Two"]')?.tabIndex).toBe(
      -1
    )
  })

  it('cycles, jumps, and closes from the keyboard', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    mount(renderStrip(tabs, onSelect, onClose))

    act(() => {
      tabButton('one').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
      )
    })
    expect(onSelect).toHaveBeenCalledWith('two', 'keyboard')
    expect(document.activeElement).toBe(tabButton('two'))

    act(() => {
      tabButton('two').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true })
      )
    })
    expect(onSelect).toHaveBeenLastCalledWith('pinned', 'keyboard')

    act(() => {
      tabButton('two').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true })
      )
    })
    expect(onClose).toHaveBeenCalledWith('two')
  })

  it('identifies pointer selection separately from keyboard navigation', () => {
    const onSelect = vi.fn()
    mount(renderStrip(tabs, onSelect))

    act(() => tabButton('two').click())

    expect(onSelect).toHaveBeenCalledWith('two', 'pointer')
  })

  it('closes an unpinned tab with the middle mouse button', () => {
    const onClose = vi.fn()
    mount(renderStrip(tabs, vi.fn(), onClose))

    act(() => {
      tabButton('two').parentElement?.dispatchEvent(
        new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true })
      )
    })

    expect(onClose).toHaveBeenCalledWith('two')
  })

  it('forwards a wheel gesture from the new-tab button to the scrolling row', () => {
    mount(renderStrip(tabs))
    const row = scrollRow()
    Object.defineProperties(row, {
      clientWidth: { configurable: true, value: 100 },
      scrollWidth: { configurable: true, value: 400 },
      scrollLeft: { configurable: true, value: 0, writable: true },
    })
    const newTab = container?.querySelector<HTMLButtonElement>('[aria-label="New tab"]')
    const event = new WheelEvent('wheel', { deltaY: 80, bubbles: true, cancelable: true })

    act(() => newTab?.dispatchEvent(event))

    expect(row.scrollLeft).toBe(80)
    expect(event.defaultPrevented).toBe(true)
  })

  it('keeps pinned tabs out of the scrolling lane', () => {
    mount(renderStrip(tabs))

    expect(scrollRow().contains(tabButton('pinned'))).toBe(false)
    expect(scrollRow().contains(tabButton('one'))).toBe(true)
  })

  it('shows background activity without marking that tab selected', () => {
    mount(renderStrip(tabs.map((tab) => ({ ...tab, attention: tab.id === 'two' }))))

    expect(tabButton('two').querySelector('[aria-label="Background activity"]')).not.toBeNull()
    expect(tabButton('two').getAttribute('aria-selected')).toBe('false')
    expect(tabButton('one').querySelector('[aria-label="Background activity"]')).toBeNull()
  })

  it('does not reserve phantom space after a pointer close', () => {
    const regularTabs = tabs.filter((tab) => !tab.pinned)
    mount(renderStrip(regularTabs))

    act(() => {
      container
        ?.querySelector<HTMLButtonElement>('[aria-label="Close Two"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      root?.render(renderStrip(regularTabs.slice(0, 1)))
    })

    expect(scrollRow().querySelector('[data-tab-width-lock]')).toBeNull()
  })

  it('puts a new tab in its final layout immediately', () => {
    const regularTabs = tabs.filter((tab) => !tab.pinned)
    mount(renderStrip(regularTabs.slice(0, 1)))

    act(() => root?.render(renderStrip(regularTabs)))

    const openedTab = scrollRow().querySelector<HTMLElement>('[data-tab-strip-item="two"]')
    expect(openedTab?.style.width).toBe('')
    expect(openedTab?.style.minWidth).toBe('')
  })

  it('reveals a newly active offscreen tab', () => {
    mount(renderStrip(tabs))
    const row = scrollRow()
    Object.defineProperties(row, {
      clientWidth: { configurable: true, value: 100 },
      scrollWidth: { configurable: true, value: 300 },
      scrollLeft: { configurable: true, value: 0, writable: true },
    })
    row.getBoundingClientRect = () => ({ left: 0, right: 100, width: 100 }) as DOMRect
    const second = tabButton('two').parentElement as HTMLDivElement
    second.getBoundingClientRect = () => ({ left: 180, right: 280, width: 100 }) as DOMRect
    row.scrollTo = vi.fn()

    act(() => root?.render(renderStrip(tabs.map((tab) => ({ ...tab, active: tab.id === 'two' })))))

    expect(row.scrollTo).toHaveBeenCalledWith({ left: 180, behavior: 'smooth' })
  })
})
