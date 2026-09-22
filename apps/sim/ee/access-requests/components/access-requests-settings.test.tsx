/**
 * @vitest-environment jsdom
 */
import { act, type ComponentProps } from 'react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsHeaderProvider, SettingsHeaderShell } from '@/components/settings/settings-header'
import { AccessRequestsSettings } from '@/ee/access-requests/components/access-requests-settings'

const mocks = vi.hoisted(() => ({
  mine: vi.fn(),
  discovery: vi.fn(),
  cancel: vi.fn(),
  workspace: vi.fn(),
  hosted: true,
  review: vi.fn(),
  push: vi.fn(),
  url: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
  usePathname: () => '/workspace/workspace/settings/requests',
}))
vi.mock('@/ee/access-requests/components/organization-access-requests', () => ({
  OrganizationAccessRequests: mocks.review,
}))
vi.mock('@/lib/core/config/deployment-shape', () => ({
  useDeploymentShape: () => ({ hosted: mocks.hosted }),
}))
vi.mock('@/hooks/queries/workspace-host', () => ({
  useWorkspaceHostContextQuery: mocks.workspace,
}))
vi.mock('@/hooks/queries/access-requests', () => ({
  ACCESS_REQUEST_PAGE_SIZE: 25,
  useMyAccessRequests: mocks.mine,
  useDiscoverAccessRequests: mocks.discovery,
  useCancelAccessRequest: mocks.cancel,
}))
const request = {
  id: 'request',
  targetLabel: 'Slack',
  createdAt: '2026-09-15T12:00:00Z',
  status: 'pending',
  reason: 'A detailed explanation kept out of the list.',
  decisionReason: null,
}
const scope = { kind: 'workspace', workspaceId: 'workspace' } as const
const successful = (requests: unknown[]) => ({
  data: { requests, hasMore: false, total: requests.length },
  isSuccess: true,
  isPending: false,
  isError: false,
  isFetching: false,
})

