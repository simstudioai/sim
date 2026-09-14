/**
 * @vitest-environment jsdom
 */
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockNavigate, mockPush, context } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockPush: vi.fn(),
  context: {
    organization: { id: 'org-1' },
  },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/o/org-1/home',
}))
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
        let prevented = false
        onNavigate?.({
          preventDefault: () => {
            prevented = true
          },
        })
        if (!prevented) mockNavigate(props.href)
      }}
    />
  ),
}))
vi.mock('@/lib/auth/sign-out', () => ({ signOutAndRedirect: vi.fn() }))
vi.mock('@/lib/desktop', () => ({ getDesktopUpdates: () => null }))
vi.mock('@/hooks/use-desktop-update-state', () => ({
  useDesktopUpdateState: () => ({ status: 'idle' }),
}))
vi.mock('@/hooks/queries/user-profile', () => ({
  useUserProfile: () => ({ data: { id: 'user-1', name: 'Ada', email: 'ada@example.com' } }),
}))
vi.mock('@/app/o/[organizationId]/providers/organization-provider', () => ({
  useOrganizationContext: () => context,
}))
vi.mock('@/app/workspace/[workspaceId]/w/components/sidebar/components', () => ({
  SidebarTooltip: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('@/components/icons', () => ({
  SlackIcon: () => <svg />,
}))

import { OrganizationFooter } from '@/app/o/[organizationId]/components/organization-sidebar/components/organization-footer/organization-footer'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.clearAllMocks()
  useSettingsDirtyStore.getState().reset()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  useSettingsDirtyStore.getState().reset()
  vi.unstubAllGlobals()
})

async function openProfileMenu() {
  await act(async () => {
    root.render(
      <OrganizationFooter
        showDivider={false}
        isCollapsed={false}
        showCollapsedTooltips={false}
        onOpenDocs={() => {}}
        onJoinSlack={() => {}}
        onContactSupport={() => {}}
      />
    )
  })
  const trigger = container.querySelector<HTMLButtonElement>('[data-item-id="profile"]')
  if (!trigger) throw new Error('Profile menu is missing')
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
  })
}

async function selectSettings() {
  await openProfileMenu()
  const link = document.querySelector<HTMLAnchorElement>('a[href="/o/org-1/settings/general"]')
  if (!link) throw new Error('Settings link is missing')
  await act(async () => link.click())
}

describe('OrganizationFooter settings navigation', () => {
  it('keeps only Settings and Sign out in the organization profile menu', async () => {
    await openProfileMenu()
    expect(
      [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)
    ).toEqual(['Settings', 'Sign out'])
    expect(document.querySelector('[role="separator"]')).toBeNull()
  })

  it('navigates immediately when settings are clean', async () => {
    await selectSettings()
    expect(mockPush).toHaveBeenCalledWith('/o/org-1/settings/general')
    expect(useSettingsDirtyStore.getState().pendingLeave).toBeNull()
  })

  it('waits for discard confirmation before leaving a dirty form', async () => {
    useSettingsDirtyStore.getState().setDirty(true)
    await selectSettings()
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
    expect(useSettingsDirtyStore.getState().pendingLeave).not.toBeNull()

    act(() => useSettingsDirtyStore.getState().confirmLeave())
    expect(mockPush).toHaveBeenCalledWith('/o/org-1/settings/general')
  })

  it('keeps the draft when leaving is cancelled', async () => {
    useSettingsDirtyStore.getState().setDirty(true)
    await selectSettings()
    act(() => useSettingsDirtyStore.getState().cancelLeave())
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
    expect(useSettingsDirtyStore.getState().isDirty).toBe(true)
  })

  it('blocks navigation while saving without queuing a later redirect', async () => {
    useSettingsDirtyStore.getState().setNavigationBlocked(true)
    await selectSettings()
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
    expect(useSettingsDirtyStore.getState().pendingLeave).toBeNull()
  })
})
