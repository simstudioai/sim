import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  live: false,
  requestJson: vi.fn(),
  useMutation: vi.fn(),
  useQuery: vi.fn(),
  invalidateQueries: vi.fn(),
  getQueryData: vi.fn(),
}))

vi.mock('@/lib/auth/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'reader' } } }),
}))

vi.mock('@/lib/core/config/deployment-shape', () => ({
  useDeploymentShape: () => ({ features: { liveEnterpriseSearch: mocks.live } }),
}))

vi.mock('@tanstack/react-query', () => ({
  keepPreviousData: Symbol('keepPreviousData'),
  useInfiniteQuery: vi.fn(),
  useMutation: mocks.useMutation,
  useQuery: mocks.useQuery,
  useQueryClient: vi.fn(() => ({
    invalidateQueries: mocks.invalidateQueries,
    getQueryData: mocks.getQueryData,
  })),
}))

vi.mock('@/lib/auth/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'reader' } } }),
}))

vi.mock('@sim/emcn', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock('@/lib/api/client/request', () => ({
  requestJson: mocks.requestJson,
}))

import {
  useDocumentChunkSearchQuery,
  useDocumentQuery,
  useKnowledgeBasesQuery,
  useKnowledgeChunksQuery,
  useWorkspaceKnowledgeSearch,
} from '@/hooks/queries/kb/knowledge'
import { knowledgeKeys } from '@/hooks/queries/utils/knowledge-keys'

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

  it('retains successful refinements only for the same reader, query, scope, and result limit', () => {
    const query = captureQuery(() =>
      useWorkspaceKnowledgeSearch('workspace-1', 'release', { source: 'slack' }, 5)
    )
    const previous = { results: [{ documentId: 'private-document' }] }
    mocks.getQueryData.mockReturnValue(previous)
    const placeholder = (scope: string, text: string, topK: number, userId: string) =>
      query.placeholderData?.(previous, {
        queryKey: knowledgeKeys.search(scope, text, {}, topK, userId),
        state: { status: 'success', isInvalidated: false },
      })
    expect(placeholder('workspace-1', 'release', 5, 'reader')).toBe(previous)
    expect(placeholder('workspace-1', 'release', 20, 'reader')).toBeUndefined()
    expect(placeholder('workspace-1', 'release', 5, 'other')).toBeUndefined()
    expect(placeholder('workspace-2', 'release', 5, 'reader')).toBeUndefined()
    expect(placeholder('workspace-1', 'different', 5, 'reader')).toBeUndefined()
  })

  it('retains a page-owned search across result limits only for the same reader', () => {
    const query = captureQuery(() =>
      useWorkspaceKnowledgeSearch('workspace-1', 'release', { source: 'slack' }, 50, {
        retainAcrossLimits: true,
      })
    )
    const previous = { results: [{ documentId: 'private-document' }] }
    mocks.getQueryData.mockReturnValue(previous)
    const placeholder = (topK: number, userId: string) =>
      query.placeholderData?.(previous, {
        queryKey: knowledgeKeys.search('workspace-1', 'release', {}, topK, userId),
        state: { status: 'success', isInvalidated: false },
      })
    expect(placeholder(20, 'reader')).toBe(previous)
    expect(placeholder(50, 'reader')).toBe(previous)
    expect(placeholder(20, 'other')).toBeUndefined()
  })

  it('partitions search cache entries by filter and reader', () => {
    const query = captureQuery(() =>
      useWorkspaceKnowledgeSearch('workspace-1', 'new query', { source: 'slack' })
    )
    expect(query.queryKey).toEqual([
      ...knowledgeKeys.search('workspace-1', 'new query', { source: 'slack' }, 20, 'reader'),
      'indexed',
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
