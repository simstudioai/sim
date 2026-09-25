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

import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { prefetchWorkspaceAccess } from '@/app/workspace/[workspaceId]/prefetch-access'
import { PermissionAccessBoundary } from '@/ee/access-requests/components/permission-access-boundary'

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
  it('isolates workspace keys during navigation', async () => {
    await prefetch()
    mocks.workspaceId = 'different-workspace'
    expect(renderToString(tree())).toContain('Checking access')
    expect(renderToString(tree())).not.toContain('Workspace chat')
  })
})
