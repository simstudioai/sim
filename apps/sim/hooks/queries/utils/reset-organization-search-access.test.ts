/** @vitest-environment node */
import { QueryClient } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import type { WorkspaceKnowledgeSearchResult } from '@/lib/api/contracts/knowledge/search'
import { resourceScopeKey } from '@/lib/core/resource-scope'
import { knowledgeKeys } from '@/hooks/queries/utils/knowledge-keys'
import { resetOrganizationSearchAccess } from '@/hooks/queries/utils/reset-organization-search-access'

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
