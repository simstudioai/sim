/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KnowledgeSourcesPreview } from '@/app/(landing)/knowledge/components/knowledge-sources-preview'
import { TablesRecordsPreview } from '@/app/(landing)/tables/components/tables-records-preview'

vi.mock('next/navigation', () => ({ usePathname: () => '/tables' }))

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  act(() => vi.runOnlyPendingTimers())
  host.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function settle() {
  act(() => vi.advanceTimersByTime(32))
}

function mount(ui: ReactNode) {
  act(() => root.render(ui))
  settle()
}

function button(text: string, container: ParentNode = document): HTMLButtonElement {
  const element = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (node) => node.getAttribute('aria-label') === text || node.textContent?.trim() === text
  )
  if (!element) throw new Error(`Missing button: ${text}`)
  return element
}

function dialog(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[role="dialog"]')
  if (!element) throw new Error('Missing dialog')
  return element
}

function click(element: HTMLElement) {
  act(() => {
    element.focus()
    element.click()
  })
  settle()
}

function pressEscape() {
  act(() => {
    dialog().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    )
  })
  settle()
}

function openMenu(trigger: HTMLElement) {
  act(() => {
    trigger.focus()
    trigger.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    )
  })
  settle()
}

function selectMenuItem(text: string) {
  const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
    (node) => node.textContent?.trim() === text
  )
  if (!item) throw new Error(`Missing menu item: ${text}`)
  click(item)
}

describe('Preview dialog return focus with native ChipModal', () => {
  it.each(['Escape', 'Cancel', 'Close', 'Update Row'])(
    'returns to the Tables row after %s',
    (action) => {
      mount(<TablesRecordsPreview />)
      const opener = button('Edit Acme Corp row')
      click(opener)
      expect(dialog().contains(document.activeElement)).toBe(true)

      if (action === 'Escape') pressEscape()
      else click(button(action, dialog()))

      expect(document.querySelector('[role="dialog"]')).toBeNull()
      expect(document.activeElement).toBe(opener)
    }
  )

  it('returns to Filter when an updated Tables row leaves the current filter', () => {
    mount(<TablesRecordsPreview />)
    const filter = button('Filter')
    openMenu(filter)
    selectMenuItem('Qualified')
    click(button('Edit Acme Corp row'))
    openMenu(button('Qualified', dialog()))
    selectMenuItem('Review')
    click(button('Update Row', dialog()))

    expect(document.querySelector('[aria-label="Edit Acme Corp row"]')).toBeNull()
    expect(document.activeElement).toBe(filter)
  })

  it.each(['Escape', 'Close'])(
    'returns to the actual Knowledge source opener after %s',
    (action) => {
      mount(<KnowledgeSourcesPreview />)
      const opener = button('View connected sources including Confluence')
      click(opener)
      expect(dialog().contains(document.activeElement)).toBe(true)

      if (action === 'Escape') pressEscape()
      else click(button(action, dialog()))

      expect(document.querySelector('[role="dialog"]')).toBeNull()
      expect(document.activeElement).toBe(opener)
    }
  )
})
