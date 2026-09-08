/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { QueryClient, QueryClientProvider, type QueryKey } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requestJson: vi.fn() }))

vi.mock('@/lib/api/client/request', () => ({ requestJson: mocks.requestJson }))

import {
  searchSourceKeys,
  useConnectSimSearchConnector,
  useCreateConnector,
  useDeleteConnector,
  useExcludeConnectorDocument,
  usePrepareSearchSource,
  useRestoreConnectorDocument,
  useStartConnectorMemberEnrollment,
  useUpdateConnector,
  useUpdateConnectorAccess,
} from '@/hooks/queries/kb/connectors'
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

function expectInvalidated(queryClient: QueryClient, queryKey: QueryKey, invalidated: boolean) {
  const query = queryClient.getQueryCache().find({ queryKey, exact: true })
  expect(query).toBeDefined()
  expect(query?.getObserversCount()).toBe(0)
  expect(query?.state.isInvalidated).toBe(invalidated)
  expect(query?.isStaleByTime(Number.POSITIVE_INFINITY)).toBe(invalidated)
}

function expectUnrelatedCacheUnchanged(queryClient: QueryClient) {
  expectInvalidated(queryClient, SOURCE_LIST_KEY, true)
  expectInvalidated(queryClient, UNRELATED_KEY, false)
  expect(queryClient.getQueryData(UNRELATED_KEY)).toEqual(cachedData.unrelated)
  expect(mocks.requestJson).toHaveBeenCalledOnce()
}

beforeEach(() => {
  vi.clearAllMocks()
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
})

describe('connector account cache reconciliation', () => {
  it('refreshes previously visited Accounts after creating a source', async () => {
    const queryClient = createQueryClient()
    const mutation = renderMutation(queryClient, useCreateConnector)
    expectInvalidated(queryClient, ACCOUNT_DETAIL_KEY, false)

    await act(async () => {
      await mutation().mutateAsync({
        knowledgeBaseId: KNOWLEDGE_BASE_ID,
        connectorType: 'google_drive',
        accessMode: 'members',
        sourceConfig: {},
      })
    })

    expectInvalidated(queryClient, ACCOUNT_SUMMARY_KEY, true)
    expectInvalidated(queryClient, ACCOUNT_DETAIL_KEY, true)
    expectInvalidated(queryClient, SEARCH_KEY, false)
    expect(queryClient.getQueryData(ACCOUNT_DETAIL_KEY)).toEqual(cachedData.accountDetail)
    expectUnrelatedCacheUnchanged(queryClient)
  })

  it('reconciles Accounts when source creation fails after account provisioning can commit', async () => {
    const queryClient = createQueryClient()
    const mutation = renderMutation(queryClient, useCreateConnector)
    const failure = new Error('Connector creation failed after provisioning')
    mocks.requestJson.mockRejectedValueOnce(failure)

    await act(async () => {
      await expect(
        mutation().mutateAsync({
          knowledgeBaseId: KNOWLEDGE_BASE_ID,
          connectorType: 'google_drive',
          accessMode: 'members',
          sourceConfig: {},
        })
      ).rejects.toBe(failure)
    })

    expectInvalidated(queryClient, ACCOUNT_SUMMARY_KEY, true)
    expectInvalidated(queryClient, ACCOUNT_DETAIL_KEY, true)
    expectUnrelatedCacheUnchanged(queryClient)
  })

  it('refreshes Accounts and fresh Search results after switching connector access', async () => {
    const queryClient = createQueryClient()
    const mutation = renderMutation(queryClient, useUpdateConnectorAccess)
    expect(
      queryClient.getQueryCache().find({ queryKey: SEARCH_KEY })?.isStaleByTime(SEARCH_STALE_TIME)
    ).toBe(false)

    await act(async () => {
      await mutation().mutateAsync({
        knowledgeBaseId: KNOWLEDGE_BASE_ID,
        connectorId: CONNECTOR_ID,
        access: { accessMode: 'members' },
      })
    })

    expectInvalidated(queryClient, ACCOUNT_SUMMARY_KEY, true)
    expectInvalidated(queryClient, ACCOUNT_DETAIL_KEY, true)
    expectInvalidated(queryClient, SEARCH_KEY, true)
    expectUnrelatedCacheUnchanged(queryClient)
  })

  it('invalidates the Accounts detail as well as its summary after connecting a Search source', async () => {
    const queryClient = createQueryClient()
    const mutation = renderMutation(queryClient, useConnectSimSearchConnector)

    await act(async () => {
      await mutation().mutateAsync({ workspaceId: WORKSPACE_ID, connectorType: 'google_drive' })
    })

    expectInvalidated(queryClient, ACCOUNT_SUMMARY_KEY, true)
    expectInvalidated(queryClient, ACCOUNT_DETAIL_KEY, true)
    expectUnrelatedCacheUnchanged(queryClient)
  })

  it('refreshes People after starting enrollment without invalidating account configuration', async () => {
    const queryClient = createQueryClient()
    const mutation = renderMutation(queryClient, useStartConnectorMemberEnrollment)
    mocks.requestJson.mockResolvedValueOnce({ data: { url: 'https://example.com/enroll' } })

    await act(async () => {
      await mutation().mutateAsync({
        knowledgeBaseId: KNOWLEDGE_BASE_ID,
        connectorId: CONNECTOR_ID,
      })
    })

    expectInvalidated(queryClient, ACCOUNT_DETAIL_KEY, true)
    expectInvalidated(queryClient, ACCOUNT_SUMMARY_KEY, false)
    expectInvalidated(queryClient, SEARCH_KEY, false)
    expectUnrelatedCacheUnchanged(queryClient)
  })
})

