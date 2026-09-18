/** @vitest-environment jsdom */
import { act } from 'react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ groups: vi.fn(), requests: vi.fn() }))

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace' }),
  usePathname: () => '/settings/access-control',
}))
vi.mock('@/ee/access-control/components/group-detail', () => ({ GroupDetail: () => null }))
vi.mock('@/components/access-requests/access-request-review', () => ({
  AccessRequestReview: () => null,
}))
vi.mock('@/ee/access-control/hooks/permission-groups', () => ({
  useCreatePermissionGroup: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useOrganizationWorkspaces: () => ({ data: [], isPending: false }),
  usePermissionGroups: mocks.groups,
  useUserPermissionConfig: () => ({ data: { entitled: true }, isPending: false }),
}))
vi.mock('@/hooks/queries/organization', () => ({
  useOrganizationBilling: () => ({ data: undefined, isPending: false }),
}))
vi.mock('@/hooks/queries/access-requests', () => ({
  ACCESS_REQUEST_PAGE_SIZE: 25,
  useOrganizationAccessRequests: mocks.requests,
  useAccessRequestSettings: () => ({ data: { allowRequests: true }, isPending: false }),
  useUpdateAccessRequestSettings: () => ({ mutate: vi.fn(), isPending: false }),
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
  mocks.requests.mockReturnValue({ data: { requests: [], hasMore: false }, isPending: false })
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
              <AccessControl isOrganizationAdmin organizationId='organization' />
            </SettingsSectionProvider>
          </SettingsHeaderShell>
        </SettingsHeaderProvider>
      </NuqsTestingAdapter>
    )
  )
}

function switchView(value: string) {
  const button = container.querySelector<HTMLButtonElement>(
    `[aria-label="Access Control views"] [role="radio"][value="${value}"]`
  )
  expect(button).not.toBeNull()
  act(() => button!.click())
}

describe('permission groups search layout', () => {
  it('resets pagination and hides stale results while a new request search is debounced', async () => {
    vi.useFakeTimers()
    mocks.requests.mockReturnValue({
      data: {
        requests: [
          {
            id: 'request',
            targetLabel: 'Previous result',
            requester: { name: 'Member' },
            status: 'pending',
            createdAt: '2026-09-01T00:00:00Z',
          },
        ],
        hasMore: true,
      },
      isPending: false,
    })
    render('?access-view=requests&request-page=2')
    expect(mocks.requests).toHaveBeenLastCalledWith('organization', 50, 'pending', '')
    const input = container.querySelector<HTMLInputElement>('input')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        input,
        'Tables'
      )
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(container.textContent).toContain('Loading requests...')
    expect(container.textContent).not.toContain('Previous result')
    expect(container.textContent).not.toContain('Page 3')
    await act(async () => vi.advanceTimersByTimeAsync(500))
    expect(mocks.requests).toHaveBeenLastCalledWith('organization', 0, 'pending', 'Tables')
  })
  it('keeps the same search input above the switch and restores each view’s search', () => {
    render('?search=Design&request-search=Tables')
    const input = container.querySelector<HTMLInputElement>('input')!
    const viewSwitch = container.querySelector('[aria-label="Access Control views"]')!
    expect(input.value).toBe('Design')
    expect(
      input.compareDocumentPosition(viewSwitch) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()

    switchView('requests')
    expect(container.querySelector('input')).toBe(input)
    expect(input.placeholder).toBe('Search requests...')
    expect(input.value).toBe('Tables')
    expect(input.maxLength).toBe(200)
    expect(mocks.requests).toHaveBeenLastCalledWith('organization', 0, 'pending', 'Tables')
    expect(container.textContent).toContain('No requests found matching "Tables"')

    switchView('groups')
    expect(container.querySelector('input')).toBe(input)
    expect(input.value).toBe('Design')
    expect(input.placeholder).toBe('Search permission groups...')
    expect(input.hasAttribute('maxlength')).toBe(false)
  })

  it('retains search when either list is loading or fails', () => {
    mocks.groups.mockReturnValue({ isPending: true })
    render()
    const input = container.querySelector<HTMLInputElement>('input')!
    expect(input.disabled).toBe(true)
    mocks.requests.mockReturnValue({ isPending: true })
    switchView('requests')
    expect(container.querySelector('input')).toBe(input)
    expect(input.disabled).toBe(false)
    expect(container.textContent).toContain('Loading requests...')

    mocks.groups.mockReturnValue({
      isPending: false,
      error: new Error('Groups unavailable'),
      isFetching: false,
      refetch: vi.fn(),
    })
    switchView('groups')
    expect(container.querySelector('input')).toBe(input)
    expect(container.textContent).toContain('Groups unavailable')

    mocks.requests.mockReturnValue({
      isPending: false,
      isError: true,
      error: new Error('Requests unavailable'),
      isFetching: false,
      refetch: vi.fn(),
    })
    switchView('requests')
    expect(container.querySelector('input')).toBe(input)
    expect(container.textContent).toContain('Requests unavailable')
  })
})
