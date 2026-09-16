/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { requestJson } = vi.hoisted(() => ({ requestJson: vi.fn() }))
vi.mock('@/lib/api/client/request', () => ({ requestJson }))
vi.mock('@/ee/access-control/hooks/permission-groups', () => ({
  permissionGroupKeys: {
    all: ['permissionGroups'],
    userConfig: (workspaceId: string) => ['permissionGroups', 'userConfig', workspaceId],
  },
}))

import {
  discoverAccessRequestsContract,
  listMyAccessRequestsContract,
  resolveAccessRequestContract,
} from '@/lib/api/contracts/access-requests'
import {
  accessRequestKeys,
  useDiscoverAccessRequests,
  useMyAccessRequests,
  useResolveAccessRequest,
} from '@/hooks/queries/access-requests'
import { workspaceUsageKeys } from '@/hooks/queries/utils/workspace-usage-keys'

describe('access request query lifecycle', () => {
  let container: HTMLDivElement
  let root: Root
  let client: QueryClient

  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    client.clear()
    container.remove()
  })

  it('refreshes stale policy after discovery sees an external administrator update', async () => {
    const policyKey = ['permissionGroups', 'userConfig', 'workspace-1']
    client.setQueryData(
      policyKey,
      { config: { hideTablesTab: true } },
      { updatedAt: Date.now() - 60_001 }
    )
    requestJson.mockResolvedValue({ enabled: true, entries: [], hasMore: false, total: 0 })
    const fetchPolicy = vi.fn().mockResolvedValue({ config: { hideTablesTab: false } })
    function Probe() {
      useQuery({
        queryKey: policyKey,
        queryFn: fetchPolicy,
        staleTime: 60_000,
        refetchOnMount: false,
      })
      useDiscoverAccessRequests({
        kind: 'workspace',
        workspaceId: 'workspace-1',
        targetKind: 'usage_limit',
        limit: 1,
        offset: 0,
      })
      useDiscoverAccessRequests({
        kind: 'workspace',
        workspaceId: 'workspace-1',
        targetKind: 'feature',
        limit: 100,
        offset: 0,
      })
      return null
    }
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>
      )
    })
    expect(requestJson).toHaveBeenCalledWith(discoverAccessRequestsContract, {
      query: {
        kind: 'workspace',
        workspaceId: 'workspace-1',
        targetKind: 'feature',
        limit: 100,
        offset: 0,
      },
      signal: expect.any(AbortSignal),
    })
    expect(fetchPolicy).toHaveBeenCalledOnce()
    expect(client.getQueryData(policyKey)).toEqual({ config: { hideTablesTab: false } })
  })

  it('respects fresh policy and leaves unrelated usage gates alone', async () => {
    const policyKey = ['permissionGroups', 'userConfig', 'workspace-1']
    const usageKey = workspaceUsageKeys.gate('workspace-1')
    client.setQueryData(policyKey, { config: { hideTablesTab: true } })
    client.setQueryData(
      usageKey,
      { scope: 'payer', isExceeded: true },
      { updatedAt: Date.now() - 60_001 }
    )
    const fetchPolicy = vi.fn()
    const fetchUsage = vi.fn()
    requestJson.mockResolvedValue({ enabled: true, entries: [], total: 0, hasMore: false })
    function Probe() {
      useQuery({
        queryKey: policyKey,
        queryFn: fetchPolicy,
        staleTime: 60_000,
        refetchOnMount: false,
      })
      useQuery({
        queryKey: usageKey,
        queryFn: fetchUsage,
        staleTime: 30_000,
        refetchOnMount: false,
      })
      useDiscoverAccessRequests({
        kind: 'workspace',
        workspaceId: 'workspace-1',
        targetKind: 'feature',
      })
      return null
    }
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>
      )
    })
    expect(fetchPolicy).not.toHaveBeenCalled()
    expect(fetchUsage).not.toHaveBeenCalled()
  })

  it('refreshes an exceeded member cap without needing a permission-config observer', async () => {
    const usageKey = workspaceUsageKeys.gate('workspace-1')
    client.setQueryData(
      usageKey,
      { scope: 'member', isExceeded: true },
      { updatedAt: Date.now() - 30_001 }
    )
    const fetchUsage = vi.fn().mockResolvedValue({ scope: null, isExceeded: false })
    requestJson.mockResolvedValue({ enabled: true, entries: [], total: 0, hasMore: false })
    function Probe() {
      useQuery({
        queryKey: usageKey,
        queryFn: fetchUsage,
        staleTime: 30_000,
        refetchOnMount: false,
      })
      useDiscoverAccessRequests({
        kind: 'workspace',
        workspaceId: 'workspace-1',
        targetKind: 'usage_limit',
      })
      return null
    }
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>
      )
    })
    expect(fetchUsage).toHaveBeenCalledOnce()
    expect(client.getQueryData(usageKey)).toEqual({ scope: null, isExceeded: false })
  })

  it('does not fetch history while its view is inactive', async () => {
    function Probe() {
      useMyAccessRequests({ kind: 'workspace', workspaceId: 'workspace-1' }, 0, undefined, false)
      return null
    }
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>
      )
    })
    expect(requestJson).not.toHaveBeenCalled()
  })

  it.each([
    { kind: 'workspace', workspaceId: 'workspace-1' } as const,
    { kind: 'organization', organizationId: 'org-1' } as const,
  ])('loads an exact requester deep link within its authorized $kind scope', async (scope) => {
    requestJson.mockResolvedValue({ requests: [], hasMore: false, total: 0 })
    function Probe() {
      useMyAccessRequests(scope, 0, 'request-1')
      return null
    }
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>
      )
    })
    expect(requestJson).toHaveBeenCalledWith(listMyAccessRequestsContract, {
      query: { ...scope, offset: 0, limit: 25, requestId: 'request-1' },
      signal: expect.any(AbortSignal),
    })
    expect(accessRequestKeys.mine(scope, 0, 'request-1')).not.toEqual(
      accessRequestKeys.mine(scope, 0)
    )
  })

  it('invalidates a conflicted preview without granting access optimistically', async () => {
    let resolve: ReturnType<typeof useResolveAccessRequest>
    const previewKey = accessRequestKeys.preview('org-1', 'request-1')
    client.setQueryData(previewKey, { fingerprint: 'old-preview', canApply: true })
    requestJson.mockRejectedValue(new Error('The policy changed. Review the current preview.'))
    function Probe() {
      resolve = useResolveAccessRequest()
      return null
    }
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>
      )
    })
    await act(async () => {
      await expect(
        resolve!.mutateAsync({
          organizationId: 'org-1',
          requestId: 'request-1',
          body: { action: 'apply', expectedFingerprint: 'old-preview' },
        })
      ).rejects.toThrow('The policy changed')
    })
    expect(requestJson).toHaveBeenCalledWith(resolveAccessRequestContract, {
      params: { id: 'org-1', requestId: 'request-1' },
      body: { action: 'apply', expectedFingerprint: 'old-preview' },
    })
    expect(client.getQueryState(previewKey)?.isInvalidated).toBe(true)
    expect(client.getQueryData(previewKey)).toEqual({ fingerprint: 'old-preview', canApply: true })
  })
})
