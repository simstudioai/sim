/** @vitest-environment jsdom */
import { act } from 'react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  settings: vi.fn(),
  requests: vi.fn(),
  update: vi.fn(),
  mutate: vi.fn(),
  refetch: vi.fn(),
}))
vi.mock('@/hooks/queries/access-requests', () => ({
  ACCESS_REQUEST_PAGE_SIZE: 25,
  useAccessRequestSettings: mocks.settings,
  useOrganizationAccessRequests: mocks.requests,
  useUpdateAccessRequestSettings: mocks.update,
}))
vi.mock('@/components/access-requests/access-request-review', () => ({
  AccessRequestReview: () => null,
}))

import { OrganizationAccessRequests } from '@/components/access-requests/organization-access-requests'

describe('organization access request settings', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mocks.settings.mockReturnValue({
      data: { allowRequests: true },
      isSuccess: true,
      isPending: false,
      isError: false,
    })
    mocks.update.mockReturnValue({ mutate: mocks.mutate, isPending: false })
    mocks.requests.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        requests: [
          {
            id: 'request',
            targetLabel: 'Slack',
            status: 'pending',
            requester: { name: 'Member' },
            createdAt: '2026-09-15T12:00:00Z',
          },
        ],
        hasMore: false,
      },
    })
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const render = () =>
    act(() =>
      root.render(
        <NuqsTestingAdapter>
          <OrganizationAccessRequests organizationId='organization' />
        </NuqsTestingAdapter>
      )
    )

  it('keeps history available without claiming requests are enabled while settings load', () => {
    mocks.settings.mockReturnValue({ isPending: true })
    render()
    expect(container.textContent).toContain('Loading request settings...')
    expect(container.textContent).toContain('Slack')
    expect(container.textContent).not.toContain('Members can ask administrators')
    expect(container.querySelector('[aria-label="Allow users to request permissions"]')).toBeNull()
  })

  it('allows settings failures to be retried independently of the request history', () => {
    const failed = {
      isPending: false,
      isError: true,
      error: new Error('Settings unavailable'),
      refetch: mocks.refetch,
    }
    mocks.settings.mockReturnValue({ ...failed, isFetching: false })
    render()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Settings unavailable')
    expect(container.textContent).toContain('Slack')
    expect(container.querySelector('[aria-label="Allow users to request permissions"]')).toBeNull()
    const retry = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Try again'
    )
    act(() => retry?.click())
    expect(mocks.refetch).toHaveBeenCalledOnce()
    mocks.settings.mockReturnValue({ ...failed, isFetching: true })
    render()
    expect(
      Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent === 'Retrying…'
      )?.disabled
    ).toBe(true)
  })

  it('uses the shared switch to pause requests and blocks repeat changes while saving', () => {
    render()
    const setting = container.querySelector(
      '[role="radiogroup"][aria-label="Allow users to request permissions"]'
    )
    expect(setting?.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe(
      'Enabled'
    )
    const paused = setting?.querySelector<HTMLButtonElement>('[role="radio"][value="paused"]')
    expect(paused).not.toBeNull()
    act(() => paused?.click())
    expect(mocks.mutate).toHaveBeenCalledWith(
      false,
      expect.objectContaining({ onError: expect.any(Function) })
    )
    mocks.update.mockReturnValue({ mutate: mocks.mutate, isPending: true })
    render()
    expect(
      Array.from(setting!.querySelectorAll<HTMLButtonElement>('[role="radio"]')).every(
        (button) => button.disabled
      )
    ).toBe(true)
    act(() => paused?.click())
    expect(mocks.mutate).toHaveBeenCalledOnce()
    mocks.update.mockReturnValue({ mutate: mocks.mutate, isPending: false })
    mocks.settings.mockReturnValue({
      data: { allowRequests: false },
      isPending: false,
      isError: false,
    })
    render()
    expect(setting?.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe(
      'Paused'
    )
    expect(container.textContent).toContain('New requests and approvals are paused.')
  })
})
