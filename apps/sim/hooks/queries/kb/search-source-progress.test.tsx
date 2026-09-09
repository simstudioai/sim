/** @vitest-environment jsdom */
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requestJson: vi.fn() }))
vi.mock('@/lib/api/client/request', () => ({ requestJson: mocks.requestJson }))

import {
  connectorKeys,
  searchSourceKeys,
  useSearchSources,
  useTriggerSync,
} from '@/hooks/queries/kb/connectors'

let root: Root
let container: HTMLDivElement
let client: QueryClient
let syncing: boolean
let progressFails: boolean
let enabled: boolean

function Probe() {
  const result = useSearchSources('workspace', { enabled })
  const sync = useTriggerSync()
  return (
    <div>
      <span>{result.data?.[0]?.viewerDocumentCount ?? 0}</span>
      <button
        disabled={sync.isPending}
        onClick={() => sync.mutate({ knowledgeBaseId: 'kb', connectorId: 'source' })}
      >
        Sync
      </button>
    </div>
  )
}
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}
async function mount() {
  container = document.createElement('div')
  root = createRoot(container)
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    )
  )
  await advance(1)
}
const calls = (suffix: string) =>
  mocks.requestJson.mock.calls.filter(([contract]) => contract.path.endsWith(suffix))

beforeEach(() => {
  vi.useFakeTimers()
  syncing = true
  progressFails = false
  enabled = true
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Number.POSITIVE_INFINITY } },
  })
  mocks.requestJson.mockReset().mockImplementation(async (contract) => {
    if (contract.path.endsWith('/progress')) {
      if (progressFails) throw new Error('Temporary progress error')
      return {
        data: [
          {
            connectorId: 'source',
            isSyncing: syncing,
            hasSyncError: false,
            hasIndexingError: false,
          },
        ],
      }
    }
    return {
      data: {
        sources: [
          {
            connectorId: 'source',
            isSyncing: syncing,
            hasSyncError: false,
            viewerFailedDocumentCount: 0,
            viewerDocumentCount: syncing ? 0 : 1,
          },
        ],
        nextCursor: null,
      },
    }
  })
})
afterEach(() => {
  if (root) act(() => root.unmount())
  client.clear()
  vi.useRealTimers()
})

describe('source progress polling', () => {
  it('starts source progress only after the sync is queued and stops when it completes', async () => {
    syncing = false
    const queued = Promise.withResolvers<void>()
    const original = mocks.requestJson.getMockImplementation()!
    mocks.requestJson.mockImplementation((contract, input) =>
      contract.path.endsWith('/sync') ? queued.promise : original(contract, input)
    )
    client.setQueryData(connectorKeys.lists('kb'), [
      { id: 'source', knowledgeBaseId: 'kb', status: 'active' },
    ])
    await mount()
    await act(async () => container.querySelector('button')!.click())
    await advance(1)
    expect(container.querySelector('button')?.disabled).toBe(true)
    expect(client.getQueryData(connectorKeys.lists('kb'))).toMatchObject([{ status: 'pending' }])
    await advance(3000)
    expect(calls('/progress')).toHaveLength(0)
    expect(calls('/sources')).toHaveLength(1)
    syncing = true
    await act(async () => queued.resolve())
    await advance(1)
    expect(calls('/sources')).toHaveLength(2)
    expect(calls('/progress').length).toBeGreaterThan(0)
    expect(container.querySelector('button')?.disabled).toBe(false)
    syncing = false
    await advance(3000)
    await advance(1)
    expect(
      client.getQueryData(searchSourceKeys.pages('workspace', { search: '', mine: false }))
    ).toMatchObject({ pages: [{ sources: [{ isSyncing: false, viewerDocumentCount: 1 }] }] })
    const total = mocks.requestJson.mock.calls.length
    await advance(60_000)
    expect(mocks.requestJson).toHaveBeenCalledTimes(total)
  })

  it('checks progress without recounting every three seconds and slows long waits', async () => {
    await mount()
    for (let i = 0; i < 20; i++) await advance(3000)
    expect(calls('/sources')).toHaveLength(3)
    const progressCalls = calls('/progress').length
    expect(progressCalls).toBeGreaterThanOrEqual(20)
    await advance(3000)
    expect(calls('/progress')).toHaveLength(progressCalls)
    await advance(12_000)
    expect(calls('/progress')).toHaveLength(progressCalls + 1)
    expect(calls('/progress')[0][1]).toMatchObject({
      body: { workspaceId: 'workspace', connectorIds: ['source'] },
      signal: expect.any(AbortSignal),
    })
  })
  it('refreshes exact counts at completion and stops both polls', async () => {
    await mount()
    syncing = false
    await advance(3000)
    await advance(1)
    expect(calls('/sources')).toHaveLength(2)
    expect(
      client.getQueryData(searchSourceKeys.pages('workspace', { search: '', mine: false }))
    ).toMatchObject({
      pages: [{ sources: [expect.objectContaining({ isSyncing: false, viewerDocumentCount: 1 })] }],
    })
    const total = mocks.requestJson.mock.calls.length
    await advance(60_000)
    expect(mocks.requestJson).toHaveBeenCalledTimes(total)
  })
  it('keeps periodic full reconciliation if the progress request fails', async () => {
    progressFails = true
    await mount()
    syncing = false
    await advance(30_000)
    await advance(1)
    expect(calls('/sources')).toHaveLength(2)
    expect(
      client.getQueryData(searchSourceKeys.pages('workspace', { search: '', mine: false }))
    ).toMatchObject({
      pages: [{ sources: [expect.objectContaining({ isSyncing: false, viewerDocumentCount: 1 })] }],
    })
  })
  it('lets a slow summary refresh finish while progress keeps polling', async () => {
    const refresh = Promise.withResolvers<unknown>()
    const original = mocks.requestJson.getMockImplementation()!
    const signals: AbortSignal[] = []
    mocks.requestJson.mockImplementation((contract, input) => {
      if (contract.path.endsWith('/sources') && calls('/sources').length > 1) {
        signals.push(input.signal)
        return refresh.promise
      }
      return original(contract, input)
    })
    await mount()
    syncing = false
    await advance(3000)
    await advance(1)
    await advance(3000)
    await advance(3000)
    expect(calls('/sources')).toHaveLength(2)
    expect(signals).toHaveLength(1)
    expect(signals[0].aborted).toBe(false)
    await act(async () => refresh.resolve(await original({ path: '/sources' }, {})))
    await advance(1)
    expect(
      client.getQueryData(searchSourceKeys.pages('workspace', { search: '', mine: false }))
    ).toMatchObject({
      pages: [{ sources: [expect.objectContaining({ isSyncing: false, viewerDocumentCount: 1 })] }],
    })
    const total = mocks.requestJson.mock.calls.length
    await advance(60_000)
    expect(mocks.requestJson).toHaveBeenCalledTimes(total)
  })
  it('does not poll on a disabled surface', async () => {
    enabled = false
    await mount()
    await advance(60_000)
    expect(mocks.requestJson).not.toHaveBeenCalled()
  })
})
