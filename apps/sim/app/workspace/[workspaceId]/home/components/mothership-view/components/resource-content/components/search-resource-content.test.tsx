/** @vitest-environment jsdom */
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  live: false,
  viewerId: 'reader',
  request: vi.fn(),
  summarize: vi.fn(),
  divider: vi.fn(),
}))
vi.mock('@/lib/core/config/deployment-shape', () => ({
  useDeploymentShape: () => ({ features: { liveEnterpriseSearch: mocks.live } }),
}))
vi.mock('@/lib/auth/auth-client', () => ({
  useSession: () => ({ data: { user: { id: mocks.viewerId } } }),
}))
vi.mock('@/lib/api/client/request', () => ({ requestJson: mocks.request, contractUrl: vi.fn() }))
vi.mock('@/lib/browser-agent/transport', () => ({ beginBrowserPanelDividerDrag: mocks.divider }))
vi.mock('@/hooks/queries/kb/connectors', () => ({
  useSearchIndex: () => ({ data: { knowledgeBaseId: 'index' }, isPending: false }),
  useSearchSourceOverview: () => ({ data: { providers: [] } }),
}))
vi.mock(
  '@/app/workspace/[workspaceId]/home/components/message-content/components/source-card',
  () => ({
    SourceCard: ({
      source,
      onSummarize,
    }: {
      source: { title: string; url: string }
      onSummarize: (source: { title: string; url: string }) => void
    }) => <button onClick={() => onSummarize(source)}>{source.title}</button>,
  })
)

import { resourceScopeKey } from '@/lib/core/resource-scope'
import { createSearchResource } from '@/lib/mothership/resources/search'
import { SearchResourceContent } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/search-resource-content'
import { knowledgeKeys } from '@/hooks/queries/utils/knowledge-keys'

let container: HTMLDivElement
let root: Root
let client: QueryClient

