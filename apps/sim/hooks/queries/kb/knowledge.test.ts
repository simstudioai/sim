/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requestJson: vi.fn(),
  useMutation: vi.fn(),
  useQuery: vi.fn(),
  invalidateQueries: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  keepPreviousData: Symbol('keepPreviousData'),
  useInfiniteQuery: vi.fn(),
  useMutation: mocks.useMutation,
  useQuery: mocks.useQuery,
  useQueryClient: vi.fn(() => ({ invalidateQueries: mocks.invalidateQueries })),
}))

vi.mock('@sim/emcn', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock('@/lib/api/client/request', () => ({
  requestJson: mocks.requestJson,
}))

import {
  useBulkDocumentOperation,
  useDeleteDocument,
  useDocumentChunkSearchQuery,
  useDocumentQuery,
  useKnowledgeBasesQuery,
  useKnowledgeChunksQuery,
  useKnowledgeDocumentsQuery,
  useUpdateDocument,
  useUpdateDocumentTags,
  useWorkspaceKnowledgeSearch,
} from '@/hooks/queries/kb/knowledge'
import { knowledgeKeys } from '@/hooks/queries/utils/knowledge-keys'

interface CapturedMutation {
  onSettled: (data: unknown, error: unknown, variables: Record<string, unknown>) => void
}

function captureMutation(build: () => unknown): CapturedMutation {
  let captured: CapturedMutation | undefined
  mocks.useMutation.mockImplementation((options: CapturedMutation) => {
    captured = options
    return {}
  })
  build()
  if (!captured) throw new Error('useMutation was not called')
  return captured
}

describe('knowledge document mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('invalidates the knowledge-base lists when a document is deleted', () => {
    const mutation = captureMutation(() => useDeleteDocument())

    mutation.onSettled(undefined, undefined, { knowledgeBaseId: 'kb-1', documentId: 'doc-1' })

    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: knowledgeKeys.lists() })
  })

  it('invalidates the knowledge-base lists on a bulk delete', () => {
    const mutation = captureMutation(() => useBulkDocumentOperation())

    mutation.onSettled(undefined, undefined, { knowledgeBaseId: 'kb-1', operation: 'delete' })

    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: knowledgeKeys.lists() })
  })

  /**
   * `documents` (the list pages) and `document` (one row) are siblings under `detail`, so
   * invalidating the row's key alone leaves the list rendering the filename, status, tags, and
   * counts the write just changed.
   */
  it.each([
    ['a document update', () => useUpdateDocument()],
    ['a document tag update', () => useUpdateDocumentTags()],
  ])('refreshes the document list pages after %s', (_label, build) => {
    const mutation = captureMutation(build)

    mutation.onSettled(undefined, undefined, { knowledgeBaseId: 'kb-1', documentId: 'doc-1' })

    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: knowledgeKeys.documentLists('kb-1'),
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: knowledgeKeys.document('kb-1', 'doc-1'),
    })
  })

  it('leaves the knowledge-base lists alone on a bulk enable', () => {
    const mutation = captureMutation(() => useBulkDocumentOperation())

    mutation.onSettled(undefined, undefined, { knowledgeBaseId: 'kb-1', operation: 'enable' })

    expect(mocks.invalidateQueries).not.toHaveBeenCalledWith({ queryKey: knowledgeKeys.lists() })
  })
})

interface CapturedQuery {
  queryKey: readonly unknown[]
  queryFn: (context: { signal: AbortSignal }) => Promise<unknown>
  retry?: boolean
  placeholderData?: (previous: unknown, query: { queryKey: readonly unknown[] }) => unknown
}

function captureQuery(build: () => unknown): CapturedQuery {
  let captured: CapturedQuery | undefined
  mocks.useQuery.mockImplementation((options: CapturedQuery) => {
    captured = options
    return {}
  })
  build()
  if (!captured) throw new Error('useQuery was not called')
  return captured
}

describe('knowledge query placeholder scope', () => {
  it('waits for a nonempty owner before searching', () => {
    const query = captureQuery(() => useWorkspaceKnowledgeSearch('', 'query'))
    expect(query).toMatchObject({ enabled: false })
  })

  it('forwards search cancellation and leaves provider retries to the server', async () => {
    mocks.requestJson.mockResolvedValueOnce({ data: { results: [] } })
    const query = captureQuery(() =>
      useWorkspaceKnowledgeSearch('workspace-1', ' query ', { source: 'slack' })
    )
    const controller = new AbortController()
    await query.queryFn({ signal: controller.signal })

    expect(query.retry).toBe(false)
    expect(mocks.requestJson).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        signal: controller.signal,
        body: expect.objectContaining({ query: 'query' }),
      })
    )
  })

  it('does not carry a prior workspace list or document detail into another resource', () => {
    expect(
      captureQuery(() => useKnowledgeBasesQuery('workspace-2')).placeholderData
    ).toBeUndefined()
    expect(captureQuery(() => useDocumentQuery('kb-2', 'doc-2')).placeholderData).toBeUndefined()
  })

  it('keeps document pagination and filters within the same knowledge base', () => {
    const query = captureQuery(() =>
      useKnowledgeDocumentsQuery({ knowledgeBaseId: 'kb-1', search: 'new', offset: 50 })
    )
    const previous = { documents: [{ id: 'visible-document' }], pagination: { total: 1 } }
    expect(
      query.placeholderData?.(previous, { queryKey: knowledgeKeys.documents('kb-1', 'old-filter') })
    ).toBe(previous)
    expect(
      query.placeholderData?.(previous, { queryKey: knowledgeKeys.documents('kb-2', 'old-filter') })
    ).toBeUndefined()
  })

  it.each([
    [
      'chunks',
      () => useKnowledgeChunksQuery({ knowledgeBaseId: 'kb-1', documentId: 'doc-1', offset: 50 }),
    ],
    [
      'chunk search',
      () =>
        useDocumentChunkSearchQuery({
          knowledgeBaseId: 'kb-1',
          documentId: 'doc-1',
          search: 'new',
        }),
    ],
  ])('keeps %s placeholders only for the same document', (_name, build) => {
    const query = captureQuery(build)
    const previous = [{ content: 'Previously authorized content' }]
    expect(
      query.placeholderData?.(previous, { queryKey: knowledgeKeys.chunks('kb-1', 'doc-1', 'old') })
    ).toBe(previous)
    expect(
      query.placeholderData?.(previous, { queryKey: knowledgeKeys.chunks('kb-1', 'doc-2', 'old') })
    ).toBeUndefined()
    expect(
      query.placeholderData?.(previous, { queryKey: knowledgeKeys.chunks('kb-2', 'doc-1', 'old') })
    ).toBeUndefined()
  })

  it('does not reuse results from a different query, workspace, or filter', () => {
    const query = captureQuery(() =>
      useWorkspaceKnowledgeSearch('workspace-1', 'new query', { source: 'slack' })
    )
    expect(query.placeholderData).toBeUndefined()
    expect(knowledgeKeys.search('workspace-1', 'query', { source: 'slack' })).not.toEqual(
      knowledgeKeys.search('workspace-1', 'query', { source: 'gitlab' })
    )
  })
})
