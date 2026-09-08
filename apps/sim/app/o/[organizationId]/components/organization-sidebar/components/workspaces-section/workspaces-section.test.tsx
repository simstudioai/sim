/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  isOpen: false,
  workspaces: [] as { id: string; name: string; logoUrl: null }[],
  isLoading: false,
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))
vi.mock('@/app/workspace/[workspaceId]/w/components/sidebar/hooks', () => ({
  useHoverMenu: () => ({
    isOpen: state.isOpen,
    open: vi.fn(),
    close: vi.fn(),
    setLocked: vi.fn(),
    triggerProps: { onMouseEnter: vi.fn(), onMouseLeave: vi.fn() },
    contentProps: { onMouseEnter: vi.fn(), onMouseLeave: vi.fn(), onCloseAutoFocus: vi.fn() },
  }),
}))
vi.mock('@/app/o/[organizationId]/components/organization-sidebar/hooks', () => ({
  useOrganizationWorkspaces: () => ({ workspaces: state.workspaces, isLoading: state.isLoading }),
}))

import { WorkspacesSection } from '@/app/o/[organizationId]/components/organization-sidebar/components/workspaces-section/workspaces-section'

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
  state.isOpen = false
  state.isLoading = false
  state.workspaces = Array.from({ length: 8 }, (_, index) => ({
    id: `ws-${index + 1}`,
    name: `Workspace ${index + 1}`,
    logoUrl: null,
  }))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function render(props: Partial<Parameters<typeof WorkspacesSection>[0]> = {}) {
  await act(async () => {
    root.render(
      <WorkspacesSection
        organizationId='org-1'
        isCollapsed={false}
        pathname={null}
        onContextMenu={() => {}}
        {...props}
      />
    )
  })
}

function rows() {
  return container.querySelectorAll('a[href^="/workspace/"]')
}

function pager() {
  return Array.from(container.querySelectorAll('button')).find((button) =>
    /See (more|less)/.test(button.textContent ?? '')
  )
}

describe('WorkspacesSection', () => {
  it('shows the first page and pages the rest in like the sidebar chats', async () => {
    await render()
    expect(rows()).toHaveLength(5)
    expect(pager()?.textContent).toBe('See more')

    await act(async () => pager()?.click())
    expect(rows()).toHaveLength(8)
    expect(pager()?.textContent).toBe('See less')

    await act(async () => pager()?.click())
    expect(rows()).toHaveLength(5)
  })

  it('offers no pager when the list fits the first page', async () => {
    state.workspaces = state.workspaces.slice(0, 3)
    await render()
    expect(rows()).toHaveLength(3)
    expect(pager()).toBeUndefined()
  })

  it('marks the workspace on the current route active', async () => {
    await render({ pathname: '/workspace/ws-2' })
    expect(container.querySelector('a[href="/workspace/ws-2"]')?.className).toContain(
      'surface-active'
    )
    expect(container.querySelector('a[href="/workspace/ws-1"]')?.className).not.toContain(
      'surface-active'
    )
  })

  it('shows the empty state only once the list has resolved', async () => {
    state.workspaces = []
    state.isLoading = true
    await render()
    expect(container.textContent).not.toContain('No workspaces yet')

    state.isLoading = false
    await render()
    expect(container.textContent).toContain('No workspaces yet')
  })

  it('renders the flyout while collapsed', async () => {
    state.isOpen = true
    await render({ isCollapsed: true })
    expect(container.querySelector('[aria-label="Workspaces"]')).not.toBeNull()
  })
})
