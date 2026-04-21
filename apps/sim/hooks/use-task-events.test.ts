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

  it('invalidates only the task list for completed task events', () => {
    handleTaskStatusEvent(
      queryClient,
      'ws-1',
      JSON.stringify({
        chatId: 'chat-1',
        type: 'completed',
        timestamp: Date.now(),
      })
    )

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1)
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: taskKeys.list('ws-1'),
    })
  })

  it('keeps list invalidation only for non-completed task events', () => {
    handleTaskStatusEvent(
      queryClient,
      'ws-1',
      JSON.stringify({
        chatId: 'chat-1',
        type: 'started',
        timestamp: Date.now(),
      })
    )

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1)
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: taskKeys.list('ws-1'),
    })
  })

  it('preserves list invalidation when task event payload is invalid', () => {
    handleTaskStatusEvent(queryClient, 'ws-1', '{')

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1)
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: taskKeys.list('ws-1'),
    })
  })
})
