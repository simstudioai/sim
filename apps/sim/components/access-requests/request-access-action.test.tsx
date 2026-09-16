/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RequestAccessAction } from '@/components/access-requests/request-access-action'
import type { AccessRequestTarget } from '@/lib/api/contracts/access-requests'

const mocks = vi.hoisted(() => ({
  discovery: vi.fn(),
  create: vi.fn(),
  push: vi.fn(),
  refetch: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
  usePathname: () => '/workspace/workspace',
}))
vi.mock('@/hooks/queries/access-requests', () => ({
  useCreateAccessRequest: () => ({ mutate: mocks.create, isPending: false, error: null }),
  useDiscoverAccessRequests: mocks.discovery,
}))

const scope = { kind: 'workspace', workspaceId: 'workspace' } as const
const tables = { kind: 'feature', configKey: 'hideTablesTab' } as const

describe('request form lifecycle', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.discovery.mockReturnValue({
      isSuccess: true,
      isPending: false,
      isError: false,
      data: {
        enabled: true,
        entries: [{ target: tables, state: 'requestable', pendingRequestId: null }],
      },
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
  const render = (pendingRequestId?: string, target: AccessRequestTarget = tables) =>
    act(() =>
      root.render(
        <RequestAccessAction
          scope={scope}
          target={target}
          label='Tables'
          pendingRequestId={pendingRequestId}
        />
      )
    )
  const open = () => act(() => container.querySelector('button')!.click())

  it('does not reopen a dismissed form when an external pending request disappears', () => {
    render()
    open()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    render('pending-request')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(container.querySelector('a')?.textContent).toContain('View request')
    render()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('closes the previous form when its target changes', () => {
    render()
    open()
    render(undefined, { kind: 'feature', configKey: 'hideKnowledgeBaseTab' })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
  const clickDialogButton = (label: string) => {
    const button = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')
    ).find((button) => button.textContent === label)
    expect(button).toBeDefined()
    act(() => button!.click())
  }

  it('does no target discovery until opened and looks up only the chosen target', () => {
    render()
    expect(mocks.discovery).not.toHaveBeenCalled()
    open()
    expect(mocks.discovery).toHaveBeenCalledWith({
      ...scope,
      targetKind: 'feature',
      targetKey: 'feature:hideTablesTab',
      limit: 1,
      offset: 0,
    })
    expect(document.querySelector('textarea')).not.toBeNull()
    clickDialogButton('Send request')
    expect(mocks.create).toHaveBeenCalledWith(
      { scope, target: tables, reason: '' },
      expect.any(Object)
    )
  })

  it('opens the existing pending request without allowing another reason or submission', () => {
    mocks.discovery.mockReturnValue({
      isSuccess: true,
      data: {
        enabled: true,
        entries: [{ state: 'requestable', pendingRequestId: 'pending/request' }],
      },
    })
    render()
    open()
    expect(document.querySelector('textarea')).toBeNull()
    clickDialogButton('View request')
    expect(mocks.push).toHaveBeenCalledWith(
      '/workspace/workspace/access-requests?requestId=pending%2Frequest'
    )
    expect(mocks.create).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('routes a pending member limit request in its organization scope', () => {
    const organizationScope = { kind: 'organization', organizationId: 'organization' } as const
    const limit = { kind: 'usage_limit', id: 'member' } as const
    mocks.discovery.mockReturnValue({
      isSuccess: true,
      data: {
        enabled: true,
        entries: [{ state: 'requestable', pendingRequestId: 'limit-request' }],
      },
    })
    act(() =>
      root.render(
        <RequestAccessAction scope={organizationScope} target={limit} label='Member usage limit' />
      )
    )
    open()
    expect(mocks.discovery).toHaveBeenCalledWith({
      ...organizationScope,
      targetKind: 'usage_limit',
      targetKey: 'usage_limit:member',
      limit: 1,
      offset: 0,
    })
    clickDialogButton('View request')
    expect(mocks.push).toHaveBeenCalledWith(
      '/access-requests?requestId=limit-request&organizationId=organization'
    )
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('blocks submission until discovery completes', () => {
    mocks.discovery.mockReturnValue({ isPending: true })
    render()
    open()
    clickDialogButton('Loading...')
    expect(document.querySelector('textarea')).toBeNull()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('offers retry instead of using cached eligibility after a failed refresh', () => {
    mocks.discovery.mockReturnValue({
      isSuccess: false,
      isError: true,
      error: new Error('Access check failed'),
      refetch: mocks.refetch,
      data: { enabled: true, entries: [{ state: 'requestable', pendingRequestId: null }] },
    })
    render()
    open()
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Access check failed')
    expect(document.querySelector('textarea')).toBeNull()
    clickDialogButton('Retry')
    expect(mocks.refetch).toHaveBeenCalledOnce()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it.each([
    { enabled: false, entries: [] },
    { enabled: true, entries: [] },
    {
      enabled: true,
      entries: [
        { state: 'allowed', reason: 'Access is already available.', pendingRequestId: null },
      ],
    },
    {
      enabled: true,
      entries: [{ state: 'unavailable', reason: 'Access is unavailable.', pendingRequestId: null }],
    },
  ])('does not submit when the target is not requestable: %j', (data) => {
    mocks.discovery.mockReturnValue({ isSuccess: true, data })
    render()
    open()
    clickDialogButton('Send request')
    expect(document.querySelector('textarea')).toBeNull()
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('preserves the caller navigation handler for a newly discovered pending request', () => {
    const onViewRequest = vi.fn()
    mocks.discovery.mockReturnValue({
      isSuccess: true,
      data: { enabled: true, entries: [{ state: 'requestable', pendingRequestId: 'existing' }] },
    })
    act(() =>
      root.render(
        <RequestAccessAction
          scope={scope}
          target={tables}
          label='Tables'
          onViewRequest={onViewRequest}
        />
      )
    )
    open()
    clickDialogButton('View request')
    expect(onViewRequest).toHaveBeenCalledWith('existing')
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('presents newly granted access as a neutral result', () => {
    mocks.discovery.mockReturnValue({
      isSuccess: true,
      data: {
        enabled: true,
        entries: [{ state: 'allowed', reason: null, pendingRequestId: null }],
      },
    })
    render()
    open()
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'Access is already available.'
    )
    expect(document.querySelector('[role="alert"]')).toBeNull()
    expect(document.querySelector('textarea')).toBeNull()
  })
})