describe('compact requester history', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.hosted = true
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mocks.mine.mockReturnValue(successful([request]))
    mocks.discovery.mockReturnValue({
      data: { enabled: true, organizationId: 'organization', entries: [], hasMore: false },
      isSuccess: true,
    })
    mocks.workspace.mockReturnValue({
      data: { workspace: { id: 'workspace', name: 'Design' }, hostOrganizationId: 'organization' },
      isSuccess: true,
    })
    mocks.cancel.mockReturnValue({ mutate: vi.fn(), isPending: false, error: null })
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })
  const render = (
    searchParams = '',
    props: Partial<ComponentProps<typeof AccessRequestsSettings>> = {}
  ) =>
    act(() =>
      root.render(
        <NuqsTestingAdapter hasMemory searchParams={searchParams} onUrlUpdate={mocks.url}>
          <SettingsHeaderProvider>
            <SettingsHeaderShell>
              <AccessRequestsSettings scope={scope} {...props} />
            </SettingsHeaderShell>
          </SettingsHeaderProvider>
        </NuqsTestingAdapter>
      )
    )

  it('keeps reasons and cancellation out of the list', () => {
    render()
    expect(container.textContent).toContain('Slack')
    expect(container.textContent).not.toContain(request.reason)
    expect(container.textContent).not.toContain('Cancel')
    expect(container.querySelector('[aria-label="View request for Slack"]')).not.toBeNull()
  })

  it('uses organization scope inside the organization shell without a workspace exit link', () => {
    const organizationScope = { kind: 'organization', organizationId: 'organization' } as const
    render('', { scope: organizationScope })
    expect(mocks.mine).toHaveBeenCalledWith(organizationScope, 0, undefined, true)
    expect(container.textContent).not.toContain('Workspace:')
    expect(container.textContent).not.toContain('Your workspaces')
    expect(container.textContent).not.toContain('Back to Sim')
  })

  it('returns standalone visitors through the shared app entry', () => {
    render('', {
      scope: { kind: 'organization', organizationId: 'organization' },
      standalone: true,
    })
    const back = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Back to Sim'
    )
    expect(back).toBeDefined()
    act(() => back!.click())
    expect(mocks.push).toHaveBeenCalledWith('/home')
  })
  it('loads a deep-linked request independently of the retained list page', () => {
    render('?page=3&requestId=request')
    expect(mocks.mine).toHaveBeenCalledWith(scope, 75, undefined, true)
    expect(mocks.mine).toHaveBeenCalledWith(scope, 0, 'request')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(request.reason)
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Cancel request')
  })
  it('leaves the list visible when a deep-linked request no longer exists', () => {
    mocks.mine.mockImplementation((_scope, _offset, id) => successful(id ? [] : [request]))
    render('?page=3&requestId=removed-request')
    expect(mocks.mine).toHaveBeenCalledWith(scope, 0, 'removed-request')
    expect(container.textContent).toContain('Slack')
    expect(container.textContent).toContain('Page 4')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
  it('does not show cached detail or allow cancellation after an authorized detail refresh fails', () => {
    mocks.mine.mockImplementation((_scope, _offset, id) =>
      id
        ? {
            ...successful([request]),
            isSuccess: false,
            isError: true,
            error: new Error('Access no longer available'),
          }
        : successful([request])
    )
    render('?requestId=request')
    const text = document.querySelector('[role="dialog"]')?.textContent
    expect(text).toContain('Access no longer available')
    expect(text).not.toContain(request.reason)
    expect(text).not.toContain('Cancel request')
  })
  it('keeps a catalog search active behind a pending-request detail', () => {
    render('?view=catalog&search=slack&page=2&requestId=request')
    expect(mocks.mine).toHaveBeenCalledWith(scope, 50, undefined, false)
    expect(mocks.mine).toHaveBeenCalledWith(scope, 0, 'request')
    expect(mocks.discovery).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'slack', offset: 50, state: 'requestable' })
    )
  })

  it('exposes the selected view and resets pagination when switching views through nuqs', async () => {
    render('?view=catalog&search=slack&page=2')
    const views = container.querySelector('[role="radiogroup"][aria-label="Access request views"]')
    expect(views?.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe(
      'Browse access'
    )
    const history = views?.querySelector<HTMLButtonElement>('[role="radio"][value="requests"]')
    expect(history).not.toBeNull()
    await act(async () => history?.click())
    expect(container.querySelector('[aria-label="Access request views"]')).toBeNull()
    await vi.waitFor(() =>
      expect(mocks.url).toHaveBeenLastCalledWith(
        expect.objectContaining({ queryString: '?view=requests&search=slack' })
      )
    )
    expect(mocks.mine).toHaveBeenLastCalledWith(scope, 0, undefined, true)
  })

  it('does not promote an empty catalog from request history', () => {
    mocks.mine.mockReturnValue(successful([]))
    render('?search=slack&page=2')
    expect(container.textContent).not.toContain('Browse access')
    expect(container.textContent).toContain('No requests on this page')
    expect(mocks.discovery).toHaveBeenCalledWith({
      ...scope,
      search: '',
      state: 'requestable',
      limit: 1,
      offset: 0,
    })
  })

  it('promotes browsing only when an unfiltered discovery finds a requestable item', () => {
    mocks.discovery.mockReturnValue({
      data: { enabled: true, entries: [{ state: 'requestable' }] },
      isSuccess: true,
    })
    render()
    expect(container.querySelector('[role="radio"][value="catalog"]')?.textContent).toBe(
      'Browse access'
    )
  })

  it('keeps history available when new requests are paused', () => {
    mocks.discovery.mockReturnValue({
      data: { enabled: false, organizationId: 'organization', entries: [] },
      isSuccess: true,
    })
    render()
    expect(container.textContent).toContain('Slack')
    expect(container.textContent).toContain('Your organization has paused new requests.')
    expect(container.textContent).not.toContain('Browse access')
    expect(mocks.mine).toHaveBeenCalledWith(scope, 0, undefined, true)
  })

  it('keeps history available if discovery fails with stale requestable data', () => {
    mocks.discovery.mockReturnValue({
      data: { enabled: true, entries: [{ state: 'requestable' }] },
      isSuccess: false,
      isError: true,
      error: new Error('Discovery unavailable'),
    })
    render()
    expect(container.textContent).toContain('Slack')
    expect(container.textContent).not.toContain('Browse access')
    expect(container.textContent).not.toContain('Discovery unavailable')
  })

  it('distinguishes an empty catalog from an unsuccessful search and preserves its deep link', () => {
    render('?view=catalog')
    expect(container.textContent).toContain('Nothing to request in this workspace')
    expect(container.textContent).not.toContain('No matching results')
    expect(container.querySelector('[role="radio"][value="requests"]')).not.toBeNull()
    expect(container.querySelector('[role="radio"][value="catalog"]')).not.toBeNull()
  })

  it('lets users clear a search with no matches', async () => {
    render('?view=catalog&search=slack&page=2')
    expect(container.textContent).toContain('No matching results')
    const clear = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Clear search'
    )
    expect(clear).toBeDefined()
    await act(async () => clear?.click())
    await vi.waitFor(() =>
      expect(mocks.url).toHaveBeenLastCalledWith(
        expect.objectContaining({ queryString: '?view=catalog' })
      )
    )
  })

  it('explains paused requests on catalog links without a search control', () => {
    mocks.discovery.mockReturnValue({
      data: { enabled: false, organizationId: 'organization', entries: [] },
      isSuccess: true,
    })
    render('?view=catalog')
    expect(container.textContent).toContain('Your organization has paused new requests.')
    expect(container.querySelector('[aria-label="Search access catalog"]')).toBeNull()
    expect(container.querySelector('[role="radio"][value="requests"]')).not.toBeNull()
  })

  it('uses the settings shell context without repeating scope notices', () => {
    render()
    expect(container.textContent).not.toContain('Workspace: Design')
    expect(container.textContent).not.toContain('Includes your organization credit limit requests.')
  })

  it('does not mount reviewer queries for members even with a forged review view', () => {
    render('?view=review&request-id=other-request')
    expect(mocks.review).not.toHaveBeenCalled()
    expect(mocks.mine).toHaveBeenCalledWith(scope, 0, undefined, true)
    expect(container.textContent).not.toContain('Review requests')
    expect(container.textContent).not.toContain('Allow requests')
  })

  it('preserves the default administrator review destination and exposes My requests', async () => {
    render('', { reviewOrganizationId: 'organization' })
    expect(mocks.review).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'organization' }),
      undefined
    )
    expect(mocks.mine).toHaveBeenCalledWith(scope, 0, undefined, false)
    expect(
      container.querySelector('[role="radio"][value="review"]')?.getAttribute('aria-checked')
    ).toBe('true')
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[role="radio"][value="requests"]')!.click()
    )
    expect(mocks.mine).toHaveBeenLastCalledWith(scope, 0, undefined, true)
    await vi.waitFor(() =>
      expect(mocks.url).toHaveBeenLastCalledWith(
        expect.objectContaining({ queryString: '?view=requests' })
      )
    )
  })

  it('opens an administrator own-request deep link without mounting the review queue', () => {
    mocks.mine.mockImplementation((_scope, _offset, id) => successful(id ? [] : [request]))
    render('?view=requests&requestId=missing', { reviewOrganizationId: 'organization' })
    expect(mocks.review).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Slack')
  })
})
