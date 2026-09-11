/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  isOpen: false,
  workspaces: [] as { id: string; name: string; logoUrl: null; permissions: string }[],
  pins: new Set<string>(),
  canCreate: true,
  createOrganizationId: 'org-1',
  mockCreate: vi.fn(),
  mockRename: vi.fn(),
  mockPin: vi.fn(),
  mockPush: vi.fn(),
  isLoading: false,
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
vi.mock('@/app/workspace/[workspaceId]/w/components/sidebar/hooks/use-hover-menu', () => ({
  useHoverMenu: () => ({
    isOpen: state.isOpen,
    open: vi.fn(),
    close: vi.fn(),
    setLocked: vi.fn(),
    triggerProps: { onMouseEnter: vi.fn(), onMouseLeave: vi.fn() },
    contentProps: { onMouseEnter: vi.fn(), onMouseLeave: vi.fn(), onCloseAutoFocus: vi.fn() },
  }),
}))
vi.mock(
  '@/app/o/[organizationId]/components/organization-sidebar/hooks/use-organization-workspaces',
  () => ({
    useOrganizationWorkspaces: () => ({
      workspaces: state.workspaces,
      pinnedWorkspaceIds: state.pins,
      isLoading: state.isLoading,
    }),
  })
)

vi.mock('next/navigation', () => ({
  usePathname: () => '/o/org-1/home',
  useRouter: () => ({ push: state.mockPush }),
}))
vi.mock('@/hooks/queries/workspace', () => ({
  useUpdateWorkspace: () => ({ mutateAsync: state.mockRename }),
  useToggleWorkspacePin: () => ({ mutate: state.mockPin }),
  useCreateWorkspace: () => ({ mutateAsync: state.mockCreate, isPending: false }),
  useWorkspaceCreationPolicy: () => ({
    data: {
      canCreate: state.canCreate,
      organizationId: state.createOrganizationId,
      reason: 'Workspace limit reached',
    },
  }),
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
  vi.clearAllMocks()
  state.canCreate = true
  state.createOrganizationId = 'org-1'
  state.pins.clear()
  state.mockCreate.mockResolvedValue({ id: 'ws-new' })
  state.mockRename.mockResolvedValue({})
  state.isOpen = false
  state.isLoading = false
  state.workspaces = Array.from({ length: 8 }, (_, index) => ({
    id: `ws-${index + 1}`,
    name: `Workspace ${index + 1}`,
    logoUrl: null,
    permissions: 'admin',
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
      <WorkspacesSection organizationId='org-1' isCollapsed={false} pathname={null} {...props} />
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
  it('searches all workspaces, including those beyond the first page', async () => {
    await render()
    await act(async () => typeInto(container.querySelector('input')!, 'Workspace 8'))
    expect(rows()).toHaveLength(1)
    expect(rows()[0].textContent).toContain('Workspace 8')
    expect(pager()).toBeUndefined()
    await act(async () => typeInto(container.querySelector('input')!, ''))
    expect(rows()).toHaveLength(5)
  })

  it('uses the shared pin mutation and permission-aware rename action', async () => {
    await render()
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Options for Workspace 1"]')?.click()
    )
    const pin = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
      (item) => item.textContent === 'Pin'
    )
    expect(pin).toBeDefined()
    await act(async () => pin?.click())
    expect(state.mockPin).toHaveBeenCalledWith(
      { workspaceId: 'ws-1', pinned: true },
      expect.any(Object)
    )
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Options for Workspace 1"]')?.click()
    )
    const rename = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
      (item) => item.textContent === 'Rename'
    )
    await act(async () => rename?.click())
    const input = container.querySelector<HTMLInputElement>(
      '[aria-label="Rename workspace Workspace 1"]'
    )!
    expect(input).not.toBeNull()
    await act(async () => typeInto(input, 'Renamed workspace'))
    await act(async () =>
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    )
    expect(state.mockRename).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      name: 'Renamed workspace',
    })
  })

  it('prevents a read-only viewer from renaming while retaining pinning', async () => {
    state.workspaces[0].permissions = 'read'
    await render()
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Options for Workspace 1"]')?.click()
    )
    const rename = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
      (item) => item.textContent === 'Rename'
    )
    expect(rename?.getAttribute('aria-disabled')).toBe('true')
    await act(async () => rename?.click())
    expect(container.querySelector('[aria-label="Rename workspace Workspace 1"]')).toBeNull()
    expect(state.mockRename).not.toHaveBeenCalled()
  })

  it('creates in the current organization through the existing modal and mutation', async () => {
    await render()
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="New workspace"]')?.click()
    )
    const input = document.querySelector<HTMLInputElement>('input[placeholder="Workspace name"]')!
    expect(input).not.toBeNull()
    await act(async () => typeInto(input, 'New team workspace'))
    const create = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === 'Create'
    )
    await act(async () => create?.click())
    expect(state.mockCreate).toHaveBeenCalledWith({ name: 'New team workspace' })
    expect(state.mockPush).toHaveBeenCalledWith('/workspace/ws-new')
  })

  it.each([false, true])(
    'respects creation policy and never creates in a different organization (allowed=%s)',
    async (allowed) => {
      state.canCreate = allowed
      state.createOrganizationId = allowed ? 'another-org' : 'org-1'
      await render()
      const create = container.querySelector<HTMLButtonElement>('[aria-label="New workspace"]')!
      expect(create.disabled).toBe(true)
      await act(async () => create.click())
      expect(document.querySelector('input[placeholder="Workspace name"]')).toBeNull()
      expect(state.mockCreate).not.toHaveBeenCalled()
    }
  )
})

function typeInto(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
