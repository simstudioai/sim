/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { invalidateWorkflowLists } from '@/hooks/queries/utils/invalidate-workflow-lists'

describe('invalidateWorkflowLists', () => {
  it('invalidates scoped workflow lists and the privacy-safe selector prefix', async () => {
    const queryClient = {
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
    }

    await invalidateWorkflowLists(queryClient as any, 'ws-1', ['active', 'archived'])

    expect(queryClient.invalidateQueries).toHaveBeenNthCalledWith(1, {
      queryKey: ['workflows', 'list', 'ws-1', 'active'],
    })
    expect(queryClient.invalidateQueries).toHaveBeenNthCalledWith(2, {
      queryKey: ['workflows', 'list', 'ws-1', 'archived'],
    })
    expect(queryClient.invalidateQueries).toHaveBeenNthCalledWith(3, {
      queryKey: ['selectors'],
    })
  })
})
