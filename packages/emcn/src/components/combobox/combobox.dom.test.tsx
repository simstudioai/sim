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
