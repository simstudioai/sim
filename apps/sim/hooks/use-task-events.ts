import { useEffect } from 'react'
import { createLogger } from '@sim/logger'
import type { QueryClient } from '@tanstack/react-query'
import { useQueryClient } from '@tanstack/react-query'
import { taskKeys } from '@/hooks/queries/tasks'

const logger = createLogger('TaskEvents')

interface TaskStatusEventPayload {
  chatId?: string
  type?: 'started' | 'completed' | 'created' | 'deleted' | 'renamed'
}

function parseTaskStatusEventPayload(data: unknown): TaskStatusEventPayload | null {
  let parsed = data

  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      return null
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null
  }

  const record = parsed as Record<string, unknown>

  return {
    ...(typeof record.chatId === 'string' ? { chatId: record.chatId } : {}),
    ...(typeof record.type === 'string'
      ? { type: record.type as TaskStatusEventPayload['type'] }
      : {}),
  }
}

export function handleTaskStatusEvent(
  queryClient: Pick<QueryClient, 'invalidateQueries'>,
  data: unknown
): void {
  queryClient.invalidateQueries({ queryKey: taskKeys.lists() })

  const payload = parseTaskStatusEventPayload(data)
  if (!payload) {
    logger.warn('Received invalid task_status payload')
    return
  }

  if (payload.type === 'completed' && payload.chatId) {
    queryClient.invalidateQueries({ queryKey: taskKeys.detail(payload.chatId) })
  }
}

/**
 * Subscribes to task status SSE events and invalidates task caches on changes.
 */
export function useTaskEvents(workspaceId: string | undefined) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!workspaceId) return

    const eventSource = new EventSource(
      `/api/mothership/events?workspaceId=${encodeURIComponent(workspaceId)}`
    )

    eventSource.addEventListener('task_status', (event) => {
      handleTaskStatusEvent(queryClient, event instanceof MessageEvent ? event.data : undefined)
    })

    eventSource.onerror = () => {
      logger.warn(`SSE connection error for workspace ${workspaceId}`)
    }

    return () => {
      eventSource.close()
    }
  }, [workspaceId, queryClient])
}
