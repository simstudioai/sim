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

  it('toggles its pin without selecting the enclosing command row', () => {
    const onSelect = vi.fn()
    const onTogglePin = vi.fn()

    act(() => {
      root.render(
        <Command>
          <Command.List>
            <MemoizedActionItem
              value='open-settings'
              onSelect={onSelect}
              icon={TestIcon}
              name='Open settings'
              onTogglePin={onTogglePin}
            />
          </Command.List>
        </Command>
      )
    })

    const pinButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Add to favorites"]'
    )
    expect(pinButton).not.toBeNull()

    act(() => pinButton?.click())

    expect(onTogglePin).toHaveBeenCalledTimes(1)
    expect(onSelect).not.toHaveBeenCalled()
  })
})
