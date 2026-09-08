/** @vitest-environment jsdom */
import { act } from 'react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ overview: vi.fn() }))
vi.mock('@/hooks/queries/kb/connectors', () => ({
  useSearchIndex: () => ({ data: { knowledgeBaseId: 'index' }, isPending: false }),
  useSearchSourceOverview: mocks.overview,
}))
vi.mock('@/hooks/queries/kb/knowledge', () => ({
  useWorkspaceKnowledgeSearch: () => ({
    data: [],
    isPending: false,
    isFetching: false,
    isError: false,
  }),
}))
vi.mock(
  '@/app/workspace/[workspaceId]/home/components/message-content/components/source-card',
  () => ({ SourceCard: () => null })
)

import { KnowledgeSearchResults } from '@/app/workspace/[workspaceId]/home/components/knowledge-search-results/knowledge-search-results'

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  vi.unstubAllGlobals()
})
async function render() {
  await act(async () =>
    root.render(
      <NuqsTestingAdapter>
        <KnowledgeSearchResults workspaceId='workspace' query='launch' onSummarize={vi.fn()} />
      </NuqsTestingAdapter>
    )
  )
}

describe('source indexing context in search results', () => {
  it('uses provider overview state independently of loaded source pages', async () => {
    mocks.overview.mockReturnValue({
      data: {
        providers: [
          { connectorType: 'google_drive', isSyncing: true },
          { connectorType: 'slack', isSyncing: false },
        ],
        hasSearchableDocuments: false,
      },
    })
    await render()
    expect(mocks.overview).toHaveBeenCalledWith({ kind: 'workspace', workspaceId: 'workspace' })
    expect(container.textContent).toContain('Google Drive')
    expect(container.textContent).not.toContain('Slack')
  })
  it('does not invent indexing progress while the overview is unavailable', async () => {
    mocks.overview.mockReturnValue({ data: undefined })
    await render()
    expect(container.textContent).not.toContain('Still indexing')
    expect(container.textContent).toContain('No documents you can read match')
  })
})