beforeEach(() => {
  vi.clearAllMocks()
  mocks.live = false
  mocks.viewerId = 'reader'
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1)
  )
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  mocks.divider.mockReturnValue(null)
  mocks.request.mockImplementation(
    (_contract: { path: string }, input: { body: { query: string } }) =>
      Promise.resolve({
        success: true,
        data: {
          query: input.body.query,
          results: [
            {
              documentId: `doc-${input.body.query}`,
              knowledgeBaseId: 'index',
              knowledgeBaseName: 'Sources',
              documentName: `Result for ${input.body.query}`,
              sourceUrl: 'https://example.test/document',
              connectorType: 'google_drive',
              sourceModifiedAt: null,
              author: null,
              content: `${input.body.query} evidence`,
              chunkIndex: 0,
              similarity: 0.9,
            },
          ],
          retrieval: { status: 'complete', timedOutLegs: [] },
        },
      })
  )
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  client.clear()
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function render(query: string, nativeQueries?: [{ provider: 'github'; query: string }]) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <NuqsTestingAdapter>
          <SearchResourceContent
            resource={createSearchResource({
              query,
              scope: { kind: 'organization', organizationId: 'org' },
              filters: { source: 'google_drive' },
              topK: 12,
              ...(nativeQueries ? { nativeQueries } : {}),
            })}
            onSummarize={mocks.summarize}
          />
        </NuqsTestingAdapter>
      </QueryClientProvider>
    )
  )
  await vi.waitFor(async () => {
    await act(async () => {})
    expect(client.isFetching()).toBe(0)
    expect(container.querySelector('[aria-busy="true"]')).toBeNull()
  })
}
describe('shared Search resource content', () => {
  it('uses the streamed live native results without a second provider request', async () => {
    mocks.live = true
    const nativeQueries = [{ provider: 'github' as const, query: 'repo:simstudioai/sim release' }]
    client.setQueryData(
      [
        ...knowledgeKeys.search(
          resourceScopeKey({ kind: 'organization', organizationId: 'org' }),
          'release',
          { source: 'google_drive' },
          12,
          'reader',
          nativeQueries
        ),
        'live',
      ],
      {
        query: 'release',
        results: [
          {
            documentId: 'live-doc',
            knowledgeBaseId: '',
            knowledgeBaseName: '',
            documentName: 'Streamed native result',
            sourceUrl: 'https://github.com/simstudioai/sim',
            connectorType: 'github',
            sourceModifiedAt: null,
            author: null,
            content: 'release',
            chunkIndex: 0,
            similarity: 1,
          },
        ],
        retrieval: { status: 'complete', timedOutLegs: [] },
      }
    )
    await render('release', nativeQueries)
    expect(container.textContent).toContain('Streamed native result')
    expect(mocks.request).not.toHaveBeenCalled()
  })
  it('renders live authorized tool data without searching twice and refetches with a fresh viewer cache', async () => {
    const key = [
      ...knowledgeKeys.search(
        resourceScopeKey({ kind: 'organization', organizationId: 'org' }),
        'release',
        { source: 'google_drive' },
        12,
        'reader'
      ),
      'indexed',
    ]
    client.setQueryData(key, {
      query: 'release',
      results: [
        {
          documentId: 'live-doc',
          knowledgeBaseId: 'index',
          knowledgeBaseName: 'Sources',
          documentName: 'Authorized live result',
          sourceUrl: 'https://example.test/live',
          connectorType: 'google_drive',
          sourceModifiedAt: null,
          author: null,
          content: 'live evidence',
          chunkIndex: 0,
          similarity: 0.9,
        },
      ],
      retrieval: { status: 'complete', timedOutLegs: [] },
    })
    await render('release')
    expect(container.textContent).toContain('Authorized live result')
    expect(mocks.request).not.toHaveBeenCalled()
    mocks.viewerId = 'another-reader'
    await render('release')
    expect(mocks.request).toHaveBeenCalledOnce()
    expect(container.textContent).not.toContain('Authorized live result')
    await act(async () => root.unmount())
    client.clear()
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    root = createRoot(container)
    await render('release')
    expect(mocks.request).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('Result for release')
    expect(container.textContent).not.toContain('Authorized live result')
  })

  it('queries the authorized raw search endpoint without waiting for or requesting a model answer', async () => {
    await render('release')
    expect(container.textContent).toContain('Result for release')
    expect(mocks.request).toHaveBeenCalledOnce()
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/api/knowledge/search' }),
      expect.objectContaining({
        body: {
          organizationId: 'org',
          query: 'release',
          filters: { source: 'google_drive' },
          topK: 12,
        },
        signal: expect.any(AbortSignal),
      })
    )
    expect(mocks.summarize).not.toHaveBeenCalled()
    await act(async () =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Result for release')!
        .click()
    )
    expect(mocks.summarize).toHaveBeenCalledExactlyOnceWith('Summarize "Result for release"', {
      documentIds: ['doc-release'],
      source: 'google_drive',
    })
    expect(mocks.request).toHaveBeenCalledOnce()
  })

  it('replaces results when the tool refines its query', async () => {
    await render('release')
    await render('onboarding')
    expect(mocks.request).toHaveBeenCalledTimes(2)
    expect(container.textContent).not.toContain('Result for release')
    expect(container.textContent).toContain('Result for onboarding')
    expect(mocks.summarize).not.toHaveBeenCalled()
  })

  it('retries a failed raw search without resending the conversation', async () => {
    mocks.request.mockRejectedValueOnce(new Error('Search temporarily unavailable'))
    await render('release')
    await vi.waitFor(async () => {
      await act(async () => {})
      expect(container.textContent).toContain('Search couldn’t run.')
    })
    const retry = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Try again'
    )!
    await act(async () => {
      retry.click()
      await vi.waitFor(() => expect(client.isFetching()).toBe(0))
    })
    await vi.waitFor(async () => {
      await act(async () => {})
      expect(container.textContent).toContain('Result for release')
    })
    expect(mocks.request).toHaveBeenCalledTimes(2)
    expect(mocks.summarize).not.toHaveBeenCalled()
  })
})
