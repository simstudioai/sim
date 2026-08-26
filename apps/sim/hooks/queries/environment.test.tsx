/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { sleep } from '@sim/utils/helpers'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetchWorkspaceEnvironment, mockRequestJson } = vi.hoisted(() => ({
  mockFetchWorkspaceEnvironment: vi.fn(),
  mockRequestJson: vi.fn(),
}))

vi.mock('@/lib/api/client/request', () => ({ requestJson: mockRequestJson }))

vi.mock('@/lib/environment/api', () => ({
  fetchPersonalEnvironment: vi.fn(),
  fetchWorkspaceEnvironment: mockFetchWorkspaceEnvironment,
}))

import type { QueryKey } from '@tanstack/react-query'
import {
  environmentKeys,
  useRemoveWorkspaceEnvironment,
  useSavePersonalEnvironment,
  useUpsertWorkspaceEnvironment,
  useWorkspaceEnvironment,
} from '@/hooks/queries/environment'
import { environmentDependentSelectorKeys } from '@/hooks/selectors/cache-invalidation'

function renderWorkspaceEnvironment(workspaceId: string, enabled?: boolean) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const container = document.createElement('div')
  const root = createRoot(container)

  function Probe() {
    useWorkspaceEnvironment(workspaceId, { enabled })
    return null
  }

  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>
    )
  })

  return () => act(() => root.unmount())
}

interface CacheQueryFns {
  environment: ReturnType<typeof vi.fn>
  primary: ReturnType<typeof vi.fn>
  dynamicDetails: ReturnType<typeof vi.fn>
  workflowDetails: ReturnType<typeof vi.fn>
  workflowReplacementOptions: ReturnType<typeof vi.fn>
  unrelated: ReturnType<typeof vi.fn>
}

function createCacheQueryFns(): CacheQueryFns {
  return {
    environment: vi.fn().mockResolvedValue('environment'),
    primary: vi.fn().mockResolvedValue('primary'),
    dynamicDetails: vi.fn().mockResolvedValue('dynamic'),
    workflowDetails: vi.fn().mockResolvedValue('workflow-detail'),
    workflowReplacementOptions: vi.fn().mockResolvedValue('workflow-options'),
    unrelated: vi.fn().mockResolvedValue('unrelated'),
  }
}

function renderMutationWithCaches<T>(
  useMutationHook: () => T,
  environmentQueryKey: QueryKey,
  queryFns: CacheQueryFns
): { result: () => T; unmount: () => void } {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  })
  const container = document.createElement('div')
  const root: Root = createRoot(container)
  let latest: T

  function Probe() {
    useQuery({ queryKey: environmentQueryKey, queryFn: queryFns.environment })
    useQuery({
      queryKey: [...environmentDependentSelectorKeys.primary, 'jira.projects', 'scope'],
      queryFn: queryFns.primary,
    })
    useQuery({
      queryKey: [...environmentDependentSelectorKeys.dynamicDetails, 'jira.project', 'scope'],
      queryFn: queryFns.dynamicDetails,
    })
    useQuery({
      queryKey: [...environmentDependentSelectorKeys.workflowDetails, 'jira.projects', 'scope'],
      queryFn: queryFns.workflowDetails,
    })
    useQuery({
      queryKey: [
        ...environmentDependentSelectorKeys.workflowReplacementOptions,
        'jira.projects',
        'scope',
      ],
      queryFn: queryFns.workflowReplacementOptions,
    })
    useQuery({ queryKey: ['unrelated-user-data'], queryFn: queryFns.unrelated })
    latest = useMutationHook()
    return null
  }

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }

  act(() => {
    root.render(
      <Wrapper>
        <Probe />
      </Wrapper>
    )
  })

  return {
    result: () => latest,
    unmount: () => act(() => root.unmount()),
  }
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) {
      await Promise.resolve()
      await sleep(0)
    }
  })
}

