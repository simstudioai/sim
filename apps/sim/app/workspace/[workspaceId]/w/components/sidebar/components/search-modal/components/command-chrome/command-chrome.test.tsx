/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { Command } from 'cmdk'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CommandFadedList,
  CommandSearch,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/components/command-chrome'

describe('CommandFadedList', () => {
  let container: HTMLDivElement
  let root: Root
  let originalScrollIntoView: typeof HTMLElement.prototype.scrollIntoView

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    originalScrollIntoView = HTMLElement.prototype.scrollIntoView
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    if (originalScrollIntoView) {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
    }
    vi.unstubAllGlobals()
  })

  it('keeps the list unfogged at rest, insets the fade under the search field, and shares the search surface', () => {
    act(() => {
      root.render(
        <Command>
          <CommandFadedList />
          <CommandSearch surface='palette' aria-label='Search' />
        </Command>
      )
    })

    const list = container.querySelector('[cmdk-list]')
    const input = container.querySelector<HTMLInputElement>('[cmdk-input]')
    const search = container.querySelector('[cmdk-input]')?.parentElement
    expect(list?.className).toContain('[--scroll-fade-inset:3rem]')
    expect(list?.hasAttribute('data-scroll-fade-top')).toBe(false)
    expect(list?.hasAttribute('data-scroll-fade-bottom')).toBe(false)
    expect(list?.className).not.toContain('scrollbar-track')
    expect(input?.className).toContain('-ml-1')
    expect(input?.className).toContain('indent-1')
    expect(search?.className).toContain('var(--bg)')
  })

  it('cycles through palette results with Tab and Shift+Tab', () => {
    act(() => {
      root.render(
        <Command loop>
          <CommandSearch surface='palette' aria-label='Search' cycleResultsOnTab />
          <CommandFadedList>
            <Command.Item value='first'>First</Command.Item>
            <Command.Item value='second'>Second</Command.Item>
          </CommandFadedList>
        </Command>
      )
    })

    const input = container.querySelector<HTMLInputElement>('[cmdk-input]')
    const selectedResult = () =>
      container.querySelector('[cmdk-item][aria-selected="true"]')?.textContent

    expect(input).not.toBeNull()
    expect(selectedResult()).toBe('First')

    const firstTabEvent = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    })
    act(() => {
      input?.focus()
      input?.dispatchEvent(firstTabEvent)
    })
    expect(selectedResult()).toBe('Second')
    expect(firstTabEvent.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(input)

    act(() => {
      input?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      )
    })
    expect(selectedResult()).toBe('First')

    act(() => {
      input?.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        })
      )
    })
    expect(selectedResult()).toBe('Second')
  })
})
