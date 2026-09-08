/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const desktopMocks = vi.hoisted(() => ({
  getState: vi.fn(),
  onState: vi.fn(),
  check: vi.fn(),
  install: vi.fn(),
  listener: null as ((state: unknown) => void) | null,
  unsubscribe: vi.fn(),
}))

const { hostContext } = vi.hoisted(() => ({
  hostContext: {
    hostOrganizationId: null as string | null,
    viewer: { isHostOrganizationMember: false },
  },
}))

vi.mock('@/lib/desktop', () => ({
  getDesktopUpdates: () => ({
    getState: desktopMocks.getState,
    onState: desktopMocks.onState,
    check: desktopMocks.check,
    install: desktopMocks.install,
  }),
}))
vi.mock('@/hooks/queries/user-profile', () => ({
  useUserProfile: () => ({ data: { id: 'user-1', name: 'Ada', email: 'ada@sim.ai' } }),
}))
vi.mock('@/lib/auth/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'user-1' } } }),
}))
vi.mock('@/lib/billing/workspace-permissions', () => ({
  canViewWorkspaceBillingSettings: () => true,
}))
/** Billing routes the invitations-disabled row to Subscription; read at render time. */
beforeAll(() => setEnvFlags({ isBillingEnabled: true }))
afterAll(resetEnvFlagsMock)
vi.mock('@/lib/workspaces/colors', () => ({ getUserColor: () => '#000000' }))
vi.mock('@/hooks/use-workspace-invite-policy', () => ({
  useWorkspaceInvitePolicy: () => ({ isInvitationsDisabled: false }),
}))
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-host-provider', () => ({
  useWorkspaceHostContext: () => hostContext,
}))
vi.mock(
  '@/app/workspace/[workspaceId]/w/components/sidebar/components/sidebar-tooltip/sidebar-tooltip',
  () => ({
    SidebarTooltip: ({ children }: { children: React.ReactNode }) => children,
  })
)
vi.mock('@/components/icons', () => ({
  SlackIcon: ({ className }: { className?: string }) => <svg className={className} />,
}))

import { SidebarFooter } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/sidebar-footer/sidebar-footer'

let container: HTMLDivElement
let root: Root

async function renderFooter(
  initialState: Record<string, unknown>,
  overrides: Partial<Parameters<typeof SidebarFooter>[0]> = {}
) {
  desktopMocks.getState.mockResolvedValue(initialState)
  await act(async () => {
    root.render(
      <SidebarFooter
        workspaceId='workspace-1'
        showDivider={false}
        isCollapsed={false}
        showCollapsedTooltips={false}
        getSettingsHref={(section) => `/workspace/workspace-1/settings/${section}`}
        onOpenSettings={() => {}}
        onOpenDocs={() => {}}
        onJoinSlack={() => {}}
        onContactSupport={() => {}}
        {...overrides}
      />
    )
  })
}

function helpTrigger(): HTMLButtonElement {
  const trigger = container.querySelector<HTMLButtonElement>('[data-item-id="help"]')
  if (!trigger) throw new Error('Help trigger was not rendered')
  return trigger
}

function profileTrigger(): HTMLButtonElement {
  const trigger = container.querySelector<HTMLButtonElement>('[data-item-id="profile"]')
  if (!trigger) throw new Error('Profile trigger was not rendered')
  return trigger
}

function openProfileMenu() {
  act(() => {
    profileTrigger().dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, button: 0, ctrlKey: false })
    )
  })
}

function openHelpMenu() {
  act(() => {
    helpTrigger().dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, button: 0, ctrlKey: false })
    )
  })
}

function menuItem(label: string): HTMLElement {
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (candidate) => candidate.textContent === label
  )
  if (!item) throw new Error(`Menu item "${label}" was not rendered`)
  return item
}

