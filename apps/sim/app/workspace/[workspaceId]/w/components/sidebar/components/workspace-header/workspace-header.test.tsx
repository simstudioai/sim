/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockNavigateToSettings } = vi.hoisted(() => ({ mockNavigateToSettings: vi.fn() }))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn() }),
}))
vi.mock('@/lib/auth/auth-client', () => ({ useActiveOrganization: () => ({ data: null }) }))
vi.mock('@/hooks/use-settings-navigation', () => ({
  useSettingsNavigation: () => ({ navigateToSettings: mockNavigateToSettings }),
}))
vi.mock('@/hooks/use-permission-config', () => ({
  usePermissionConfig: () => ({ isInvitationsDisabled: false }),
}))
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  useWorkspacePermissionsContext: () => ({
    userPermissions: { canAdmin: true, canEdit: true, canRead: true },
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
 * Above `WORKSPACE_SEARCH_THRESHOLD` (3), so the searchable/keyboard list renders.
 * The current workspace is deliberately NOT first: the highlight is seeded to row 0 on
 * open, so a current workspace sitting at row 0 would mask the double-mark this guards.
 */
const WORKSPACES = [
  { id: 'ws-rvt', name: 'RVT' },
  { id: 'ws-emir', name: "Emir's Workspace" },
  { id: 'ws-acme', name: 'Acme' },
  { id: 'ws-globex', name: 'Globex' },
] as unknown as Parameters<typeof WorkspaceHeader>[0]['workspaces']

let container: HTMLDivElement
let root: Root

function render() {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(
      <WorkspaceHeader
        activeWorkspace={{ name: "Emir's Workspace" }}
        workspaceId='ws-emir'
        workspaces={WORKSPACES}
        isWorkspacesLoading={false}
        isCreatingWorkspace={false}
        isWorkspaceMenuOpen
        setIsWorkspaceMenuOpen={() => {}}
        onWorkspaceSwitch={() => {}}
        onCreateWorkspace={async () => {}}
        onRenameWorkspace={async () => {}}
        onDeleteWorkspace={async () => {}}
        isDeletingWorkspace={false}
        onUploadLogo={() => {}}
        onLeaveWorkspace={async () => {}}
        isLeavingWorkspace={false}
      />
    )
  })
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
 * Matches an exact class token, never a substring: the inactive chip carries
 * `hover-hover:bg-[var(--surface-active)]`, which *contains* the active class, so a
 * substring check reports every row as marked.
 */
function isMarked(name: string): boolean {
  return [...row(name).querySelectorAll<HTMLElement>('*')].some((el) =>
    el.classList.contains(ACTIVE_BG)
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  // jsdom implements neither; the component scrolls the active row into view.
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('WorkspaceHeader workspace switcher highlight', () => {
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
