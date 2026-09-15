/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockNavigateToSettings, mockWorkspacePermissions, hostContext } = vi.hoisted(() => ({
  mockNavigateToSettings: vi.fn(),
  hostContext: {
    hostOrganizationId: null as string | null,
    viewer: { isHostOrganizationMember: false },
    features: { organizationSearch: false as boolean | undefined },
  },
  mockWorkspacePermissions: { canAdmin: true, canEdit: true, canRead: true },
}))

vi.mock('@/app/workspace/[workspaceId]/providers/workspace-host-provider', () => ({
  useWorkspaceHostContext: () => hostContext,
}))

const onWorkspaceSwitch = vi.fn()

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn() }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/workspace/ws-emir/home',
}))
vi.mock('@/lib/auth/auth-client', () => ({ useActiveOrganization: () => ({ data: null }) }))
vi.mock('@/hooks/use-settings-navigation', () => ({
  useSettingsNavigation: () => ({
    navigateToSettings: mockNavigateToSettings,
  }),
}))
vi.mock('@/hooks/use-permission-config', () => ({
  usePermissionConfig: () => ({ isInvitationsDisabled: false }),
}))
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  useWorkspacePermissionsContext: () => ({
    userPermissions: mockWorkspacePermissions,
  }),
}))
vi.mock('@/hooks/queries/invitations', () => ({ invitationKeys: { all: ['invitations'] } }))
vi.mock('@/hooks/queries/workspace', () => ({ workspaceKeys: { all: ['workspaces'] } }))

/** Modal/menu siblings are irrelevant to the highlight and drag in heavy trees. */
vi.mock('@/app/workspace/[workspaceId]/components/invite-modal', () => ({
  InviteModal: () => null,
}))
vi.mock(
  '@/app/workspace/[workspaceId]/w/components/sidebar/components/workflow-list/components/context-menu/context-menu',
  () => ({ ContextMenu: () => null })
)
vi.mock(
  '@/app/workspace/[workspaceId]/w/components/sidebar/components/workflow-list/components/delete-modal/delete-modal',
  () => ({ DeleteModal: () => null })
)
vi.mock(
  '@/app/workspace/[workspaceId]/w/components/sidebar/components/workspace-header/components/create-workspace-modal/create-workspace-modal',
  () => ({ CreateWorkspaceModal: () => null })
)
vi.mock(
  '@/app/workspace/[workspaceId]/w/components/sidebar/components/workspace-header/components/pending-invitations/view-invitations-menu-item',
  () => ({ ViewInvitationsMenuItem: () => null })
)
vi.mock(
  '@/app/workspace/[workspaceId]/w/components/sidebar/components/workspace-header/components/pending-invitations/view-invitations-modal',
  () => ({ ViewInvitationsModal: () => null })
)

import { WorkspaceHeader } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workspace-header/workspace-header'

/**
 * `@sim/emcn` is deliberately NOT mocked: the assertion is about the background class
 * `chipVariants` produces, so a stubbed chip would only assert the stub.
 */
const ACTIVE_BG = 'bg-[var(--surface-active)]'

/**
 * At `WORKSPACE_SEARCH_THRESHOLD` (6), so the searchable/keyboard list renders.
 * The current workspace is deliberately NOT first: the highlight is seeded to row 0 on
 * open, so a current workspace sitting at row 0 would mask the double-mark this guards.
 */
const WORKSPACES = [
  { id: 'ws-rvt', name: 'RVT' },
  { id: 'ws-emir', name: "Emir's Workspace" },
  { id: 'ws-acme', name: 'Acme' },
  { id: 'ws-initech', name: 'Initech' },
  { id: 'ws-umbrella', name: 'Umbrella' },
  { id: 'ws-globex', name: 'Globex' },
] as unknown as Parameters<typeof WorkspaceHeader>[0]['workspaces']

/** Pinning reorders the list; these assertions are about the highlight, not the order. */
const NO_PINS: ReadonlySet<string> = new Set()

