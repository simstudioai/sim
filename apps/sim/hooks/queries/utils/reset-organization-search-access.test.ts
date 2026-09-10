/** @vitest-environment node */
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import type { WorkspaceKnowledgeSearchResult } from '@/lib/api/contracts/knowledge/search'
import { resourceScopeKey } from '@/lib/core/resource-scope'
import { knowledgeKeys } from '@/hooks/queries/utils/knowledge-keys'
import { resetOrganizationSearchAccess } from '@/hooks/queries/utils/reset-organization-search-access'
import { searchSourceKeys } from '@/hooks/queries/utils/search-source-keys'

it.each([true, false])(
  'keeps administrative rows visible while revalidating access, refresh success=%s',
  async (success) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const scope = { kind: 'organization', organizationId: 'org-1' } as const
    const adminKey = searchSourceKeys.organizationOverview(scope.organizationId)
    const otherKey = searchSourceKeys.organizationOverview('org-2')
    const viewerKeys = [
      searchSourceKeys.list(scope),
      searchSourceKeys.overview(scope),
      searchSourceKeys.pages(scope, { search: '', mine: false }),
    ]
    const before = { providers: [{ connectorType: 'gmail', approved: true }] }
    const after = { providers: [{ connectorType: 'gmail', approved: false }] }
    const response = Promise.withResolvers<typeof before>()
    const fetchOverview = vi.fn(() => response.promise)
    client.setQueryData(adminKey, before)
    client.setQueryData(otherKey, before)
    for (const key of viewerKeys) client.setQueryData(key, { privateContent: 'previous access' })
    const observer = new QueryObserver(client, {
      queryKey: adminKey,
      queryFn: fetchOverview,
      staleTime: Number.POSITIVE_INFINITY,
    })
    const observed = vi.fn()
    const unsubscribe = observer.subscribe(observed)
    try {
      const refreshing = resetOrganizationSearchAccess(client, scope.organizationId)
      expect(fetchOverview).toHaveBeenCalledOnce()
      expect(observer.getCurrentResult()).toMatchObject({ data: before, isPending: false })
      for (const key of viewerKeys) expect(client.getQueryData(key)).toBeUndefined()
      expect(client.getQueryState(otherKey)?.isInvalidated).toBe(false)

      if (success) response.resolve(after)
      else response.reject(new Error('Could not refresh sources'))
      await refreshing

      expect(observer.getCurrentResult()).toMatchObject({
        data: success ? after : before,
        isError: !success,
        isFetching: false,
      })
      expect(observed.mock.calls.every(([result]) => result.data && !result.isPending)).toBe(true)
      expect(client.getQueryData(otherKey)).toEqual(before)
    } finally {
      response.resolve(after)
      unsubscribe()
      client.clear()
    }
  }
)

it.each([
  { name: 'document', key: knowledgeKeys.document('kb-direct', 'document-direct') },
  { name: 'chunks', key: knowledgeKeys.chunks('kb-direct', 'document-direct', '') },
])('clears and cancels directly loaded $name without source or Search caches', async ({ key }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const response = Promise.withResolvers<{ content: string }>()
  const aborted = vi.fn()
  try {
    client.setQueryData(key, { content: 'cached private content' })
    const pending = client.fetchQuery({
      queryKey: key,
      queryFn: ({ signal }) => {
        signal.addEventListener('abort', aborted, { once: true })
        return response.promise
      },
    })
    const rejected = expect(pending).rejects.toThrow()
    await resetOrganizationSearchAccess(client, 'org-1')
    await rejected
    expect(aborted).toHaveBeenCalledOnce()
    expect(client.getQueryData(key)).toBeUndefined()
    response.resolve({ content: 'late private content' })
    await response.promise
    expect(client.getQueryData(key)).toBeUndefined()
  } finally {
    client.clear()
  }
})

it('cancels an in-flight search so its late result cannot restore disconnected content', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const key = knowledgeKeys.search(
    resourceScopeKey({ kind: 'organization', organizationId: 'org-1' }),
    'private content'
  )
  const response = Promise.withResolvers<WorkspaceKnowledgeSearchResult[]>()
  const result: WorkspaceKnowledgeSearchResult = {
    documentId: 'document-1',
    knowledgeBaseId: 'kb-1',
    knowledgeBaseName: 'Knowledge',
    documentName: 'Private document',
    sourceUrl: null,
    connectorType: 'github',
    sourceModifiedAt: null,
    author: null,
    content: 'cached private content',
    chunkIndex: 0,
    similarity: 1,
  }
  const aborted = vi.fn()
  try {
    client.setQueryData(key, [result])
    const pending = client.fetchQuery({
      queryKey: key,
      queryFn: ({ signal }) => {
        signal.addEventListener('abort', aborted, { once: true })
        return response.promise
      },
    })
    const rejected = expect(pending).rejects.toThrow()
    await resetOrganizationSearchAccess(client, 'org-1')
    await rejected
    expect(aborted).toHaveBeenCalledOnce()
    expect(client.getQueryData(key)).toBeUndefined()
    response.resolve([{ ...result, content: 'late private content' }])
    await response.promise
    expect(client.getQueryData(key)).toBeUndefined()
  } finally {
    client.clear()
  }
})
