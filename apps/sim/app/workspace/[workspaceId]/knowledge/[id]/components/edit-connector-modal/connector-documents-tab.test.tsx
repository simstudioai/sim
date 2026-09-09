/** @vitest-environment jsdom */
import { act } from 'react'
import { ChipModal, ChipModalBody } from '@sim/emcn'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  retry: vi.fn(),
  exclude: vi.fn(),
  restore: vi.fn(),
  refetch: vi.fn(),
  fetchNextPage: vi.fn(),
  excludeState: { error: null as Error | null, isPending: false, reset: vi.fn() },
  restoreState: { error: null as Error | null, isPending: false, reset: vi.fn() },
  retryState: { error: null as Error | null, isPending: false, reset: vi.fn() },
}))
vi.mock('@/hooks/queries/kb/connectors', () => ({
  useConnectorDocuments: mocks.query,
  useExcludeConnectorDocument: () => ({ ...mocks.excludeState, mutate: mocks.exclude }),
  useRestoreConnectorDocument: () => ({ ...mocks.restoreState, mutate: mocks.restore }),
}))
vi.mock('@/hooks/queries/kb/knowledge', () => ({
  useUpdateDocument: () => ({ ...mocks.retryState, mutate: mocks.retry }),
}))

import { ConnectorDocuments } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-documents/connector-documents'
import { ConnectorDocumentsTab } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/edit-connector-modal/connector-documents-tab'

let root: Root
function render() {
  root = createRoot(document.createElement('div'))
  rerender()
}
function rerender() {
  act(() =>
    root.render(
      <ChipModal open srTitle='Source settings'>
        <ChipModalBody>
          <ConnectorDocumentsTab knowledgeBaseId='kb' connectorId='connector' />
        </ChipModalBody>
      </ChipModal>
    )
  )
}
function button(name: string) {
  const result = [...document.querySelectorAll('button')].find(
    (node) => node.textContent?.trim() === name
  )
  if (!result) throw new Error(`Missing button ${name}`)
  return result
}
beforeEach(() => {
  vi.clearAllMocks()
  for (const state of [mocks.excludeState, mocks.restoreState, mocks.retryState]) {
    state.error = null
    state.isPending = false
    state.reset.mockImplementation(() => {
      state.error = null
    })
  }
  mocks.retry.mockReset()
  mocks.query.mockReturnValue({
    data: {
      pages: [
        {
          documents: [
            {
              id: 'failed',
              filename: 'Handbook.txt',
              processingStatus: 'failed',
              userExcluded: false,
            },
            {
              id: 'ready',
              filename: 'Guide.txt',
              processingStatus: 'completed',
              userExcluded: false,
            },
          ],
          counts: { active: 3, excluded: 0, failed: 1 },
        },
      ],
    },
    isLoading: false,
    isError: false,
    isFetching: false,
    hasNextPage: true,
    isFetchingNextPage: false,
    fetchNextPage: mocks.fetchNextPage,
    refetch: mocks.refetch,
  })
})
afterEach(() => {
  if (root) act(() => root.unmount())
})

describe('connector document recovery', () => {
  it('labels Search documents by the current viewer access without changing general knowledge bases', () => {
    render()
    expect(document.body.textContent).not.toContain('Documents you can access')
    act(() =>
      root.render(
        <ChipModal open srTitle='Source documents'>
          <ChipModalBody>
            <ConnectorDocuments
              knowledgeBaseId='kb'
              connectorId='connector'
              isSearchIndex
              filter='active'
              onFilterChange={vi.fn()}
            />
          </ChipModalBody>
        </ChipModal>
      )
    )
    expect(document.body.textContent).toContain('Documents you can access')
    expect(document.body.textContent).toContain('Handbook.txt')
  })

  it('shows the failed file and retries through the existing scoped document mutation', () => {
    render()
    expect(document.body.textContent).toContain('Indexing failed')
    act(() => button('Retry indexing').click())
    expect(mocks.retry).toHaveBeenCalledWith({
      knowledgeBaseId: 'kb',
      documentId: 'failed',
      updates: { retryProcessing: true },
    })
  })
  it('requests failed documents from the server and hides healthy placeholder rows', () => {
    render()
    act(() =>
      document
        .querySelector('[aria-label="Document status"]')
        ?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    )
    const failed = [...document.querySelectorAll('[role="menuitem"]')].find((item) =>
      item.textContent?.includes('Failed (1)')
    ) as HTMLElement
    act(() => failed.click())
    expect(mocks.query).toHaveBeenLastCalledWith('kb', 'connector', {
      filter: 'failed',
      search: undefined,
    })
    expect(document.body.textContent).toContain('Handbook.txt')
    expect(document.body.textContent).not.toContain('Guide.txt')
  })
  it.each([false, true])(
    'clears prior action errors before retry (retry fails: %s)',
    (retryFails) => {
      mocks.excludeState.error = new Error('Previous exclusion failure')
      if (retryFails)
        mocks.retry.mockImplementation(() => {
          mocks.retryState.error = new Error('New retry failure')
        })
      render()
      expect(document.body.textContent).toContain('Previous exclusion failure')
      act(() => button('Retry indexing').click())
      rerender()
      expect(document.body.textContent).not.toContain('Previous exclusion failure')
      expect(document.body.textContent?.includes('New retry failure')).toBe(retryFails)
      expect(mocks.excludeState.reset).toHaveBeenCalledOnce()
      expect(mocks.restoreState.reset).toHaveBeenCalledOnce()
      expect(mocks.retryState.reset).toHaveBeenCalledOnce()
    }
  )
  it('prevents conflicting recovery actions while any mutation is pending', () => {
    mocks.excludeState.isPending = true
    render()
    expect(button('Retry indexing').disabled).toBe(true)
    expect(button('Exclude').disabled).toBe(true)
  })
  it('keeps the existing document pagination control', () => {
    render()
    act(() => button('Load more documents').click())
    expect(mocks.fetchNextPage).toHaveBeenCalledOnce()
  })
  it('keeps loaded documents visible when loading the next page fails', () => {
    render()
    const query = mocks.query.mock.results.at(-1)?.value
    mocks.query.mockReturnValue({
      ...query,
      isError: true,
      isFetchNextPageError: true,
      error: new Error('Next page failed'),
    })
    rerender()
    expect(document.body.textContent).toContain('Guide.txt')
    expect(document.body.textContent).toContain('Next page failed')
    act(() => button('Try again').click())
    expect(mocks.fetchNextPage).toHaveBeenCalledOnce()
    expect(mocks.refetch).not.toHaveBeenCalled()
  })

  it('renders an actionable loading failure rather than claiming no documents exist', () => {
    mocks.query.mockReturnValue({
      isError: true,
      error: new Error('Unable to load'),
      refetch: mocks.refetch,
      isFetching: false,
    })
    render()
    expect(document.body.textContent).toContain('Unable to load')
    expect(document.body.textContent).not.toContain('No documents yet')
    act(() => button('Try again').click())
    expect(mocks.refetch).toHaveBeenCalledOnce()
  })
})
