/**
 * @vitest-environment jsdom
 */
import { act, type ComponentProps } from 'react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@sim/emcn'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockList, mockPush, mockRefetch } = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockPush: vi.fn(),
  mockRefetch: vi.fn(),
}))

vi.mock('@/hooks/queries/organization', () => ({ useOrganizationList: mockList }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }))
vi.mock('next/link', () => ({
  default: ({
    href,
    onNavigate,
    onClick,
    ...props
  }: ComponentProps<'a'> & { onNavigate?: (event: { preventDefault: () => void }) => void }) => (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event)
        event.preventDefault()
        onNavigate?.({ preventDefault: () => event.preventDefault() })
      }}
    />
  ),
}))

import { OrganizationMenuItems } from '@/components/organization-menu-items/organization-menu-items'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  useSettingsDirtyStore.getState().reset()
  mockList.mockReturnValue({
    data: [
      { id: 'org-a', name: 'Organization A' },
      { id: 'org-b', name: 'Organization B' },
    ],
    isError: false,
    isLoading: false,
    isFetching: false,
    refetch: mockRefetch,
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  useSettingsDirtyStore.getState().reset()
  vi.clearAllMocks()
})

async function renderMenu(currentOrganizationId?: string) {
  await act(async () =>
    root.render(
      <DropdownMenu open modal={false}>
        <DropdownMenuTrigger>Switch context</DropdownMenuTrigger>
        <DropdownMenuContent>
          <OrganizationMenuItems currentOrganizationId={currentOrganizationId} />
        </DropdownMenuContent>
      </DropdownMenu>
    )
  )
}

describe('OrganizationMenuItems', () => {
  it('links to actual memberships without requiring a workspace organization', async () => {
    await renderMenu()
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a'))
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/o/org-a/home',
      '/o/org-b/home',
    ])
  })

  it('omits the current organization from the organization switcher', async () => {
    await renderMenu('org-a')
    expect(document.querySelector('a')?.getAttribute('href')).toBe('/o/org-b/home')
    expect(document.body.textContent).not.toContain('Organization A')
  })

  it('adds no dead-end entry for users with no memberships', async () => {
    mockList.mockReturnValue({ data: [], isError: false, isLoading: false })
    await renderMenu()
    expect(document.querySelector('a')).toBeNull()
    expect(document.body.textContent).not.toContain('Organizations')
  })

  it('offers retry when membership loading fails', async () => {
    mockList.mockReturnValue({ isError: true, isFetching: false, refetch: mockRefetch })
    await renderMenu()
    const retry = document.querySelector<HTMLElement>('[role="menuitem"]')
    expect(retry?.textContent).toBe('Retry loading organizations')
    await act(async () => retry?.click())
    expect(mockRefetch).toHaveBeenCalledOnce()
  })

  it('uses the shared discard guard before leaving dirty settings', async () => {
    await renderMenu()
    useSettingsDirtyStore.getState().setDirty(true)
    await act(async () => document.querySelector<HTMLAnchorElement>('a')?.click())
    expect(mockPush).not.toHaveBeenCalled()
    expect(useSettingsDirtyStore.getState().pendingLeave).not.toBeNull()
    act(() => useSettingsDirtyStore.getState().confirmLeave())
    expect(mockPush).toHaveBeenCalledWith('/o/org-a/home')
  })

  it('does not navigate during a settings mutation that blocks leaving', async () => {
    await renderMenu()
    useSettingsDirtyStore.getState().setNavigationBlocked(true)
    await act(async () => document.querySelector<HTMLAnchorElement>('a')?.click())
    expect(mockPush).not.toHaveBeenCalled()
    expect(useSettingsDirtyStore.getState().pendingLeave).toBeNull()
  })
})