function expectOnlyEnvironmentAndSelectorCachesRefetched(queryFns: CacheQueryFns) {
  expect(queryFns.environment).toHaveBeenCalledTimes(2)
  expect(queryFns.primary).toHaveBeenCalledTimes(2)
  expect(queryFns.dynamicDetails).toHaveBeenCalledTimes(2)
  expect(queryFns.workflowDetails).toHaveBeenCalledTimes(2)
  expect(queryFns.workflowReplacementOptions).toHaveBeenCalledTimes(2)
  expect(queryFns.unrelated).toHaveBeenCalledTimes(1)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRequestJson.mockResolvedValue({ success: true })
})

afterEach(() => vi.restoreAllMocks())

describe('useWorkspaceEnvironment', () => {
  it('does not run without a workspace ID even when the caller enables it', () => {
    const unmount = renderWorkspaceEnvironment('', true)

    expect(mockFetchWorkspaceEnvironment).not.toHaveBeenCalled()
    unmount()
  })

  it('respects an explicit caller opt-out when a workspace ID exists', () => {
    const unmount = renderWorkspaceEnvironment('workspace-1', false)

    expect(mockFetchWorkspaceEnvironment).not.toHaveBeenCalled()
    unmount()
  })
})

describe('environment mutation selector freshness', () => {
  it('refetches every selector-bearing cache after a successful personal save', async () => {
    const queryFns = createCacheQueryFns()
    const view = renderMutationWithCaches(
      useSavePersonalEnvironment,
      environmentKeys.personal(),
      queryFns
    )
    await flush()

    await act(async () => {
      await view.result().mutateAsync({ variables: { DOMAIN: 'new-value' } })
    })
    await flush()

    expectOnlyEnvironmentAndSelectorCachesRefetched(queryFns)
    view.unmount()
  })

  it.each([
    {
      name: 'upsert',
      useMutationHook: useUpsertWorkspaceEnvironment,
      variables: { workspaceId: 'workspace-1', variables: { DOMAIN: 'new-value' } },
    },
    {
      name: 'removal',
      useMutationHook: useRemoveWorkspaceEnvironment,
      variables: { workspaceId: 'workspace-1', keys: ['DOMAIN'] },
    },
  ])('refetches every selector-bearing cache after a successful workspace $name', async (test) => {
    const queryFns = createCacheQueryFns()
    const view = renderMutationWithCaches(
      test.useMutationHook,
      environmentKeys.workspace('workspace-1'),
      queryFns
    )
    await flush()

    await act(async () => {
      const mutation = view.result() as {
        mutateAsync: (variables: unknown) => Promise<unknown>
      }
      await mutation.mutateAsync(test.variables)
    })
    await flush()

    expectOnlyEnvironmentAndSelectorCachesRefetched(queryFns)
    view.unmount()
  })

  it('does not invalidate selector caches after a failed environment mutation', async () => {
    const requestError = new Error('save failed')
    mockRequestJson.mockRejectedValueOnce(requestError)
    const queryFns = createCacheQueryFns()
    const view = renderMutationWithCaches(
      useSavePersonalEnvironment,
      environmentKeys.personal(),
      queryFns
    )
    await flush()

    let caught: unknown
    await act(async () => {
      try {
        await view.result().mutateAsync({ variables: { DOMAIN: 'new-value' } })
      } catch (error) {
        caught = error
      }
    })
    await flush()

    expect(caught).toBe(requestError)
    expect(queryFns.environment).toHaveBeenCalledTimes(2)
    expect(queryFns.primary).toHaveBeenCalledTimes(1)
    expect(queryFns.dynamicDetails).toHaveBeenCalledTimes(1)
    expect(queryFns.workflowDetails).toHaveBeenCalledTimes(1)
    expect(queryFns.workflowReplacementOptions).toHaveBeenCalledTimes(1)
    expect(queryFns.unrelated).toHaveBeenCalledTimes(1)
    view.unmount()
  })
})
