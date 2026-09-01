/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { Command } from 'cmdk'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoizedActionItem } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/components/command-items'

interface TestIconProps {
  className?: string
}

function TestIcon({ className }: TestIconProps) {
  return <svg className={className} />
}

describe('MemoizedActionItem', () => {
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
    vi.unstubAllGlobals()
    if (originalScrollIntoView) {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
    }
  })

  it('centers the command glyph in a fixed three-slot shortcut hint', () => {
    act(() => {
      root.render(
        <Command>
          <Command.List>
            <MemoizedActionItem
              value='run-workflow'
              onSelect={vi.fn()}
              icon={TestIcon}
              name='Run workflow'
              shortcut='⌘↵'
            />
          </Command.List>
        </Command>
      )
    })

    const shortcut = container.querySelector('[aria-label="Keyboard shortcut ⌘↵"]')
    expect(Array.from(shortcut?.children ?? []).map((slot) => slot.textContent)).toEqual([
      '',
      '⌘',
      '↵',
    ])
    expect(container.querySelector('button[aria-label*="favorites"]')).toBeNull()
  })
})
