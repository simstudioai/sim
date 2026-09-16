/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@sim/emcn'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const workspacesState = vi.hoisted(() => ({
  workspaces: [] as { id: string; name: string }[],
  isLoading: false,
  pinnedWorkspaceIds: new Set<string>(),
}))

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    onNavigate: _onNavigate,
    ...props
  }: {
    href: string
    children: React.ReactNode
    onNavigate?: () => void
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))
vi.mock(
  '@/app/o/[organizationId]/components/organization-sidebar/hooks/use-organization-workspaces',
  () => ({
    useOrganizationWorkspaces: () => workspacesState,
  })
)

vi.mock('next/navigation', () => ({
  usePathname: () => '/o/org-1/home',
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@/hooks/queries/workspace', () => ({
  useUpdateWorkspace: () => ({ mutateAsync: vi.fn() }),
  useToggleWorkspacePin: () => ({ mutate: vi.fn() }),
}))

import { WorkspaceList } from '@/app/o/[organizationId]/components/organization-sidebar/components/workspaces-section/workspace-list'
import { useHoverMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks/use-hover-menu'

function KeyboardWorkspaceFlyout() {
  const hover = useHoverMenu()
  return (
    <DropdownMenu
      open={hover.isOpen}
      onOpenChange={(open) => (open ? hover.open() : hover.close())}
    >
      <DropdownMenuTrigger>Workspaces</DropdownMenuTrigger>
      <DropdownMenuContent>
        <WorkspaceList organizationId='org-1' flyout={hover} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

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
    root.render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Workspaces</DropdownMenuTrigger>
        <DropdownMenuContent>
          <WorkspaceList
            organizationId='org-1'
            flyout={{
              isOpen: true,
              open: vi.fn(),
              close: vi.fn(),
              setLocked: vi.fn(),
              triggerProps: { onMouseEnter: vi.fn(), onMouseLeave: vi.fn() },
              contentProps: {
                onMouseEnter: vi.fn(),
                onMouseLeave: vi.fn(),
                onCloseAutoFocus: vi.fn(),
              },
            }}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    )
  })
}

describe('WorkspaceList rail view', () => {
  it('keeps the flyout open when opened from the keyboard without pointer hover', async () => {
    workspacesState.workspaces = [{ id: 'ws-1', name: 'Design' }]
    await act(async () => root.render(<KeyboardWorkspaceFlyout />))
    const trigger = container.querySelector('button')!
    await act(async () => {
      trigger.focus()
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(document.querySelector('[role="menu"]')).not.toBeNull()
    expect(document.querySelector('a[href="/workspace/ws-1"]')).toHaveTextContent('Design')
  })

  it('lists every workspace as a link into it', async () => {
    workspacesState.workspaces = [
      { id: 'ws-1', name: 'Design' },
      { id: 'ws-2', name: 'Ops' },
    ]
    await render()

    const links = Array.from(document.querySelectorAll('a')).map((a) => a.getAttribute('href'))
    expect(links).toEqual(['/workspace/ws-1', '/workspace/ws-2'])
    expect(document.body.textContent).toContain('Design')
  })

  it('shows the empty label when the organization has no workspaces', async () => {
    await render()
    expect(document.body.textContent).toContain('No workspaces yet')
  })

  it('keeps every workspace accessible in the flyout without a search field', async () => {
    workspacesState.workspaces = Array.from({ length: 8 }, (_, index) => ({
      id: `ws-${index}`,
      name: `Workspace ${index}`,
    }))
    await render()
    expect(document.querySelectorAll('a')).toHaveLength(8)
    expect(document.querySelector('input')).toBeNull()
  })

  it('shows the loading row while the list resolves', async () => {
    workspacesState.isLoading = true
    await render()
    expect(document.body.textContent).toContain('Loading...')
  })
})
