/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SortDropdown } from '@/app/workspace/[workspaceId]/components/resource/components/resource-options/resource-options'

const LONG_COLUMN_LABEL = 'highest_current_champion_role_across_the_entire_company'

function ColumnIcon() {
  return <svg data-testid='column-icon' aria-hidden='true' />
}

class ResizeObserverMock {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('SortDropdown', () => {
  it('renders long option labels in the truncatable span between both icons', () => {
    act(() => {
      root.render(
        <SortDropdown
          open
          onOpenChange={vi.fn()}
          config={{
            options: [
              {
                id: 'long-column',
                label: LONG_COLUMN_LABEL,
                icon: ColumnIcon,
              },
            ],
            active: { column: 'long-column', direction: 'asc' },
            onSort: vi.fn(),
          }}
        />
      )
    })

    const item = document.body.querySelector<HTMLElement>('[role="menuitem"]')
    expect(item).not.toBeNull()
    expect(item).toHaveAccessibleName(LONG_COLUMN_LABEL)

    const label = item?.querySelector('span')
    expect(label).not.toBeNull()
    expect(label).toHaveTextContent(LONG_COLUMN_LABEL)
    expect(label).toHaveClass('min-w-0', 'block', 'truncate')
    expect(item?.querySelector('[data-testid="column-icon"]')).not.toBeNull()
    expect(item?.querySelectorAll('svg')).toHaveLength(2)
  })
})
