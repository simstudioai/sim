/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { Command } from 'cmdk'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BlocksGroup } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/components/search-groups/search-groups'
import type { SearchBlockItem } from '@/stores/modals/search/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function TestIcon() {
  return <svg data-testid='icon' />
}

function block(id: string, name: string): SearchBlockItem {
  return { id, name, icon: TestIcon, bgColor: '#000', type: id }
}

let container: HTMLDivElement
let root: Root

function mount(ui: ReactNode) {
  act(() => {
    root.render(<Command shouldFilter={false}>{ui}</Command>)
  })
}

function selectByText(text: string) {
  const el = Array.from(container.querySelectorAll('[cmdk-item]')).find((node) =>
    node.textContent?.includes(text)
  )
  if (!el) throw new Error(`row not found: ${text}`)
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('BlocksGroup value-dispatch', () => {
  it('routes a click on a row to onSelect with the matching item', () => {
    const onSelect = vi.fn()
    const items = [block('a', 'Alpha'), block('b', 'Beta')]
    mount(<BlocksGroup items={items} onSelect={onSelect} />)

    selectByText('Beta')

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(items[1])
  })

  it('resolves the CURRENT item after items is replaced with a new array (no stale Map lookups)', () => {
    const onSelect = vi.fn()
    const first = [block('a', 'Alpha'), block('b', 'Beta')]
    mount(<BlocksGroup items={first} onSelect={onSelect} />)

    const second = [block('a', 'Alpha Renamed'), block('c', 'Gamma')]
    mount(<BlocksGroup items={second} onSelect={onSelect} />)

    selectByText('Gamma')

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(second[1])
  })

  it('still dispatches correctly after onSelect identity changes between renders', () => {
    const first = vi.fn()
    const second = vi.fn()
    const items = [block('a', 'Alpha'), block('b', 'Beta')]
    mount(<BlocksGroup items={items} onSelect={first} />)
    mount(<BlocksGroup items={items} onSelect={second} />)

    selectByText('Alpha')

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledWith(items[0])
  })
})

describe('BlocksGroup truncation affordance', () => {
  it('renders nothing extra when nothing was truncated', () => {
    mount(<BlocksGroup items={[block('a', 'Alpha')]} onSelect={vi.fn()} truncatedCount={0} />)
    expect(container.textContent).not.toMatch(/more/i)
  })

  it('surfaces a non-selectable "+N more" row when the cap trimmed real matches', () => {
    mount(<BlocksGroup items={[block('a', 'Alpha')]} onSelect={vi.fn()} truncatedCount={12} />)
    expect(container.textContent).toContain('+12 more')
    // Must not be a cmdk row — it should never be selectable via keyboard/click.
    const items = container.querySelectorAll('[cmdk-item]')
    expect(items).toHaveLength(1)
  })
})
