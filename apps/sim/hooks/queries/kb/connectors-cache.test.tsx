/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { searchSourceKeys } from '@/hooks/queries/utils/search-source-keys'

const mocks = vi.hoisted(() => ({ requestJson: vi.fn() }))

vi.mock('@/lib/api/client/request', () => ({ requestJson: mocks.requestJson }))

import { connectorKeys, useDeleteConnector } from '@/hooks/queries/kb/connectors'
import { credentialGroupKeys } from '@/hooks/queries/utils/credential-group-queries'
import { knowledgeKeys } from '@/hooks/queries/utils/knowledge-keys'

const WORKSPACE_ID = 'workspace-1'
const KNOWLEDGE_BASE_ID = 'knowledge-base-1'
const CONNECTOR_ID = 'connector-1'
const DOCUMENT_ID = 'document-1'
const ACCOUNT_SUMMARY_KEY = credentialGroupKeys.workspace(WORKSPACE_ID)
const ACCOUNT_DETAIL_KEY = credentialGroupKeys.detail(WORKSPACE_ID, 'group-1')
const SEARCH_KEY = knowledgeKeys.search(WORKSPACE_ID, 'handbook')
const SOURCE_LIST_KEY = searchSourceKeys.list(WORKSPACE_ID)
const UNRELATED_KEY = ['unrelated-resource', 'sentinel'] as const
const SEARCH_STALE_TIME = 60_000

const cachedData = {
  accountSummary: { credentialGroup: { id: 'group-1', options: [] } },
  accountDetail: {
    pages: [{ credentialGroup: { id: 'group-1', options: [] }, enrollments: [] }],
    pageParams: [null],
  },
  search: [{ documentId: DOCUMENT_ID, filename: 'handbook.pdf' }],
  unrelated: { value: 'leave intact' },
}

const mountedRoots: Root[] = []
const queryClients: QueryClient[] = []

function createQueryClient() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
        gcTime: Number.POSITIVE_INFINITY,
      },
      mutations: { retry: false },
    },
  })
  queryClients.push(queryClient)
  queryClient.setQueryDefaults(SEARCH_KEY, { staleTime: SEARCH_STALE_TIME })
  queryClient.setQueryData(ACCOUNT_SUMMARY_KEY, cachedData.accountSummary)
  queryClient.setQueryData(ACCOUNT_DETAIL_KEY, cachedData.accountDetail)
  queryClient.setQueryData(SOURCE_LIST_KEY, [{ connectorId: CONNECTOR_ID, isSyncing: false }])
  queryClient.setQueryData(SEARCH_KEY, cachedData.search)
  queryClient.setQueryData(UNRELATED_KEY, cachedData.unrelated)
  return queryClient
}

function renderMutation<T>(queryClient: QueryClient, useMutationHook: () => T) {
  const root = createRoot(document.createElement('div'))
  mountedRoots.push(root)
  let result: T | undefined

  function Probe() {
    result = useMutationHook()
    return null
  }

  act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>
    )
  )

  return () => {
    if (!result) throw new Error('Mutation hook did not render')
    return result
  }
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  mocks.requestJson.mockResolvedValue({
    data: { knowledgeBaseId: KNOWLEDGE_BASE_ID, excludedCount: 1, restoredCount: 1 },
  })
})

afterEach(() => {
  act(() => {
    for (const root of mountedRoots.splice(0)) root.unmount()
  })
  for (const queryClient of queryClients.splice(0)) queryClient.clear()
  vi.useRealTimers()
})

describe('Search source list reconciliation', () => {
  it('runs removal navigation before refetches and retains it after the caller unmounts', async () => {
    const client = createQueryClient()
    const request = Promise.withResolvers<object>()
    mocks.requestJson.mockReturnValueOnce(request.promise)
    const invalidated = vi.spyOn(client, 'invalidateQueries')
    const onSuccess = vi.fn(() => expect(invalidated).not.toHaveBeenCalled())
    const mutation = renderMutation(client, () => useDeleteConnector({ onSuccess }))
    let done!: Promise<void>
    await act(async () => {
      done = mutation().mutateAsync({
        knowledgeBaseId: KNOWLEDGE_BASE_ID,
        connectorId: CONNECTOR_ID,
        deleteDocuments: true,
      })
    })
    act(() => mountedRoots.pop()!.unmount())
    request.resolve({ success: true })
    await act(async () => {
      await done
    })
    expect(onSuccess).toHaveBeenCalledOnce()
    expect(invalidated).toHaveBeenCalledWith({
      queryKey: connectorKeys.detail(KNOWLEDGE_BASE_ID, CONNECTOR_ID),
      refetchType: 'none',
    })
  })
})
