/** @vitest-environment jsdom */
import { act, type ReactNode } from 'react'
import { dehydrate, hydrate, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  policy: vi.fn(),
  discovery: vi.fn(),
  requestJson: vi.fn(),
  workspaceId: 'workspace',
}))
vi.mock('@/lib/permission-groups/application/read-user-config', () => ({
  readUserPermissionConfig: { execute: mocks.policy },
}))
vi.mock('@/ee/access-requests/lib/application/requests', () => ({
  discoverAccessRequests: { execute: mocks.discovery },
}))
vi.mock('@/lib/api/client/request', () => ({ requestJson: mocks.requestJson }))
vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: mocks.workspaceId }),
  useRouter: () => ({ refresh: vi.fn() }),
}))
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
vi.mock('@sim/emcn/icons', () => ({
  Lock: () => null,
  Plus: () => null,
  Upload: () => null,
  BookOpen: () => null,
}))
vi.mock('@/ee/access-requests/components/request-access-action', () => ({
  RequestAccessAction: ({ pendingRequestId }: { pendingRequestId: string | null }) => (
    <button type='button'>{pendingRequestId ? 'Pending' : 'Request access'}</button>
  ),
}))

import { ApiClientError } from '@/lib/api/client/errors'
import { getUserPermissionConfigContract } from '@/lib/api/contracts/permission-groups'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { prefetchWorkspaceAccess } from '@/app/workspace/[workspaceId]/prefetch-access'
import { PermissionAccessBoundary } from '@/ee/access-requests/components/permission-access-boundary'
import {
  accessRequestKeys,
  workspaceFeatureDiscoveryQuery,
} from '@/hooks/queries/utils/access-request-keys'
import { permissionGroupKeys } from '@/hooks/queries/utils/permission-group-keys'

const principal = { kind: 'session', userId: 'viewer', sessionId: 'session' } as const
const policy = {
  permissionGroupId: 'group',
  groupName: 'Group',
  config: DEFAULT_PERMISSION_GROUP_CONFIG,
  entitled: true,
  organizationId: 'org',
  isOrgAdmin: false,
}
const discovery = {
  enabled: true,
  organizationId: 'org',
  entries: [
    {
      target: { kind: 'feature', configKey: 'hideCopilot' },
      label: 'Chat',
      state: 'requestable',
      reason: null,
      pendingRequestId: null,
    },
  ],
  total: 1,
  hasMore: false,
}

