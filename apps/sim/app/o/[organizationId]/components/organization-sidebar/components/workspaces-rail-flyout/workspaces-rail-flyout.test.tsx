/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const workspacesState = vi.hoisted(() => ({
  workspaces: [] as { id: string; name: string }[],
  isLoading: false,
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))
vi.mock('@/app/o/[organizationId]/components/organization-sidebar/hooks', () => ({
  useOrganizationWorkspaces: () => workspacesState,
}))
vi.mock(
  '@/app/workspace/[workspaceId]/w/components/sidebar/components/collapsed-sidebar-menu',
  () => ({
    CollapsedResourceFlyout: ({
      entries,
      isLoading,
      emptyLabel,
    }: {
      entries: { id: string; name: string; href: string }[]
      isLoading: boolean
      emptyLabel: string
    }) =>
      isLoading ? (
        <span>Loading...</span>
      ) : entries.length === 0 ? (
        <span>{emptyLabel}</span>
      ) : (
        entries.map((entry) => (
          <a key={entry.id} href={entry.href}>
            {entry.name}
          </a>
        ))
      ),
  })
)

import { WorkspacesRailFlyout } from '@/app/o/[organizationId]/components/organization-sidebar/components/workspaces-rail-flyout/workspaces-rail-flyout'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  workspacesState.workspaces = []
  workspacesState.isLoading = false
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

async function render() {
  await act(async () => {
    root.render(<WorkspacesRailFlyout organizationId='org-1' />)
  })
}

describe('WorkspacesRailFlyout', () => {
  it('lists every workspace as a link into it', async () => {
    workspacesState.workspaces = [
      { id: 'ws-1', name: 'Design' },
      { id: 'ws-2', name: 'Ops' },
    ]
    await render()

    const links = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'))
    expect(links).toEqual(['/workspace/ws-1', '/workspace/ws-2'])
    expect(container.textContent).toContain('Design')
  })

  it('shows the empty label when the organization has no workspaces', async () => {
    await render()
    expect(container.textContent).toContain('No workspaces yet')
  })

  it('shows the loading row while the list resolves', async () => {
    workspacesState.isLoading = true
    await render()
    expect(container.textContent).toContain('Loading...')
  })
})
