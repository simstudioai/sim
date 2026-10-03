import { apiClientRequestMock } from '@sim/testing/mocks/api-client-request.mock'
import { authClientMock, authClientMockFns } from '@sim/testing/mocks/auth-client.mock'
import { deploymentShapeMock } from '@sim/testing/mocks/deployment-shape.mock'
import { emcnMock } from '@sim/testing/mocks/emcn.mock'
import { reactQueryMock, reactQueryMockFns } from '@sim/testing/mocks/react-query.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/auth-client', () => authClientMock)

vi.mock('@/lib/core/config/deployment-shape', () => deploymentShapeMock)

vi.mock('@tanstack/react-query', () => reactQueryMock)

vi.mock('@sim/emcn', () => emcnMock)

vi.mock('@/lib/api/client/request', () => apiClientRequestMock)

import {
  useDocumentChunkSearchQuery,
  useDocumentQuery,
  useKnowledgeBasesQuery,
  useKnowledgeChunksQuery,
  useWorkspaceKnowledgeSearch,
} from '@/hooks/queries/kb/knowledge'
import { knowledgeKeys } from '@/hooks/queries/utils/knowledge-keys'

const mocks = {
  live: false,
  useMutation: reactQueryMockFns.mockUseMutation,
  useQuery: reactQueryMockFns.mockUseQuery,
  invalidateQueries: reactQueryMockFns.mockQueryClient.invalidateQueries,
  getQueryData: reactQueryMockFns.mockQueryClient.getQueryData,
}
authClientMockFns.mockUseSession.mockReturnValue({ data: { user: { id: 'reader' } } })

interface CapturedQuery {
  queryKey: readonly unknown[]
  queryFn: (context: { signal: AbortSignal }) => Promise<unknown>
  retry?: boolean
  placeholderData?: (
    previous: unknown,
    query: { queryKey: readonly unknown[]; state?: { status: string; isInvalidated: boolean } }
  ) => unknown
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
  beforeEach(() => {
    mocks.live = false
  })

  it('does not carry a prior workspace list or document detail into another resource', () => {
    expect(
      captureQuery(() => useKnowledgeBasesQuery('workspace-2')).placeholderData
    ).toBeUndefined()
    expect(captureQuery(() => useDocumentQuery('kb-2', 'doc-2')).placeholderData).toBeUndefined()
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

  it('partitions search cache entries by filter and reader', () => {
    const query = captureQuery(() =>
      useWorkspaceKnowledgeSearch('workspace-1', 'new query', { source: 'slack' })
    )
    expect(query.queryKey).toEqual([
      ...knowledgeKeys.search('workspace-1', 'new query', { source: 'slack' }, 20, 'reader'),
      'live',
    ])
    expect(knowledgeKeys.search('workspace-1', 'query', { source: 'slack' })).not.toEqual(
      knowledgeKeys.search('workspace-1', 'query', { source: 'gitlab' })
    )
    expect(knowledgeKeys.search('workspace-1', 'query', {}, 20, 'reader')).not.toEqual(
      knowledgeKeys.search('workspace-1', 'query', {}, 20, 'another-reader')
    )
    expect(knowledgeKeys.search('workspace-1', 'query', {}, 5)).not.toEqual(
      knowledgeKeys.search('workspace-1', 'query', {}, 20)
    )
  })
})