beforeEach(() => {
  vi.clearAllMocks()
  hostContext.hostOrganizationId = null
  hostContext.viewer.isHostOrganizationMember = false
  desktopMocks.listener = null
  desktopMocks.onState.mockImplementation((listener) => {
    desktopMocks.listener = listener
    return desktopMocks.unsubscribe
  })
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('SidebarFooter', () => {
  it('links members back to the organization hosting the current workspace', async () => {
    hostContext.hostOrganizationId = 'host-org'
    hostContext.viewer.isHostOrganizationMember = true
    await renderFooter({ status: 'idle' })

    openProfileMenu()

    expect(menuItem('Organization')).toHaveAttribute('href', '/o/host-org')
  })

  it.each([null, 'host-org'])('hides Organization without host membership (%s)', async (orgId) => {
    hostContext.hostOrganizationId = orgId
    await renderFooter({ status: 'idle' })

    openProfileMenu()

    expect(document.querySelector('[role="menu"]')).not.toHaveTextContent('Organization')
  })

  it('keeps the overflow tooltip disabled while the collapsed tooltip still owns the trigger', async () => {
    await renderFooter({ status: 'idle' }, { isCollapsed: false, showCollapsedTooltips: true })
    const label = profileTrigger().querySelector<HTMLElement>('[data-overflow-text]')
    if (!label) throw new Error('Profile label was not rendered')
    Object.defineProperties(label, {
      clientWidth: { configurable: true, value: 40 },
      scrollWidth: { configurable: true, value: 80 },
    })

    act(() => {
      label.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    })

    expect(document.querySelector('[data-native-surface-overlay]')).toBeNull()
  })

  it('renders profile settings destinations with native link semantics', async () => {
    await renderFooter({ status: 'idle' })

    openProfileMenu()

    expect(menuItem('Settings')).toHaveAttribute('href', '/workspace/workspace-1/settings/general')
    expect(menuItem('Subscription')).toHaveAttribute(
      'href',
      '/workspace/workspace-1/settings/billing'
    )
  })

  it('keeps the ordinary help treatment when no update is available', async () => {
    await renderFooter({ status: 'idle' })

    expect(helpTrigger()).toHaveAttribute('aria-label', 'Help')
    expect(helpTrigger()).not.toHaveClass('bg-[var(--text-primary)]')
    expect(helpTrigger()).toHaveClass('h-[30px]', 'px-2')
    expect(helpTrigger().querySelector('circle')).toBeInTheDocument()
    openHelpMenu()
    expect(document.querySelector('[role="menu"]')).not.toHaveTextContent('Update')
    expect(menuItem('Docs')).toBeVisible()
  })

  it('replaces Help with a same-size primary update icon and starts it from the same menu', async () => {
    await renderFooter({ status: 'available', version: '1.4.0' })

    expect(helpTrigger()).toHaveAttribute('aria-label', 'Help, update available')
    expect(helpTrigger()).toHaveClass('h-[30px]', 'px-2')
    expect(helpTrigger()).not.toHaveClass('bg-[var(--text-primary)]')
    expect(helpTrigger().querySelector('circle')).not.toBeInTheDocument()
    expect(helpTrigger().querySelector('div')).toHaveClass(
      'size-[17px]',
      'rounded-full',
      'bg-[var(--text-primary)]'
    )
    expect(helpTrigger().querySelector('svg')).toHaveClass('size-[11px]')
    expect(helpTrigger().querySelector('svg')).toHaveAttribute('viewBox', '-1.75 -1.75 24 24')
    openHelpMenu()
    expect(menuItem('Update').querySelector('img')).toHaveAttribute(
      'src',
      '/favicon/favicon-32x32.png'
    )
    act(() => menuItem('Update').click())

    expect(desktopMocks.check).toHaveBeenCalledTimes(1)
    expect(desktopMocks.install).not.toHaveBeenCalled()
  })

  it('uses a collapsed-sidebar-safe element for the update icon', async () => {
    await renderFooter(
      { status: 'available', version: '1.4.0' },
      { isCollapsed: true, showCollapsedTooltips: true }
    )

    expect(helpTrigger().querySelector('div')).toHaveClass('size-[17px]')
    expect(helpTrigger().querySelector('span')).toBeNull()
  })

  it('turns the menu action into restart-and-install when the update is ready', async () => {
    await renderFooter({ status: 'idle' })

    act(() => {
      desktopMocks.listener?.({ status: 'ready', version: '1.4.0' })
    })
    expect(helpTrigger().querySelector('div')).toHaveClass('bg-[var(--text-primary)]')
    openHelpMenu()
    act(() => menuItem('Restart to update').click())

    expect(desktopMocks.install).toHaveBeenCalledTimes(1)
    expect(desktopMocks.check).not.toHaveBeenCalled()
  })
})
