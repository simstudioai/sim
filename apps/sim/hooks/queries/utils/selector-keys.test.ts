/**
 * @vitest-environment node
 */
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { invalidateSelectorQueries, selectorQueryRoots } from '@/hooks/queries/utils/selector-keys'

describe('invalidateSelectorQueries', () => {
  it('invalidates both privacy-safe selector roots without touching unrelated queries', async () => {
    const queryClient = new QueryClient()
    const selectorKey = [...selectorQueryRoots.selectors, 'gmail.labels'] as const
    const searchReplaceKey = [
      ...selectorQueryRoots.workflowSearchReplace,
      'selector-detail',
    ] as const
    const unrelatedKey = ['workflows', 'workspace-1'] as const

    queryClient.setQueryData(selectorKey, [])
    queryClient.setQueryData(searchReplaceKey, [])
    queryClient.setQueryData(unrelatedKey, [])

    await invalidateSelectorQueries(queryClient)

    expect(selectorQueryRoots).toEqual({
      selectors: ['selectors'],
      workflowSearchReplace: ['workflow-search-replace'],
    })
    expect(queryClient.getQueryState(selectorKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(searchReplaceKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(unrelatedKey)?.isInvalidated).toBe(false)
  })
})