let container: HTMLDivElement
let root: Root

function render(overrides: Partial<Parameters<typeof WorkspaceHeader>[0]> = {}) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(header(overrides))
  })
}

function header(overrides: Partial<Parameters<typeof WorkspaceHeader>[0]> = {}) {
  return (
    <WorkspaceHeader
      activeWorkspace={{ name: "Emir's Workspace" }}
      workspaceId='ws-emir'
      workspaces={WORKSPACES}
      pinnedWorkspaceIds={NO_PINS}
      onToggleWorkspacePin={() => {}}
      isWorkspacesLoading={false}
      isCreatingWorkspace={false}
      isWorkspaceMenuOpen
      setIsWorkspaceMenuOpen={() => {}}
      onWorkspaceSwitch={onWorkspaceSwitch}
      onCreateWorkspace={async () => {}}
      onRenameWorkspace={async () => {}}
      onDeleteWorkspace={async () => {}}
      isDeletingWorkspace={false}
      onUploadLogo={() => {}}
      onLeaveWorkspace={async () => {}}
      isLeavingWorkspace={false}
      {...overrides}
    />
  )
}

function row(name: string): HTMLElement {
  const found = [...document.querySelectorAll('[data-workspace-row-idx]')].find((el) =>
    el.textContent?.includes(name)
  )
  if (!found) throw new Error(`No workspace row rendered for "${name}"`)
  return found as HTMLElement
}

/**
 * Whether a row is painted with the persistent active fill.
 *
 * Matches an exact class token, never a substring. The inactive chip now hovers to
 * `--surface-hover`, so it no longer carries the active class as a substring — but
 * keep the token match: hover and active are one token apart by design, and a
 * substring check would silently start reporting every row as marked if they ever
 * converge again.
 */
function isMarked(name: string): boolean {
  return [...row(name).querySelectorAll<HTMLElement>('*')].some((el) =>
    el.classList.contains(ACTIVE_BG)
  )
}

/**
 * Types into a React-controlled input. Assigning `.value` directly is ignored: React
 * tracks the previous value on the node, so the change must go through the native
 * setter for its synthetic `onChange` to fire.
 */
