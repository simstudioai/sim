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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InsideModalContext } from '../modal/modal'
import { Combobox } from './combobox'

vi.mock('next/navigation', () => ({
  usePathname: () => '/workspace/workspace-1/home',
}))

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

function mouseDown(node: HTMLElement) {
  act(() => {
    node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
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
  document.body.removeAttribute('style')
  vi.restoreAllMocks()
})

describe('Combobox onOpenChange', () => {
  it('renders the dropdown inside the component subtree when portals are disabled', () => {
    render(<Combobox options={OPTIONS} disablePortal />)

    click(trigger())

    expect(container?.querySelector('[role="listbox"]')).not.toBeNull()
  })

  it('keeps portaled options interactive inside modal content', () => {
    const onChange = vi.fn()
    render(
      <InsideModalContext.Provider value>
        <Combobox options={OPTIONS} onChange={onChange} />
      </InsideModalContext.Provider>
    )

    click(trigger())

    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      ({ textContent }) => textContent === 'Alpha'
    )
    if (!option) throw new Error('Alpha option was not rendered')
    expect(document.body.style.pointerEvents).toBe('none')
    expect(getComputedStyle(option).pointerEvents).toBe('auto')

    mouseDown(option)

    expect(onChange).toHaveBeenCalledWith('alpha')
  })

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
    expect(document.body.style.pointerEvents).toBe('')
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

  it('explains truncated results without assuming a provider limit', () => {
    render(<Combobox options={OPTIONS} truncated searchable />)

    click(trigger())

    expect(document.body.textContent).toContain('Showing partial results')

    type(trigger('input[placeholder="Search..."]') as HTMLInputElement, 'missing')

    expect(document.body.textContent).toContain('No matches in partial results')
  })
})

describe('Combobox virtualized options', () => {
  const options = Array.from({ length: 250 }, (_, index) => ({
    label: `Model ${index}`,
    value: `model-${index}`,
  }))

  beforeEach(() => {
    /** JSDOM has no layout; use a fixed viewport and row height without mocking the virtualizer. */
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement
    ) {
      return this.hasAttribute('data-index') ? 34 : 192
    })
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(300)
  })

  describe.each([false, true])('disablePortal=%s', (disablePortal) => {
    it.each([99, 100, 250])('renders %i options on first open and reopen', (count) => {
      const onChange = vi.fn()
      render(
        <Combobox
          options={options.slice(0, count)}
          disablePortal={disablePortal}
          onChange={onChange}
        />
      )

      click(trigger())

      expect(trigger('[data-option-index="0"]').textContent).toBe('Model 0')
      const renderedCount = document.querySelectorAll('[role="option"]').length
      expect(renderedCount).toBeGreaterThan(0)
      if (count >= 100) expect(renderedCount).toBeLessThan(count)

      click(trigger())
      expect(document.querySelector('[role="listbox"]')).toBeNull()
      click(trigger())

      mouseDown(trigger('[data-option-index="1"]'))
      expect(onChange).toHaveBeenCalledWith('model-1')
    })
  })

  it('renders a selected editable model on focus and supports keyboard selection', () => {
    const onChange = vi.fn()
    render(<Combobox options={options} editable value='model-0' onChange={onChange} />)

    const input = trigger('input[role="combobox"]')
    act(() => input.focus())

    expect(trigger('[data-option-index="0"]').textContent).toBe('Model 0')
    press(input, 'ArrowDown')
    press(input, 'Enter')

    expect(onChange).toHaveBeenCalledWith('model-0')
  })

  it('renders and selects options after scrolling beyond the initial window', () => {
    const onChange = vi.fn()
    render(<Combobox options={options} onChange={onChange} />)
    click(trigger())

    expect(document.querySelector('[data-option-index="249"]')).toBeNull()
    const scrollArea = trigger('[role="listbox"]').parentElement
    if (!scrollArea) throw new Error('Scroll area was not rendered')
    act(() => {
      scrollArea.scrollTop = options.length * 34 - 192
      scrollArea.dispatchEvent(new Event('scroll'))
    })

    mouseDown(trigger('[data-option-index="249"]'))
    expect(onChange).toHaveBeenCalledWith('model-249')
  })

  it('restores virtualized options after filtering below the threshold', () => {
    render(<Combobox options={options} searchable />)
    click(trigger())
    const search = trigger('input[placeholder="Search..."]') as HTMLInputElement

    type(search, 'Model 249')
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(1)
    expect(trigger('[role="option"]').textContent).toBe('Model 249')

    type(search, '')
    expect(trigger('[data-option-index="0"]').textContent).toBe('Model 0')
    expect(document.querySelectorAll('[role="option"]').length).toBeLessThan(options.length)
  })
})
