/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

import { Table } from '@sim/emcn/icons'
import {
  CollapsedResourceFlyout,
  CollapsedSidebarMenu,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/collapsed-sidebar-menu'

function stubHoverMenu(isOpen: boolean) {
  return {
    isOpen,
    open: vi.fn(),
    close: vi.fn(),
    setLocked: vi.fn(),
    triggerProps: { onMouseEnter: vi.fn(), onMouseLeave: vi.fn() },
    contentProps: {
      onMouseEnter: vi.fn(),
      onMouseLeave: vi.fn(),
      onCloseAutoFocus: vi.fn(),
    },
  } as unknown as Parameters<typeof CollapsedSidebarMenu>[0]['hover']
}

describe('CollapsedSidebarMenu nav-link trigger', () => {
  let container: HTMLDivElement
  let root: Root

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
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  function renderMenu(
    options: { isOpen?: boolean; onContextMenu?: (e: unknown, href: string) => void } = {}
  ) {
    act(() => {
      root.render(
        <CollapsedSidebarMenu
          hover={stubHoverMenu(options.isOpen ?? false)}
          navLink={{
            item: { id: 'tables', label: 'Tables', icon: Table, href: '/workspace/w1/tables' },
            active: false,
            onContextMenu: options.onContextMenu,
          }}
        >
          <CollapsedResourceFlyout
            entries={[
              {
                kind: 'item',
                id: 't1',
                name: 'Leads',
                pinned: false,
                href: '/workspace/w1/tables/t1',
              },
              {
                kind: 'item',
                id: 't2',
                name: 'Pinned table',
                pinned: true,
                href: '/workspace/w1/tables/t2',
              },
            ]}
            emptyLabel='No tables yet'
          />
        </CollapsedSidebarMenu>
      )
    })
    const trigger = container.querySelector('a')
    if (!trigger) throw new Error('trigger anchor not rendered')
    return trigger
  }

  it('renders the rail chip as a real link, not the primitive button', () => {
    const trigger = renderMenu()

    expect(trigger.getAttribute('href')).toBe('/workspace/w1/tables')
    expect(trigger.textContent).toContain('Tables')
    expect(container.querySelector('button')).toBeNull()
    /* Radix's trigger is a button primitive; its `type` must not leak onto the anchor. */
    expect(trigger.hasAttribute('type')).toBe(false)
  })

  it('activates the link on Enter, which Radix would otherwise swallow to toggle the menu', () => {
    const trigger = renderMenu()
    const onClick = vi.fn((e: Event) => e.preventDefault())
    trigger.addEventListener('click', onClick)

    act(() => {
      trigger.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      )
    })

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('forwards a right-click to the nav item context menu with its href', () => {
    const onContextMenu = vi.fn()
    const trigger = renderMenu({ onContextMenu })

    act(() => {
      trigger.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    })

    expect(onContextMenu).toHaveBeenCalledWith(expect.anything(), '/workspace/w1/tables')
  })

  it('lists the resource rows once the flyout is open', () => {
    renderMenu({ isOpen: true })

    const row = document.querySelector('a[href="/workspace/w1/tables/t1"]')
    expect(row?.textContent).toContain('Leads')
  })

  it('marks a pinned row, so sorting it to the top does not read as arbitrary', () => {
    renderMenu({ isOpen: true })

    const pinnedRow = document.querySelector('a[href="/workspace/w1/tables/t2"]')
    const plainRow = document.querySelector('a[href="/workspace/w1/tables/t1"]')
    expect(pinnedRow?.querySelector('[aria-label="Pinned"]')).not.toBeNull()
    expect(plainRow?.querySelector('[aria-label="Pinned"]')).toBeNull()
  })
})
