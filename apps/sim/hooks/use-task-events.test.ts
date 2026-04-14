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

  it('invalidates the task list for task status updates', () => {
    handleTaskStatusEvent(queryClient)
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1)
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: taskKeys.lists(),
    })
  })
})