describe('connector Search result cache reconciliation', () => {
  it.each([
    ['excluding', useExcludeConnectorDocument],
    ['restoring', useRestoreConnectorDocument],
  ] as const)('refreshes Search after %s a document', async (_operation, useMutationHook) => {
    const queryClient = createQueryClient()
    const mutation = renderMutation(queryClient, () => useMutationHook())

    await act(async () => {
      await mutation().mutateAsync({
        knowledgeBaseId: KNOWLEDGE_BASE_ID,
        connectorId: CONNECTOR_ID,
        documentIds: [DOCUMENT_ID],
      })
    })

    expectInvalidated(queryClient, SEARCH_KEY, true)
    expectInvalidated(queryClient, ACCOUNT_DETAIL_KEY, false)
    expect(queryClient.getQueryData(SEARCH_KEY)).toEqual(cachedData.search)
    expectUnrelatedCacheUnchanged(queryClient)
  })

  it.each([true, false])(
    'refreshes Search after deleting a connector with deleteDocuments=%s',
    async (deleteDocuments) => {
      const queryClient = createQueryClient()
      const mutation = renderMutation(queryClient, useDeleteConnector)

      await act(async () => {
        await mutation().mutateAsync({
          knowledgeBaseId: KNOWLEDGE_BASE_ID,
          connectorId: CONNECTOR_ID,
          deleteDocuments,
        })
      })

      expectInvalidated(queryClient, SEARCH_KEY, true)
      expectInvalidated(queryClient, ACCOUNT_DETAIL_KEY, false)
      expectUnrelatedCacheUnchanged(queryClient)
    }
  )
})

describe('Search source list reconciliation', () => {
  it('refreshes summaries after editing source configuration or pausing sync', async () => {
    const queryClient = createQueryClient()
    const mutation = renderMutation(queryClient, useUpdateConnector)
    await act(async () => {
      await mutation().mutateAsync({
        knowledgeBaseId: KNOWLEDGE_BASE_ID,
        connectorId: CONNECTOR_ID,
        updates: { status: 'paused' },
      })
    })
    expectUnrelatedCacheUnchanged(queryClient)
  })

  it('refreshes prepared-source summaries in the affected workspace only', async () => {
    const queryClient = createQueryClient()
    const otherWorkspaceKey = searchSourceKeys.list('other-workspace')
    queryClient.setQueryData(otherWorkspaceKey, [])
    const mutation = renderMutation(queryClient, usePrepareSearchSource)
    await act(async () => {
      await mutation().mutateAsync({ workspaceId: WORKSPACE_ID, connectorType: 'google_drive' })
    })
    expectInvalidated(queryClient, otherWorkspaceKey, false)
    expectUnrelatedCacheUnchanged(queryClient)
  })
})
