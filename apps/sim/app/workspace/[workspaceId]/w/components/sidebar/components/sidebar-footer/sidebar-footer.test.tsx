/**
 * @vitest-environment jsdom
 */
import { act, type ComponentProps } from 'react'
import { Building, Credit, Trash, Users } from '@sim/emcn/icons'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const desktopMocks = vi.hoisted(() => ({
  getState: vi.fn(),
  onState: vi.fn(),
  check: vi.fn(),
  install: vi.fn(),
  listener: null as ((state: unknown) => void) | null,
  unsubscribe: vi.fn(),
}))

const authMocks = vi.hoisted(() => ({ signOut: vi.fn(), userId: 'user-1' }))
vi.mock('@/lib/auth/sign-out', () => ({ signOutAndRedirect: authMocks.signOut }))
vi.mock('next/link', () => ({
  default: ({
    onNavigate,
    prefetch: _prefetch,
    ...props
  }: ComponentProps<'a'> & {
    prefetch?: boolean
    onNavigate?: (event: { preventDefault: () => void }) => void
  }) => (
    <a
      {...props}
      href={props.href}
      onClick={(event) => {
        event.preventDefault()
        onNavigate?.({ preventDefault: () => {} })
      }}
    />
  ),
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
  useUserProfile: () => ({ data: { id: authMocks.userId, name: 'Ada', email: 'ada@sim.ai' } }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/workspace/ws-emir/home',
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

import { ANONYMOUS_USER_ID } from '@/lib/auth/constants'
import { SidebarFooter } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/sidebar-footer/sidebar-footer'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

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
        showDivider={false}
        isCollapsed={false}
        showCollapsedTooltips={false}
        accountSettingsHref='/workspace/workspace-1/settings/general'
        onOpenAccountSettings={() => {}}
        navigationLinks={[
          {
            label: 'Subscription',
            icon: Credit,
            href: '/workspace/workspace-1/settings/billing',
            onNavigate: () => {},
          },
          {
            label: 'Teammates',
            icon: Users,
            href: '/workspace/workspace-1/settings/teammates',
            onNavigate: () => {},
          },
          {
            label: 'Recently deleted',
            icon: Trash,
            href: '/workspace/workspace-1/settings/recently-deleted',
            onNavigate: () => {},
          },
        ]}
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
  authMocks.userId = 'user-1'
  useSettingsDirtyStore.getState().reset()
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
  it('keeps the familiar Settings entry in the profile menu', async () => {
    await renderFooter({ status: 'idle' })
    openProfileMenu()
    expect(
      [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)
    ).toEqual(['Settings', 'Subscription', 'Teammates', 'Recently deleted', 'Sign out'])
    expect(document.querySelector('[role="separator"]')).toBeNull()
    expect(menuItem('Settings')).toHaveAttribute('href', '/workspace/workspace-1/settings/general')
  })

  it('guards returning to the organization when settings are unsaved', async () => {
    const onNavigate = vi.fn()
    await renderFooter(
      { status: 'idle' },
      {
        navigationLinks: [{ label: 'Organization', icon: Building, href: '/o/org-1', onNavigate }],
      }
    )
    useSettingsDirtyStore.getState().setDirty(true)
    openProfileMenu()
    expect(menuItem('Organization')).toHaveAttribute('href', '/o/org-1')
    act(() => menuItem('Organization').click())
    expect(onNavigate).not.toHaveBeenCalled()
    act(() => useSettingsDirtyStore.getState().confirmLeave())
    expect(onNavigate).toHaveBeenCalledOnce()
  })

  it('uses the shared sign-out flow', async () => {
    await renderFooter({ status: 'idle' })
    openProfileMenu()
    await act(async () => menuItem('Sign out').click())
    expect(authMocks.signOut).toHaveBeenCalledOnce()
  })

  it('defers sign-out while settings are unsaved', async () => {
    await renderFooter({ status: 'idle' })
    useSettingsDirtyStore.getState().setDirty(true)
    openProfileMenu()
    await act(async () => menuItem('Sign out').click())
    expect(authMocks.signOut).not.toHaveBeenCalled()
    act(() => useSettingsDirtyStore.getState().confirmLeave())
    expect(authMocks.signOut).toHaveBeenCalledOnce()
  })

  it('hides sign-out for auth-disabled deployments', async () => {
    authMocks.userId = ANONYMOUS_USER_ID
    await renderFooter({ status: 'idle' })
    openProfileMenu()
    expect(document.querySelector('[role="menu"]')).not.toHaveTextContent('Sign out')
    expect(document.querySelector('[role="separator"]')).toBeNull()
  })

  it('opens the shared support flow', async () => {
    const onContactSupport = vi.fn()
    await renderFooter({ status: 'idle' }, { onContactSupport })
    openHelpMenu()
    act(() => menuItem('Contact support').click())
    expect(onContactSupport).toHaveBeenCalledOnce()
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
