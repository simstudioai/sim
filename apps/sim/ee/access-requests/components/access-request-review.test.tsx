/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { toast } from '@sim/emcn'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccessRequestReview } from '@/ee/access-requests/components/access-request-review'

vi.mock('@sim/emcn', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@sim/emcn')>()),
  toast: { success: vi.fn() },
}))

const mocks = vi.hoisted(() => ({ preview: vi.fn(), resolve: vi.fn() }))
vi.mock('@/ee/access-requests/hooks/access-requests', () => ({
  useAccessRequestPreview: mocks.preview,
  useResolveAccessRequest: mocks.resolve,
}))

const data = {
  request: {
    status: 'pending',
    targetLabel: 'Tables',
    target: { kind: 'feature', configKey: 'hideTablesTab' },
    reason: '',
    requester: { name: 'Member', email: 'member@example.com' },
  },
  resolutionKind: 'permission',
  group: { id: 'group', name: 'Engineering' },
  changes: [{ configKey: 'hideTablesTab', label: 'Tables', before: true, after: false }],
  impact: { memberCount: 2, workspaceCount: 1, workspaceNames: ['Engineering'] },
  fingerprint: 'reviewed',
  canApply: true,
  unavailableReason: null,
  currentLimitCredits: null,
}

describe('access request decision availability', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mocks.resolve.mockReturnValue({ mutate: vi.fn(), isPending: false, error: null })
    mocks.preview.mockReturnValue({
      data,
      isSuccess: true,
      isFetching: false,
      isPending: false,
      isError: false,
    })
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('removes decision actions when a background policy refresh fails with cached data retained', () => {
    const render = () =>
      act(() =>
        root.render(
          <AccessRequestReview organizationId='org' requestId='request' onClose={() => undefined} />
        )
      )
    render()
    expect(
      [...document.querySelectorAll('button')].some(
        (button) => button.textContent === 'Apply group change'
      )
    ).toBe(true)
    mocks.preview.mockReturnValue({
      data,
      isSuccess: false,
      isFetching: false,
      isPending: false,
      isError: true,
      error: new Error('Unable to refresh policy'),
    })
    render()
    expect(document.body.textContent).toContain('Unable to refresh policy')
    expect(document.body.textContent).not.toContain('Decision')
    expect(document.body.textContent).not.toContain(data.request.requester.email)
    expect(document.body.textContent).not.toContain('Permission group')
    expect(
      [...document.querySelectorAll('button')].some(
        (button) => button.textContent === 'Apply group change'
      )
    ).toBe(false)
    expect(
      [...document.querySelectorAll('button')].some((button) => button.textContent === 'Decline')
    ).toBe(false)
  })

  const renderReview = () =>
    act(() =>
      root.render(
        <AccessRequestReview organizationId='org' requestId='request' onClose={() => undefined} />
      )
    )
  const clickButton = (label: string) =>
    act(() => {
      const button = [...document.querySelectorAll('button')].find(
        (item) => item.textContent === label
      )
      expect(button).toBeDefined()
      button!.click()
    })

  it.each(['declined', 'cancelled', 'closed'])(
    'shows only the %s outcome without hypothetical policy changes',
    (status) => {
      mocks.preview.mockReturnValue({
        data: {
          ...data,
          request: { ...data.request, status },
          unavailableReason: 'Already resolved',
        },
        isSuccess: true,
      })
      renderReview()
      expect(document.body.textContent).toContain('Decision')
      expect(document.body.textContent).not.toContain('Already resolved')
      expect(document.body.textContent).not.toContain('Who this affects')
      expect(document.body.textContent).not.toContain('Before')
    }
  )

  it('retains the recorded change for a fulfilled request without duplicating its status', () => {
    mocks.preview.mockReturnValue({
      data: {
        ...data,
        request: { ...data.request, status: 'fulfilled' },
        unavailableReason: 'Already fulfilled',
      },
      isSuccess: true,
    })
    renderReview()
    clickButton('View details')
    expect(document.body.textContent).toContain('Before')
    expect(document.body.textContent).toContain('Fulfilled')
    expect(document.body.textContent).not.toContain('Already fulfilled')
  })

  it('omits group impact when marking already-available access fulfilled', () => {
    mocks.preview.mockReturnValue({ data: { ...data, changes: [] }, isSuccess: true })
    renderReview()
    expect(document.body.textContent).toContain('Mark fulfilled')
    expect(document.body.textContent).not.toContain('Who this affects')
  })

  it('hides a decline draft after another administrator resolves the request', () => {
    renderReview()
    clickButton('Decline')
    expect(document.body.textContent).toContain('Reason for declining')
    mocks.preview.mockReturnValue({
      data: { ...data, request: { ...data.request, status: 'fulfilled' } },
      isSuccess: true,
    })
    renderReview()
    expect(document.body.textContent).not.toContain('Reason for declining')
  })

  it.each([
    ['declined', { kind: 'feature', configKey: 'hideTablesTab' }, 'Request declined'],
    ['cancelled', { kind: 'usage_limit', id: 'member' }, 'Request cancelled'],
    ['fulfilled', { kind: 'usage_limit', id: 'member' }, 'Credit limit increased'],
  ])(
    'reports the returned %s outcome when another decision wins the race',
    (status, target, expectedMessage) => {
      const mutate = vi.fn((_input, options) => options.onSuccess({ request: { status, target } }))
      mocks.resolve.mockReturnValue({ mutate, isPending: false, error: null })
      renderReview()
      clickButton('Apply group change')
      expect(toast.success).toHaveBeenCalledWith(expectedMessage)
    }
  )
})
