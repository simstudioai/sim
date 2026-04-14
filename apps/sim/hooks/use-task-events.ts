import { useEffect } from 'react'
import { createLogger } from '@sim/logger'
import type { QueryClient } from '@tanstack/react-query'
import { useQueryClient } from '@tanstack/react-query'
import { taskKeys } from '@/hooks/queries/tasks'

const logger = createLogger('TaskEvents')

export function handleTaskStatusEvent(queryClient: Pick<QueryClient, 'invalidateQueries'>): void {
  queryClient.invalidateQueries({ queryKey: taskKeys.lists() })
}

/**
 * Subscribes to task status SSE events and refreshes the task list on changes.
 */
export function useTaskEvents(workspaceId: string | undefined) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!workspaceId) return

    const eventSource = new EventSource(
      `/api/mothership/events?workspaceId=${encodeURIComponent(workspaceId)}`
    )

    eventSource.addEventListener('task_status', () => {
      handleTaskStatusEvent(queryClient)
    })

    eventSource.onerror = () => {
      logger.warn(`SSE connection error for workspace ${workspaceId}`)
    }

    return () => {
      eventSource.close()
    }
  }, [workspaceId, queryClient])
}
