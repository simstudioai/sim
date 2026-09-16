/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MyAccessRequests } from '@/components/access-requests/my-access-requests'

const mocks = vi.hoisted(() => ({
  mine: vi.fn(),
  discovery: vi.fn(),
  cancel: vi.fn(),
  url: vi.fn(),
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
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mocks.mine.mockReturnValue(successful([request]))
    mocks.discovery.mockReturnValue({
      data: { enabled: true, entries: [], hasMore: false },
      isSuccess: true,
    })
    mocks.cancel.mockReturnValue({ mutate: vi.fn(), isPending: false, error: null })
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })
  const render = (searchParams = '') =>
    act(() =>
      root.render(
        <NuqsTestingAdapter hasMemory searchParams={searchParams} onUrlUpdate={mocks.url}>
          <MyAccessRequests scope={scope} />
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
  it('loads a deep-linked request independently of the retained list page', () => {
    render('?page=3&requestId=request')
    expect(mocks.mine).toHaveBeenCalledWith(scope, 75, undefined, true)
    expect(mocks.mine).toHaveBeenCalledWith(scope, 0, 'request')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(request.reason)
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Cancel request')
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
      expect.objectContaining({ search: 'slack', offset: 50, state: 'requestable' }),
      true
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
    expect(views?.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe(
      'My requests'
    )
    await vi.waitFor(() =>
      expect(mocks.url).toHaveBeenLastCalledWith(
        expect.objectContaining({ queryString: '?search=slack' })
      )
    )
    expect(mocks.mine).toHaveBeenLastCalledWith(scope, 0, undefined, true)
  })
})
