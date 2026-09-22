/** @vitest-environment jsdom */
import { act } from 'react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ groups: vi.fn() }))

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace' }),
  usePathname: () => '/settings/access-control',
}))
vi.mock('@/ee/access-control/components/group-detail', () => ({ GroupDetail: () => null }))
vi.mock('@/ee/access-control/hooks/permission-groups', () => ({
  useCreatePermissionGroup: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useOrganizationWorkspaces: () => ({ data: [], isPending: false }),
  usePermissionGroups: mocks.groups,
  useUserPermissionConfig: () => ({ data: { entitled: true }, isPending: false }),
}))
vi.mock('@/hooks/queries/organization', () => ({
  useOrganizationBilling: () => ({ data: undefined, isPending: false }),
}))

import { SettingsHeaderProvider, SettingsHeaderShell } from '@/components/settings/settings-header'
import { SettingsSectionProvider } from '@/components/settings/settings-panel'
import { AccessControl } from '@/ee/access-control/components/access-control'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mocks.groups.mockReturnValue({ data: [], isPending: false })
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

function render(searchParams = '') {
  act(() =>
    root.render(
      <NuqsTestingAdapter searchParams={searchParams} hasMemory>
        <SettingsHeaderProvider>
          <SettingsHeaderShell>
            <SettingsSectionProvider
              section='access-control'
              meta={{
                label: 'Permission groups',
                description: 'Manage permission groups across your organization.',
              }}
            >
              <AccessControl
                isOrganizationAdmin
                organizationId='organization'
                requestsHref='/workspace/workspace/settings/requests'
              />
            </SettingsSectionProvider>
          </SettingsHeaderShell>
        </SettingsHeaderProvider>
      </NuqsTestingAdapter>
    )
  )
}

describe('permission groups search layout', () => {
  it('links to the shared Requests destination without exposing a duplicate review tab', () => {
    render('?search=Design')
    const input = container.querySelector<HTMLInputElement>('input')!
    expect(input.value).toBe('Design')
    expect(input.placeholder).toBe('Search permission groups...')
    expect(container.querySelector('[aria-label="Access Control views"]')).toBeNull()
    expect(
      container.querySelector('a[href="/workspace/workspace/settings/requests"]')?.textContent
    ).toBe('Review requests')
  })

  it('retains permission group search while the list is loading or fails', () => {
    mocks.groups.mockReturnValue({ isPending: true })
    render('?search=Design')
    const input = container.querySelector<HTMLInputElement>('input')!
    expect(input.value).toBe('Design')
    expect(input.disabled).toBe(true)
    mocks.groups.mockReturnValue({
      isPending: false,
      error: new Error('Groups unavailable'),
      isFetching: false,
      refetch: vi.fn(),
    })
    render('?search=Design')
    expect(container.querySelector('input')).toBe(input)
    expect(input.value).toBe('Design')
    expect(container.textContent).toContain('Groups unavailable')
  })
})
