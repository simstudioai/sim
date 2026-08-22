/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requestJson: vi.fn(),
  useMutation: vi.fn(),
  invalidateQueries: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  keepPreviousData: Symbol('keepPreviousData'),
  useInfiniteQuery: vi.fn(),
  useMutation: mocks.useMutation,
  useQuery: vi.fn(),
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
  useUpdateDocument,
  useUpdateDocumentTags,
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
