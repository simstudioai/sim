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

function stripItem(id: string): HTMLElement {
  const item = container?.querySelector<HTMLElement>(`[data-tab-strip-item="${id}"]`)
  if (!item) throw new Error(`Missing tab item ${id}`)
  return item
}

/** jsdom fires no real DragEvent, and the strip writes to `dataTransfer`. */
function dragStartEvent(): MouseEvent {
  const event = new MouseEvent('dragstart', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', {
    value: { effectAllowed: '', dropEffect: '', setData: vi.fn(), setDragImage: vi.fn() },
  })
  return event
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

    expect(onSelect.mock.calls[0]?.slice(0, 2)).toEqual(['two', 'pointer'])
  })

  it('forwards the originating click so callers can read its modifiers', () => {
    const onSelect = vi.fn()
    mount(renderStrip(tabs, onSelect))

    act(() => {
      tabButton('two').dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true })
      )
    })

    expect(onSelect.mock.calls[0]?.[2]?.shiftKey).toBe(true)
  })

  it('marks a tab in a multi-selection without making it the active tab', () => {
    mount(renderStrip(tabs.map((tab) => ({ ...tab, selected: tab.id === 'two' }))))

    expect(tabButton('two').className).toContain('bg-[var(--surface-active)]')
    expect(tabButton('two').getAttribute('aria-selected')).toBe('false')
    // The active tab owns the surface below it, so it never takes the
    // secondary highlight even when it is part of the selection.
    expect(tabButton('one').className).not.toContain('bg-[var(--surface-active)]')
  })

  // Supplying both `newTabControl` and `onNew` is a type error, so the built-in
  // button can never be silently shadowed by a caller's own control.
  it('fills the new-tab slot with a supplied control, and the end slot with actions', () => {
    mount(
      <TabStrip
        tabs={tabs}
        onSelect={vi.fn()}
        newTabControl={<button type='button'>Add resource</button>}
        endActions={<button type='button'>Download</button>}
      />
    )

    expect(container?.querySelector('[aria-label="New tab"]')).toBeNull()
    expect(container?.textContent).toContain('Add resource')
    expect(container?.textContent).toContain('Download')
  })

  it('tracks a plain tab drag as a reorder', () => {
    mount(<TabStrip tabs={tabs} onSelect={vi.fn()} onReorder={vi.fn()} />)

    const item = stripItem('two')
    act(() => item.dispatchEvent(dragStartEvent()))

    expect(item.className).toContain('opacity-30')
  })

  it('lets the drag owner declare a gesture is not a reorder', () => {
    mount(
      <TabStrip
        tabs={tabs}
        onSelect={vi.fn()}
        onReorder={vi.fn()}
        onTabDragStart={(_event, _id, drag) => drag.preventReorder()}
      />
    )

    const item = stripItem('two')
    act(() => item.dispatchEvent(dragStartEvent()))

    // Nothing is being tracked, so the tab never dims and no drop indicator
    // offers a move the strip has been told will not happen.
    expect(item.className).not.toContain('opacity-30')
  })

  describe('floating variant', () => {
    const plain = tabs.filter((tab) => !tab.pinned)

    function mountFloating(items = plain) {
      mount(<TabStrip tabs={items} onSelect={vi.fn()} onClose={vi.fn()} variant='floating' />)
    }

    it('gives a shape to the active tab only', () => {
      mountFloating()

      expect(tabButton('one').className).toContain('bg-[var(--surface-active)]')
      // A bare tab paints no surface of its own, which is what keeps the row
      // from reading as a strip of buttons.
      expect(tabButton('two').className).not.toContain('bg-[var(--surface-active)]')
      expect(tabButton('two').className).not.toContain('border-[var(--border)]')
    })

    it('divides two adjacent bare tabs, but not a bare tab from a shaped one', () => {
      // three/four are both bare and adjacent; two sits right after active one.
      mountFloating([
        { id: 'one', title: 'One', active: true },
        { id: 'two', title: 'Two' },
        { id: 'three', title: 'Three' },
      ])

      const divider = (id: string) => stripItem(id).querySelector('.w-px')
      // 'two' follows the active tab, whose pill already separates them.
      expect(divider('two')).toBeNull()
      expect(divider('three')).not.toBeNull()
      // Nothing precedes the first tab.
      expect(divider('one')).toBeNull()
    })

    it('offers a close affordance on every tab, at rest only on the active one', () => {
      mountFloating()

      // `opacity-0` is not a substring of `opacity-100`, so these two assertions
      // genuinely separate the states. (`toContain('pointer-events-none')` would
      // not: the Button base carries `disabled:pointer-events-none`.)
      const bare = container?.querySelector<HTMLElement>('[aria-label="Close Two"]')
      expect(bare).not.toBeNull()
      expect(bare?.className).toContain('opacity-0')
      expect(bare?.className).toContain('group-hover:opacity-100')

      const active = container?.querySelector<HTMLElement>('[aria-label="Close One"]')
      expect(active?.className).not.toContain('opacity-0')
    })

    it('reserves the close slot on every tab, so activating one shifts nothing', () => {
      mountFloating()

      // Floating tabs are content-sized, so reserving only on the active tab
      // would grow it on activation and shove the rest of the row sideways.
      expect(tabButton('one').className).toContain('pr-8')
      expect(tabButton('two').className).toContain('pr-8')
    })

    it('keeps a selected tab distinguishable from the active one', () => {
      mountFloating([
        { id: 'one', title: 'One', active: true, selected: true },
        { id: 'two', title: 'Two', selected: true },
      ])

      // The active tab owns `--surface-active`; a selected tab takes the step
      // below it, or the two would be one undifferentiated run of pills.
      expect(tabButton('one').className).toContain('bg-[var(--surface-active)]')
      expect(tabButton('two').className).toContain('bg-[var(--surface-4)]')
      expect(tabButton('two').className).not.toContain('bg-[var(--surface-active)]')
    })

    it('lets tabs overflow rather than compress, so the strip can scroll', () => {
      mountFloating()

      // A flex child that both shrinks and has no floor collapses to fit its
      // container, so scrollWidth never exceeds clientWidth and the edge fades,
      // reveal-on-select and drag auto-scroll all go dead.
      expect(stripItem('two').className).toContain('shrink-0')
      expect(stripItem('two').className).not.toContain('min-w-0')
    })

    it('leaves the attached variant unchanged', () => {
      mount(<TabStrip tabs={plain} onSelect={vi.fn()} onClose={vi.fn()} />)

      expect(tabButton('one').className).toContain('bg-[var(--bg)]')
      expect(stripItem('two').querySelector('.w-px')).toBeNull()
    })
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
      // Roomy enough that the clamp does not fire, so this exercises the inset
      // on its own; the test below covers the clamp.
      scrollWidth: { configurable: true, value: 400 },
      scrollLeft: { configurable: true, value: 0, writable: true },
    })
    row.getBoundingClientRect = () => ({ left: 0, right: 100, width: 100 }) as DOMRect
    const second = tabButton('two').parentElement as HTMLDivElement
    second.getBoundingClientRect = () => ({ left: 180, right: 280, width: 100 }) as DOMRect
    row.scrollTo = vi.fn()

    act(() => root?.render(renderStrip(tabs.map((tab) => ({ ...tab, active: tab.id === 'two' })))))

    // 280 - 100 would park the tab's right edge flush with the container's,
    // which is exactly where the fade sits — the tab would arrive half-faded.
    // The extra EDGE_FADE_PX (24) carries it clear of the fade.
    expect(row.scrollTo).toHaveBeenCalledWith({ left: 204, behavior: 'smooth' })
  })

  it('lets the last tab rest flush, since no gradient is drawn at a scroll extreme', () => {
    mount(renderStrip(tabs))
    const row = scrollRow()
    Object.defineProperties(row, {
      clientWidth: { configurable: true, value: 100 },
      scrollWidth: { configurable: true, value: 300 },
      scrollLeft: { configurable: true, value: 0, writable: true },
    })
    row.getBoundingClientRect = () => ({ left: 0, right: 100, width: 100 }) as DOMRect
    const last = tabButton('two').parentElement as HTMLDivElement
    // Flush against the end of the scrollable area.
    last.getBoundingClientRect = () => ({ left: 200, right: 300, width: 100 }) as DOMRect
    row.scrollTo = vi.fn()

    act(() => root?.render(renderStrip(tabs.map((tab) => ({ ...tab, active: tab.id === 'two' })))))

    // Wants 224; clamped to the 200 maximum rather than over-scrolling.
    expect(row.scrollTo).toHaveBeenCalledWith({ left: 200, behavior: 'smooth' })
  })
})
