/**
 * @vitest-environment node
 */

import type { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { taskKeys } from '@/hooks/queries/tasks'
import { handleTaskStatusEvent } from '@/hooks/use-task-events'

describe('handleTaskStatusEvent', () => {
  const queryClient = {
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  } satisfies Pick<QueryClient, 'invalidateQueries'>

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('invalidates the task list and completed chat detail', () => {
    handleTaskStatusEvent(
      queryClient,
      JSON.stringify({
        chatId: 'chat-1',
        type: 'completed',
        timestamp: Date.now(),
      })
    )

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(2)
    expect(queryClient.invalidateQueries).toHaveBeenNthCalledWith(1, {
      queryKey: taskKeys.lists(),
    })
    expect(queryClient.invalidateQueries).toHaveBeenNthCalledWith(2, {
      queryKey: taskKeys.detail('chat-1'),
    })
  })

  it('keeps list invalidation only for non-completed task events', () => {
    handleTaskStatusEvent(
      queryClient,
      JSON.stringify({
        chatId: 'chat-1',
        type: 'started',
        timestamp: Date.now(),
      })
    )

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1)
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: taskKeys.lists(),
    })
  })

  it('preserves list invalidation when task event payload is invalid', () => {
    handleTaskStatusEvent(queryClient, '{')

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1)
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: taskKeys.lists(),
    })
  })
})
