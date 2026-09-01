/**
 * @vitest-environment jsdom
 *
 * `onOpenChange` is the only signal a consumer has for whether the dropdown is
 * on screen, and some build their option list from it — the agent block's tool
 * picker skips building its groups while closed. The popover is controlled, so
 * Radix reports only the dismissals it initiates itself; every other
 * transition (trigger click, chevron, focus, keyboard, selecting a row) is the
 * component's own state write and has to notify on its own. These tests pin
 * that it does, in both directions.
 */
import { act, type ReactNode, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Combobox } from './combobox'

let root: Root | null = null
let container: HTMLDivElement | null = null

const OPTIONS = [
  { label: 'Alpha', value: 'alpha' },
  { label: 'Beta', value: 'beta' },
]

function render(node: ReactNode) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(node))
}

function trigger(selector = '[role="combobox"]'): HTMLElement {
  const node = document.querySelector(selector)
  if (!node) throw new Error(`No ${selector} rendered`)
  return node as HTMLElement
}

function click(node: HTMLElement) {
  act(() => {
    node.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function press(node: HTMLElement, key: string) {
  act(() => {
    node.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  })
}

function type(node: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(node, value)
    node.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  vi.restoreAllMocks()
})

describe('Combobox onOpenChange', () => {
  it('uses the overlay label for the interactive overflow layer', () => {
    render(
      <Combobox
        options={OPTIONS}
        overlayContent={<span>2 selected</span>}
        overlayLabel='2 selected'
      />
    )

    const overflowLabels = trigger().querySelectorAll<HTMLElement>('[data-overflow-text]')
    expect(overflowLabels).toHaveLength(2)
    expect([...overflowLabels].map(({ textContent }) => textContent)).toEqual([
      '2 selected',
      '2 selected',
    ])
    expect([...overflowLabels].every(({ className }) => !className.includes('truncate'))).toBe(true)
  })

  it('reports the open a trigger click causes', () => {
    const onOpenChange = vi.fn()
    render(<Combobox options={OPTIONS} onOpenChange={onOpenChange} />)

    click(trigger())

    expect(onOpenChange).toHaveBeenCalledWith(true)
  })

  it('reports the close a second trigger click causes', () => {
    const onOpenChange = vi.fn()
    render(<Combobox options={OPTIONS} onOpenChange={onOpenChange} />)

    click(trigger())
    click(trigger())

    expect(onOpenChange).toHaveBeenNthCalledWith(1, true)
    expect(onOpenChange).toHaveBeenNthCalledWith(2, false)
  })

  it('reports the open a keyboard press causes', () => {
    const onOpenChange = vi.fn()
    render(<Combobox options={OPTIONS} onOpenChange={onOpenChange} />)

    press(trigger(), 'ArrowDown')

    expect(onOpenChange).toHaveBeenCalledWith(true)
  })

  it('reports the close Escape causes', () => {
    const onOpenChange = vi.fn()
    render(<Combobox options={OPTIONS} onOpenChange={onOpenChange} />)

    click(trigger())
    onOpenChange.mockClear()
    press(trigger(), 'Escape')

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('renders options a consumer supplies only once it is told the dropdown opened', () => {
    function Picker() {
      const [open, setOpen] = useState(false)
      return (
        <Combobox options={open ? OPTIONS : []} onOpenChange={setOpen} emptyMessage='No tools' />
      )
    }
    render(<Picker />)

    click(trigger())

    expect(document.body.textContent).toContain('Alpha')
    expect(document.body.textContent).not.toContain('No tools')
  })
})

describe('Combobox pagination', () => {
  it('offers an explicit search-all action while more pages exist', () => {
    const onLoadAll = vi.fn()
    const onLoadMore = vi.fn()
    render(
      <Combobox
        options={OPTIONS}
        searchable
        hasMore
        onLoadMore={onLoadMore}
        onLoadAll={onLoadAll}
      />
    )

    click(trigger())
    const search = document.querySelector<HTMLInputElement>('input[placeholder="Search..."]')
    if (!search) throw new Error('Search input was not rendered')
    type(search, 'missing')

    expect(document.body.textContent).toContain('No matches in loaded options')
    const action = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Search all options'
    )
    if (!action) throw new Error('Search-all action was not rendered')
    click(action)

    expect(onLoadAll).toHaveBeenCalledTimes(1)
    expect(onLoadMore).not.toHaveBeenCalled()
  })

  it('keeps the ordinary continuation action while browsing', () => {
    const onLoadMore = vi.fn()
    render(<Combobox options={OPTIONS} hasMore onLoadMore={onLoadMore} />)

    click(trigger())
    const action = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Load more'
    )
    if (!action) throw new Error('Load-more action was not rendered')
    click(action)

    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })

  it('loads the next page when browsing reaches the end of the list', () => {
    const onLoadMore = vi.fn()
    render(<Combobox options={OPTIONS} hasMore onLoadMore={onLoadMore} />)

    click(trigger())
    const scrollArea = document.querySelector<HTMLElement>('[role="listbox"]')?.parentElement
    if (!scrollArea) throw new Error('Scroll area was not rendered')
    Object.defineProperties(scrollArea, {
      scrollTop: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 200 },
      clientHeight: { configurable: true, value: 100 },
    })
    act(() => scrollArea.dispatchEvent(new Event('scroll', { bubbles: true })))

    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })

  it('does not mistake a selected editable value for an active search', () => {
    render(
      <Combobox
        options={OPTIONS}
        value='Alpha'
        selectedValue='alpha'
        editable
        filterOptions
        hasMore
        onLoadMore={vi.fn()}
      />
    )

    const input = trigger('input[role="combobox"]') as HTMLInputElement
    act(() => input.focus())

    expect(document.body.textContent).toContain('Load more')
    expect(document.body.textContent).not.toContain('Search all options')
  })

  it('explains when provider results remain beyond the safety limit', () => {
    render(<Combobox options={OPTIONS} truncated />)

    click(trigger())

    expect(document.body.textContent).toContain('Showing the first 10,000 options')
  })
})