function typeInto(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setValue?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

beforeEach(() => {
  vi.clearAllMocks()
  hostContext.hostOrganizationId = null
  hostContext.viewer.isHostOrganizationMember = false
  hostContext.features.organizationSearch = false
  Object.assign(mockWorkspacePermissions, { canAdmin: true, canEdit: true, canRead: true })
  // jsdom implements neither; the component scrolls the active row into view.
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('WorkspaceHeader workspace switcher highlight', () => {
  it.each([false, true])(
    'renders prefetched workspace identity before hydration (collapsed: %s)',
    (isCollapsed) => {
      render({ isWorkspaceMenuOpen: false, isCollapsed })
      const html = renderToString(header({ isWorkspaceMenuOpen: false, isCollapsed }))
      expect(html).toContain(isCollapsed ? 'Expand sidebar' : 'Switch workspace')
      expect(html).not.toContain('animate-pulse')
    }
  )

  it.each([5, 6])('only shows search once there are six workspaces: %i', (count) => {
    render({ workspaces: WORKSPACES.slice(0, count) })
    expect(Boolean(document.querySelector('input[placeholder="Search workspaces..."]'))).toBe(
      count === 6
    )
  })

  it('handles a no-match query without navigating and restores rows when cleared', () => {
    render()
    const search = document.querySelector<HTMLInputElement>(
      'input[placeholder="Search workspaces..."]'
    )!
    act(() => typeInto(search, 'no-such-workspace'))
    expect(document.querySelectorAll('[data-workspace-row-idx]')).toHaveLength(0)
    expect(document.body).toHaveTextContent('No results for "no-such-workspace"')
    act(() => search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(onWorkspaceSwitch).not.toHaveBeenCalled()

    act(() => typeInto(search, '  ACME  '))
    expect(document.querySelectorAll('[data-workspace-row-idx]')).toHaveLength(1)
    expect(isMarked('Acme')).toBe(true)
    act(() => typeInto(search, ''))
    expect(document.querySelectorAll('[data-workspace-row-idx]')).toHaveLength(WORKSPACES.length)
  })

  it('keeps search focused when the pointer crosses a workspace row', () => {
    render()
    const search = document.querySelector<HTMLInputElement>(
      'input[placeholder="Search workspaces..."]'
    )!
    act(() => search.focus())
    const item = row('RVT').querySelector<HTMLElement>('[role="menuitem"]')!
    const pointerMove = new MouseEvent('pointermove', { bubbles: true, cancelable: true })
    Object.defineProperty(pointerMove, 'pointerType', { value: 'mouse' })
    act(() => item.dispatchEvent(pointerMove))
    expect(document.activeElement).toBe(search)
    const pointerOut = new MouseEvent('pointerout', { bubbles: true, cancelable: true })
    Object.defineProperty(pointerOut, 'pointerType', { value: 'mouse' })
    act(() => item.dispatchEvent(pointerOut))
    expect(document.activeElement).toBe(search)
  })

  it('keeps pinned status available to assistive technology', () => {
    render({ pinnedWorkspaceIds: new Set(['ws-rvt']) })
    expect(row('RVT').querySelector('[aria-label="Pinned"]')).toHaveAttribute(
      'aria-hidden',
      'false'
    )
  })

  it('does not open creation when workspace policy disallows it', () => {
    const setIsWorkspaceMenuOpen = vi.fn()
    render({
      workspaceCreationPolicy: { canCreate: false, reason: 'Organization limit reached' },
      setIsWorkspaceMenuOpen,
    })
    const create = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent?.trim() === 'New workspace'
    )!
    expect(create).toHaveAttribute('aria-disabled', 'true')
    act(() => create.click())
    expect(setIsWorkspaceMenuOpen).not.toHaveBeenCalled()
  })

  it.each([
    { role: 'viewer', canAdmin: false, canEdit: false },
    { role: 'editor', canAdmin: false, canEdit: true },
    { role: 'admin', canAdmin: true, canEdit: true },
  ])(
    'only offers workspace invitations to admins, including for $role',
    ({ canAdmin, canEdit }) => {
      Object.assign(mockWorkspacePermissions, { canAdmin, canEdit })
      render()
      const invite = [...document.querySelectorAll('[role="menuitem"]')].find(
        (item) => item.textContent?.trim() === 'Invite teammates'
      )
      expect(Boolean(invite)).toBe(canAdmin)
      expect(container.querySelector('button[aria-label="Switch workspace"]')).not.toBeDisabled()
    }
  )

  it('selects a workspace through the menu keyboard interaction', () => {
    render()
    const item = row('RVT').querySelector<HTMLElement>('[role="menuitem"]')!
    act(() => item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(onWorkspaceSwitch).toHaveBeenCalledOnce()
    expect(onWorkspaceSwitch).toHaveBeenCalledWith(WORKSPACES[0])
  })

  it('opens workspace options without switching workspaces', () => {
    render()
    const options = row('RVT').querySelector<HTMLButtonElement>('[aria-label="Workspace options"]')!
    act(() => {
      options.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
      options.click()
    })
    expect(onWorkspaceSwitch).not.toHaveBeenCalled()
    expect(isMarked('RVT')).toBe(true)
  })

  it('shows the route workspace identity while the switcher list is unavailable', () => {
    render({
      activeWorkspace: { name: 'Brightwave' },
      workspaceId: 'ws-brightwave',
      workspaces: [],
      isWorkspaceMenuOpen: false,
    })

    const switcher = container.querySelector('button[aria-label="Switch workspace"]')
    expect(switcher).toBeDisabled()
    expect(switcher).not.toHaveAttribute('title')
    expect(switcher).toHaveTextContent('Brightwave')
    expect(switcher).toHaveTextContent('B')
    expect(switcher?.querySelector('.animate-pulse')).toBeNull()
  })

  it('leaves Enter unarmed until a cursor is on screen', () => {
    render()

    expect(container.querySelector('button[aria-label="Switch workspace"]')).not.toHaveAttribute(
      'title'
    )

    const search = document.querySelector('input[placeholder="Search workspaces..."]')
    act(() => {
      search?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })

    // The search field is focused on open, so acting on the seeded row here would
    // switch workspace with nothing marked.
    expect(onWorkspaceSwitch).not.toHaveBeenCalled()
  })

  it('arms Enter on the top result once the user types', () => {
    render()

    const search = document.querySelector(
      'input[placeholder="Search workspaces..."]'
    ) as HTMLInputElement | null
    act(() => {
      if (search) typeInto(search, 'Acme')
    })
    // Typing counts as keyboard intent, so the target is visible before Enter fires.
    expect(isMarked('Acme')).toBe(true)

    act(() => {
      search?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(onWorkspaceSwitch).toHaveBeenCalledWith(expect.objectContaining({ id: 'ws-acme' }))
  })

  it('marks only the current workspace when the menu opens', () => {
    render()

    expect(isMarked("Emir's Workspace")).toBe(true)
    // Regression: the keyboard cursor used to be seeded to row 0 on open, so a second
    // row was marked in the same colour as hover before any interaction.
    expect(isMarked('RVT')).toBe(false)
  })

  it('does not leave a highlight behind when the pointer moves across a row', () => {
    render()

    act(() => {
      row('RVT').dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
    })

    // The pointer has moved on; nothing should be painted as if still hovered.
    // Real CSS :hover handles the row actually under the cursor and leaves with it.
    expect(isMarked('RVT')).toBe(false)
    expect(isMarked("Emir's Workspace")).toBe(true)
  })

  it('shows the cursor once the user navigates by keyboard', () => {
    render()

    const search = document.querySelector('input[placeholder="Search workspaces..."]')
    expect(search).not.toBeNull()
    act(() => {
      search?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    })

    // ArrowUp from the seeded first row wraps to the last. Asserting on Globex, not on
    // the current workspace: the current one carries its own `isActive` fill, so it
    // stays marked either way and would prove nothing about the cursor being painted.
    expect(isMarked('Globex')).toBe(true)
  })

  it('drops the keyboard cursor again as soon as the pointer moves', () => {
    render()

    const search = document.querySelector('input[placeholder="Search workspaces..."]')
    act(() => {
      search?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    })
    expect(isMarked('Globex')).toBe(true)

    act(() => {
      row('Acme').dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
    })

    // Back in pointer mode: the cursor is gone and the row just crossed is unmarked,
    // leaving only the current workspace's own fill.
    expect(isMarked('Globex')).toBe(false)
    expect(isMarked('Acme')).toBe(false)
    expect(isMarked("Emir's Workspace")).toBe(true)
  })
})

describe('WorkspaceHeader context navigation', () => {
  it('links to the current host organization for enrolled members', () => {
    hostContext.hostOrganizationId = 'host-org'
    hostContext.viewer.isHostOrganizationMember = true
    hostContext.features.organizationSearch = true
    render()
    expect(document.querySelector('a[href="/o/host-org"]')).toHaveTextContent(
      'Back to organization'
    )
  })

  it.each([
    { org: null, member: true, enabled: true },
    { org: 'host-org', member: false, enabled: true },
    { org: 'host-org', member: true, enabled: false },
    { org: 'host-org', member: true, enabled: undefined },
  ])('hides inaccessible organization navigation: %j', ({ org, member, enabled }) => {
    hostContext.hostOrganizationId = org
    hostContext.viewer.isHostOrganizationMember = member
    hostContext.features.organizationSearch = enabled
    render()
    expect(document.querySelector('a[href^="/o/"]')).toBeNull()
  })

  it('keeps settings in the profile menu instead of duplicating it in the switcher', () => {
    render()
    expect(document.querySelector('a[href="/workspace/ws-emir/settings/teammates"]')).toBeNull()
  })
})