describe('workspace access hydration', () => {
  let server: QueryClient
  let client: QueryClient
  let root: Root | undefined
  let container: HTMLDivElement

  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    mocks.workspaceId = 'workspace'
    mocks.policy.mockResolvedValue(policy)
    mocks.discovery.mockResolvedValue(discovery)
    mocks.requestJson.mockImplementation(() => new Promise(() => {}))
    server = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    container = document.createElement('div')
    document.body.appendChild(container)
  })
  afterEach(() => {
    if (root) act(() => root?.unmount())
    root = undefined
    server.clear()
    client.clear()
    container.remove()
  })
  async function prefetch() {
    await prefetchWorkspaceAccess(server, 'workspace', principal)
    hydrate(client, dehydrate(server))
  }
  function tree() {
    return (
      <QueryClientProvider client={client}>
        <PermissionAccessBoundary configKey='hideCopilot'>
          <div>Workspace chat</div>
        </PermissionAccessBoundary>
      </QueryClientProvider>
    )
  }
  function render() {
    root = createRoot(container)
    act(() => root?.render(tree()))
  }
  function restrict() {
    mocks.policy.mockResolvedValue({ ...policy, config: { ...policy.config, hideCopilot: true } })
  }

  it('renders allowed chat immediately from the server seed without a second policy request', async () => {
    await prefetch()
    const html = renderToString(tree())
    expect(html).toContain('Workspace chat')
    expect(html).not.toContain('Checking access')
    render()
    expect(container.textContent).toBe('Workspace chat')
    expect(mocks.discovery).not.toHaveBeenCalled()
    expect(
      mocks.requestJson.mock.calls.some(
        ([contract]) => contract === getUserPermissionConfigContract
      )
    ).toBe(false)
    expect(mocks.policy).toHaveBeenCalledWith({ principal, input: { workspaceId: 'workspace' } })
  })
  it.each([null, 'request'])(
    'renders restricted chat and request state %s on the first render',
    async (pendingRequestId) => {
      restrict()
      mocks.discovery.mockResolvedValue({
        ...discovery,
        entries: [{ ...discovery.entries[0], pendingRequestId }],
      })
      await prefetch()
      expect(renderToString(tree())).toContain('Access required')
      render()
      expect(container.textContent).not.toContain('Checking access')
      expect(container.textContent).not.toContain('Workspace chat')
      expect(container.textContent).toContain(
        pendingRequestId ? 'Your request is pending.' : 'Request access'
      )
      expect(mocks.requestJson).not.toHaveBeenCalled()
    }
  )
  it('awaits restricted discovery before dehydrating', async () => {
    restrict()
    const deferred = Promise.withResolvers<typeof discovery>()
    mocks.discovery.mockReturnValue(deferred.promise)
    const done = vi.fn()
    const work = prefetch().then(done)
    await vi.waitFor(() => expect(mocks.discovery).toHaveBeenCalledOnce())
    expect(done).not.toHaveBeenCalled()
    deferred.resolve(discovery)
    await work
    expect(
      client.getQueryData(accessRequestKeys.discovery(workspaceFeatureDiscoveryQuery('workspace')))
    ).toEqual(discovery)
  })
  it('preserves legacy behavior when access requests are disabled', async () => {
    restrict()
    mocks.discovery.mockResolvedValue({ ...discovery, enabled: false, entries: [], total: 0 })
    await prefetch()
    render()
    expect(container.textContent).toBe('Workspace chat')
    expect(mocks.requestJson).not.toHaveBeenCalled()
  })
  it('does not load discovery for personal or unrestricted workspaces', async () => {
    mocks.policy.mockResolvedValue({
      ...policy,
      config: null,
      organizationId: null,
      entitled: false,
      permissionGroupId: null,
      groupName: null,
    })
    await prefetch()
    expect(renderToString(tree())).toContain('Workspace chat')
    expect(mocks.discovery).not.toHaveBeenCalled()
  })
  it.each(['rejected', 'invalid'])(
    'never hydrates a permissive policy after a %s server read',
    async (failure) => {
      if (failure === 'rejected') mocks.policy.mockRejectedValue(new Error('unavailable'))
      else mocks.policy.mockResolvedValue({ config: null })
      await prefetch()
      expect(dehydrate(server).queries).toHaveLength(0)
      expect(mocks.discovery).not.toHaveBeenCalled()
      expect(renderToString(tree())).toContain('Checking access')
      expect(renderToString(tree())).not.toContain('Workspace chat')
    }
  )
  it('keeps restricted content closed when discovery fails', async () => {
    restrict()
    mocks.discovery.mockRejectedValue(new Error('unavailable'))
    await prefetch()
    expect(dehydrate(server).queries).toHaveLength(1)
    expect(renderToString(tree())).toContain('Checking access')
    expect(renderToString(tree())).not.toContain('Workspace chat')
  })
  it('shows a retryable error after a failed seed and recovers through the existing query', async () => {
    mocks.policy.mockRejectedValue(new Error('unavailable'))
    await prefetch()
    mocks.requestJson.mockRejectedValue(
      new ApiClientError({ status: 403, message: 'Access unavailable', body: {} })
    )
    render()
    await vi.waitFor(() => expect(container.textContent).toContain('Unable to check access'))
    expect(container.textContent).not.toContain('Workspace chat')
    mocks.requestJson.mockResolvedValue(policy)
    await act(async () => container.querySelector('button')?.click())
    await vi.waitFor(() => expect(container.textContent).toBe('Workspace chat'))
  })
  it('isolates workspace keys during navigation', async () => {
    await prefetch()
    mocks.workspaceId = 'different-workspace'
    expect(renderToString(tree())).toContain('Checking access')
    expect(renderToString(tree())).not.toContain('Workspace chat')
  })
  it('keeps background policy invalidation effective after hydration', async () => {
    await prefetch()
    render()
    const mountedContent = container.firstChild
    const deferred = Promise.withResolvers<typeof policy>()
    mocks.requestJson.mockImplementation((contract) =>
      contract === getUserPermissionConfigContract ? deferred.promise : new Promise(() => {})
    )
    let refresh: Promise<void>
    act(() => {
      refresh = client.invalidateQueries({ queryKey: permissionGroupKeys.userConfig('workspace') })
    })
    expect(container.firstChild).toBe(mountedContent)
    await act(async () => {
      client.setQueryData(
        accessRequestKeys.discovery(workspaceFeatureDiscoveryQuery('workspace')),
        discovery
      )
      deferred.resolve({ ...policy, config: { ...policy.config, hideCopilot: true } })
      await refresh
    })
    await vi.waitFor(() => expect(container.textContent).toContain('Access required'))
    expect(container.textContent).not.toContain('Workspace chat')
  })
})
