/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { emcnIconsMock } from '@sim/testing/mocks/emcn-icons.mock'
import { nextNavigationMock, nextNavigationMockFns } from '@sim/testing/mocks/next-navigation.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { policy, discovery, protectedMount } = vi.hoisted(() => ({
  policy: vi.fn(),
  discovery: vi.fn(),
  protectedMount: vi.fn(),
}))

vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@sim/emcn', () => ({
  cn: (...values: string[]) => values.join(' '),
  Chip: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type='button' onClick={onClick}>
      {children}
    </button>
  ),
  ChipLink: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))
vi.mock('@sim/emcn/icons', () => emcnIconsMock)
vi.mock('@/ee/access-control/hooks/permission-groups', () => ({ useUserPermissionConfig: policy }))
vi.mock('@/hooks/queries/access-requests', () => ({
  useDiscoverAccessRequests: discovery,
}))
vi.mock('@/ee/access-requests/components/request-access-action', () => ({
  RequestAccessAction: () => <button type='button'>Request access</button>,
}))

import { PermissionAccessBoundary } from '@/ee/access-requests/components/permission-access-boundary'

const { refresh } = nextNavigationMockFns.router
nextNavigationMockFns.mockUseParams.mockReturnValue({ workspaceId: 'workspace-1' })

describe('PermissionAccessBoundary', () => {
  let container: HTMLDivElement
  let root: Root

  function ProtectedContent() {
    protectedMount()
    return <div>Private table names</div>
  }

  function render() {
    act(() =>
      root.render(
        <PermissionAccessBoundary configKey='hideTablesTab'>
          <ProtectedContent />
        </PermissionAccessBoundary>
      )
    )
  }

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    policy.mockReturnValue({ data: { config: { hideTablesTab: true } }, isPending: false })
    discovery.mockReturnValue({
      isPending: false,
      data: {
        enabled: true,
        entries: [
          {
            target: { kind: 'feature', configKey: 'hideTablesTab' },
            label: 'Tables',
            state: 'requestable',
            reason: null,
            pendingRequestId: null,
          },
        ],
      },
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('preserves mounted content during a background refresh until policy actually denies access', () => {
    policy.mockReturnValue({ data: { config: {} }, isPending: false, isFetching: false })
    render()
    const content = container.firstElementChild
    policy.mockReturnValue({ data: { config: {} }, isPending: false, isFetching: true })
    render()
    expect(container.firstElementChild).toBe(content)
    policy.mockReturnValue({
      data: { config: { hideTablesTab: true } },
      isPending: false,
      isFetching: false,
    })
    render()
    expect(container.textContent).not.toContain('Private table names')
    expect(container.textContent).toContain('Access required')
  })

  it('does not mount protected data consumers behind the request state', () => {
    render()
    expect(protectedMount).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Access required')
    expect(container.textContent).toContain('Request access')
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://docs.sim.ai/tables')
    expect(container.textContent).not.toContain('My requests')
  })

  it('waits for policy without mounting protected content', () => {
    policy.mockReturnValue({ data: undefined, isPending: true })
    render()
    expect(protectedMount).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Checking access')
  })

  it('does not confuse a deployment failure with a requestable restriction', () => {
    discovery.mockReturnValue({
      isPending: false,
      isError: true,
      error: new Error('Offline'),
      refetch: vi.fn(),
    })
    render()
    expect(protectedMount).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Offline')
    expect(container.textContent).not.toContain('Request access')
  })

  it('keeps a server-denied page restricted if requests become disabled', () => {
    discovery.mockReturnValue({ isPending: false, data: { enabled: false, entries: [] } })
    act(() => root.render(<PermissionAccessBoundary configKey='hideTablesTab' />))
    expect(container.textContent).toContain('Access required')
    expect(container.textContent).not.toContain('Request access')
    expect(protectedMount).not.toHaveBeenCalled()
  })

  it('requires a fresh server render after a server-denied page becomes available', () => {
    policy.mockReturnValue({ data: { config: { hideTablesTab: false } }, isPending: false })
    act(() => root.render(<PermissionAccessBoundary configKey='hideTablesTab' />))
    expect(container.textContent).toContain('Access updated')
    act(() => container.querySelector('button')?.click())
    expect(refresh).toHaveBeenCalledOnce()
    expect(protectedMount).not.toHaveBeenCalled()
  })
})
