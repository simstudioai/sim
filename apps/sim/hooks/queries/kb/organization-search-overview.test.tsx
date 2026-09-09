/** @vitest-environment jsdom */
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requestJson: vi.fn() }))
vi.mock('@/lib/api/client/request', () => ({ requestJson: mocks.requestJson }))

import {
  searchSourceKeys,
  useOrganizationSearchOverview,
  useSearchSources,
} from '@/hooks/queries/kb/connectors'

let root: Root
let container: HTMLDivElement
let client: QueryClient
let enabled: boolean
let connectorType: string
const scope = { kind: 'organization', organizationId: 'organization' } as const

function OverviewProbe() {
  const result = useOrganizationSearchOverview(scope.organizationId, { enabled })
  return <div>{result.data?.providers[0]?.sourceCount ?? 'loading'}</div>
}
function SourcesProbe() {
  const result = useSearchSources(scope, { connectorType })
  return <div>{result.data?.[0]?.connectorId ?? 'loading'}</div>
}
async function render(kind: 'overview' | 'sources') {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        {kind === 'overview' ? <OverviewProbe /> : <SourcesProbe />}
      </QueryClientProvider>
    )
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
}
beforeEach(() => {
  vi.useFakeTimers()
  enabled = false
  connectorType = 'google_drive'
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Number.POSITIVE_INFINITY } },
  })
  container = document.createElement('div')
  root = createRoot(container)
  mocks.requestJson.mockReset().mockImplementation(async (contract, input) =>
    contract.path.endsWith('/integrations/overview')
      ? {
          data: {
            providers: [
              {
                connectorType: 'gmail',
                sourceCount: 3,
                approved: true,
                status: 'active',
                isSyncing: false,
              },
            ],
          },
        }
      : {
          data: {
            sources: [{ connectorId: input.query.connectorType, isSyncing: false }],
            nextCursor: null,
          },
        }
  )
})
afterEach(() => {
  act(() => root.unmount())
  client.clear()
  vi.useRealTimers()
})

describe('organization Search queries', () => {
  it('waits for admin authorization and reconciles through existing source invalidation', async () => {
    await render('overview')
    expect(mocks.requestJson).not.toHaveBeenCalled()
    enabled = true
    await render('overview')
    expect(container.textContent).toBe('3')
    expect(mocks.requestJson).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/api/knowledge/sim-search/integrations/overview' }),
      {
        query: { organizationId: 'organization' },
        signal: expect.any(AbortSignal),
      }
    )
    await act(async () => {
      await client.invalidateQueries({ queryKey: searchSourceKeys.list(scope) })
    })
    expect(mocks.requestJson).toHaveBeenCalledTimes(2)
  })
  it('keeps source pages and requests separate when the selected provider changes', async () => {
    await render('sources')
    expect(container.textContent).toBe('google_drive')
    connectorType = 'gmail'
    await render('sources')
    expect(container.textContent).toBe('gmail')
    expect(mocks.requestJson.mock.calls.map(([, input]) => input.query)).toEqual([
      { organizationId: 'organization', connectorType: 'google_drive', search: '', mine: false },
      { organizationId: 'organization', connectorType: 'gmail', search: '', mine: false },
    ])
    expect(
      client.getQueryData(
        searchSourceKeys.pages(scope, { connectorType: 'google_drive', search: '', mine: false })
      )
    ).toMatchObject({ pages: [{ sources: [{ connectorId: 'google_drive' }] }] })
  })

  it.each([
    { status: 'waiting_for_connections', isSyncing: false, requests: 1 },
    { status: 'indexing', isSyncing: true, requests: 2 },
    { status: 'needs_attention', isSyncing: true, requests: 2 },
    { status: 'needs_attention', isSyncing: false, requests: 1 },
  ])('polls only pending work when status is $status', async ({ status, isSyncing, requests }) => {
    enabled = true
    mocks.requestJson.mockResolvedValue({
      data: {
        providers: [{ connectorType: 'gmail', sourceCount: 1, approved: true, status, isSyncing }],
      },
    })
    await render('overview')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(mocks.requestJson).toHaveBeenCalledTimes(requests)
  })
})
