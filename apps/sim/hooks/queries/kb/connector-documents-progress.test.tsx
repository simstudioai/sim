/** @vitest-environment jsdom */
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/lib/api/client/request', () => ({ requestJson: mocks.request }))

import {
  type ConnectorDocumentsData,
  listKnowledgeConnectorDocumentsContract,
  readSearchSourceProgressContract,
} from '@/lib/api/contracts/knowledge/connectors'
import type { ResourceScope } from '@/lib/core/resource-scope'
import {
  CONNECTOR_SYNC_POLL_INTERVAL_MS,
  connectorKeys,
  useConnectorDocuments,
} from '@/hooks/queries/kb/connectors'

const SCOPE: ResourceScope = { kind: 'organization', organizationId: 'org-1' }
const KB_ID = 'kb-1'
const CONNECTOR_ID = 'connector-1'

interface ProbeProps {
  progressScope?: ResourceScope
  syncing?: boolean
}

interface RequestInput {
  query?: { offset?: number }
  signal?: AbortSignal
}

describe('connector document progress reconciliation', () => {
  let root: Root
  let container: HTMLDivElement
  let client: QueryClient
  let result: ReturnType<typeof useConnectorDocuments>
  let serverSyncing: boolean
  let processingStatus: string

  function Probe({ progressScope, syncing }: ProbeProps) {
    result = useConnectorDocuments(KB_ID, CONNECTOR_ID, {
      filter: 'active',
      progressScope,
      syncing,
    })
    return <span>{result.data?.pages.length}</span>
  }

  function documentPage(offset = 0): ConnectorDocumentsData {
    return {
      documents: [
        {
          id: `document-${offset}`,
          filename: `Document ${offset}`,
          externalId: null,
          sourceUrl: null,
          enabled: true,
          deletedAt: null,
          userExcluded: false,
          uploadedAt: '2026-09-08T00:00:00.000Z',
          processingStatus,
        },
      ],
      counts: { active: 2, excluded: 0, failed: 0 },
      hasMore: offset === 0,
    }
  }

  function requestsFor(contract: unknown) {
    return mocks.request.mock.calls.filter(([calledContract]) => calledContract === contract)
  }

  async function advance(milliseconds: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(milliseconds)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
  }

  async function render(props: ProbeProps = {}) {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Probe {...props} />
        </QueryClientProvider>
      )
    )
    await advance(1)
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    mocks.request.mockReset()
    serverSyncing = false
    processingStatus = 'pending'
    mocks.request.mockImplementation(async (contract: unknown, input: RequestInput) => {
      if (contract === listKnowledgeConnectorDocumentsContract) {
        return { data: documentPage(input.query?.offset) }
      }
      if (contract === readSearchSourceProgressContract) {
        return {
          data: [
            {
              connectorId: CONNECTOR_ID,
              isSyncing: serverSyncing,
              hasSyncError: false,
              hasIndexingError: false,
            },
          ],
        }
      }
      throw new Error('Unexpected request')
    })
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    client.clear()
    container.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('does not probe or poll ordinary knowledge-base document lists', async () => {
    await render({ syncing: true })
    await advance(60_000)

    expect(requestsFor(readSearchSourceProgressContract)).toHaveLength(0)
    expect(requestsFor(listKnowledgeConnectorDocumentsContract)).toHaveLength(1)
  })

  it('probes only the current source with cancellation and stops an abandoned request', async () => {
    let progressSignal: AbortSignal | undefined
    mocks.request.mockImplementation((contract: unknown, input: RequestInput) => {
      if (contract === listKnowledgeConnectorDocumentsContract) {
        return Promise.resolve({ data: documentPage() })
      }
      progressSignal = input.signal
      return new Promise((_resolve, reject) => {
        input.signal?.addEventListener('abort', () => reject(new Error('Request aborted')), {
          once: true,
        })
      })
    })
    await render({ progressScope: SCOPE })

    expect(mocks.request).toHaveBeenCalledWith(readSearchSourceProgressContract, {
      body: { organizationId: SCOPE.organizationId, connectorIds: [CONNECTOR_ID] },
      signal: expect.any(AbortSignal),
    })
    expect(progressSignal?.aborted).toBe(false)
    await render()
    expect(progressSignal?.aborted).toBe(true)
  })

  it('waits through post-sync indexing and refreshes loaded pages once when all work finishes', async () => {
    serverSyncing = true
    await render({ progressScope: SCOPE, syncing: true })
    await act(async () => {
      await result.fetchNextPage()
    })
    await advance(1)
    expect(result.data?.pages).toHaveLength(2)
    expect(requestsFor(listKnowledgeConnectorDocumentsContract)).toHaveLength(2)

    await advance(CONNECTOR_SYNC_POLL_INTERVAL_MS)
    await render({ progressScope: SCOPE, syncing: false })
    await advance(CONNECTOR_SYNC_POLL_INTERVAL_MS)
    expect(requestsFor(readSearchSourceProgressContract).length).toBeGreaterThan(2)
    expect(requestsFor(listKnowledgeConnectorDocumentsContract)).toHaveLength(2)

    processingStatus = 'completed'
    serverSyncing = false
    await advance(CONNECTOR_SYNC_POLL_INTERVAL_MS)
    await advance(1)
    expect(requestsFor(listKnowledgeConnectorDocumentsContract)).toHaveLength(4)
    expect(result.data?.pages.flatMap((page) => page.documents)).toEqual([
      expect.objectContaining({ id: 'document-0', processingStatus: 'completed' }),
      expect.objectContaining({ id: 'document-1', processingStatus: 'completed' }),
    ])

    const completedProbeCount = requestsFor(readSearchSourceProgressContract).length
    await advance(30_000)
    expect(requestsFor(readSearchSourceProgressContract)).toHaveLength(completedProbeCount)
    expect(requestsFor(listKnowledgeConnectorDocumentsContract)).toHaveLength(4)
  })

  it('restarts an idle probe when a new sync is queued without polling document pages', async () => {
    await render({ progressScope: SCOPE, syncing: false })
    const idleProbeCount = requestsFor(readSearchSourceProgressContract).length
    const idleDocumentCount = requestsFor(listKnowledgeConnectorDocumentsContract).length
    await advance(30_000)
    expect(requestsFor(readSearchSourceProgressContract)).toHaveLength(idleProbeCount)

    serverSyncing = true
    await render({ progressScope: SCOPE, syncing: true })
    await advance(CONNECTOR_SYNC_POLL_INTERVAL_MS)
    expect(requestsFor(readSearchSourceProgressContract).length).toBeGreaterThan(idleProbeCount)
    expect(requestsFor(listKnowledgeConnectorDocumentsContract)).toHaveLength(idleDocumentCount)
  })

  it('cancels a stale in-flight document snapshot when indexing completes', async () => {
    serverSyncing = true
    await render({ progressScope: SCOPE })
    const request = mocks.request.getMockImplementation()!
    let staleRequestSignal: AbortSignal | undefined
    mocks.request.mockImplementation((contract: unknown, input: RequestInput) => {
      if (contract === listKnowledgeConnectorDocumentsContract && !staleRequestSignal) {
        staleRequestSignal = input.signal
        return new Promise((_resolve, reject) => {
          input.signal?.addEventListener('abort', () => reject(new Error('Request aborted')), {
            once: true,
          })
        })
      }
      return request(contract, input)
    })
    await act(async () => {
      void result.refetch()
    })
    expect(staleRequestSignal?.aborted).toBe(false)

    processingStatus = 'completed'
    serverSyncing = false
    await advance(CONNECTOR_SYNC_POLL_INTERVAL_MS)
    await advance(1)

    expect(staleRequestSignal?.aborted).toBe(true)
    expect(result.data?.pages[0].documents[0].processingStatus).toBe('completed')
    const completedDocumentCount = requestsFor(listKnowledgeConnectorDocumentsContract).length
    await advance(30_000)
    expect(requestsFor(listKnowledgeConnectorDocumentsContract)).toHaveLength(
      completedDocumentCount
    )
  })

  it('restarts after a document retry invalidates the existing connector cache prefix', async () => {
    await render({ progressScope: SCOPE, syncing: false })
    const idleProbeCount = requestsFor(readSearchSourceProgressContract).length
    serverSyncing = true
    await act(async () => {
      await client.invalidateQueries({ queryKey: connectorKeys.all(KB_ID) })
    })
    await advance(1)
    expect(requestsFor(readSearchSourceProgressContract).length).toBeGreaterThan(idleProbeCount)

    const retryProbeCount = requestsFor(readSearchSourceProgressContract).length
    const retryDocumentCount = requestsFor(listKnowledgeConnectorDocumentsContract).length
    await advance(CONNECTOR_SYNC_POLL_INTERVAL_MS)
    expect(requestsFor(readSearchSourceProgressContract).length).toBeGreaterThan(retryProbeCount)
    expect(requestsFor(listKnowledgeConnectorDocumentsContract)).toHaveLength(retryDocumentCount)
  })

  it('reduces probe frequency for long indexing runs without refetching document pages', async () => {
    serverSyncing = true
    await render({ progressScope: SCOPE, syncing: false })
    for (let index = 0; index < 20; index++) {
      await advance(CONNECTOR_SYNC_POLL_INTERVAL_MS)
    }
    const probeCount = requestsFor(readSearchSourceProgressContract).length
    await advance(CONNECTOR_SYNC_POLL_INTERVAL_MS)
    expect(requestsFor(readSearchSourceProgressContract)).toHaveLength(probeCount)
    await advance(15_000)
    expect(requestsFor(readSearchSourceProgressContract).length).toBeGreaterThan(probeCount)
    expect(requestsFor(listKnowledgeConnectorDocumentsContract)).toHaveLength(1)
  })
})
