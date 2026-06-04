import { useEffect } from 'react'
import { createLogger } from '@sim/logger'
import type { QueryClient } from '@tanstack/react-query'
import { useQueryClient } from '@tanstack/react-query'
import { getLiveAssistantMessageId } from '@/lib/copilot/chat/effective-transcript'
import { type TaskChatHistory, taskKeys } from '@/hooks/queries/tasks'

const logger = createLogger('TaskEvents')

const TASK_STATUS_TYPES = ['started', 'completed', 'created', 'deleted', 'renamed'] as const
type TaskStatusEventType = (typeof TASK_STATUS_TYPES)[number]
const TASK_STATUS_TYPE_SET = new Set<string>(TASK_STATUS_TYPES)

interface TaskStatusEventPayload {
  chatId?: string
  type?: TaskStatusEventType
  streamId?: string
}

const DETAIL_INVALIDATING_TASK_STATUS_TYPES = new Set<TaskStatusEventType>([
  'started',
  'completed',
  'renamed',
])

function isTaskStatusEventType(value: unknown): value is TaskStatusEventType {
  return typeof value === 'string' && TASK_STATUS_TYPE_SET.has(value)
}

function isLocalOptimisticActiveStream(current: TaskChatHistory | undefined) {
  if (!current?.activeStreamId) return false
  const liveAssistantId = getLiveAssistantMessageId(current.activeStreamId)
  return current.messages.some((message) => message.id === liveAssistantId)
}

/**
 * Returns true when the cached active stream is known to be later in the
 * chronological transcript than the stream that emitted this status event.
 * If either stream is absent from the transcript, callers should refetch
 * instead of inferring order from incomplete cache state.
 */
function hasNewerKnownActiveStream(current: TaskChatHistory | undefined, streamId: string) {
  if (!current?.activeStreamId || current.activeStreamId === streamId) return false

  const activeIndex = current.messages.findIndex((message) => message.id === current.activeStreamId)
  const eventStreamIndex = current.messages.findIndex((message) => message.id === streamId)
  if (activeIndex === -1) return false
  if (eventStreamIndex === -1) return false
  return activeIndex > eventStreamIndex
}

function shouldSkipDetailInvalidationForStreamEvent(
  current: TaskChatHistory | undefined,
  payload: TaskStatusEventPayload
) {
  if (payload.type !== 'started' && payload.type !== 'completed') return false
  if (!current?.activeStreamId) return false
  if (!payload.streamId) return isLocalOptimisticActiveStream(current)
  if (payload.type === 'started' && current.activeStreamId === payload.streamId) return true
  if (current.activeStreamId === payload.streamId) return false
  if (hasNewerKnownActiveStream(current, payload.streamId)) return true
  return (
    payload.type === 'completed' &&
    isLocalOptimisticActiveStream(current) &&
    !current.messages.some((message) => message.id === payload.streamId)
  )
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
    ...(isTaskStatusEventType(record.type) ? { type: record.type } : {}),
    ...(typeof record.streamId === 'string' ? { streamId: record.streamId } : {}),
  }
}

export function handleTaskStatusEvent(
  queryClient: Pick<QueryClient, 'getQueryData' | 'invalidateQueries' | 'removeQueries'>,
  workspaceId: string,
  data: unknown
): void {
  const payload = parseTaskStatusEventPayload(data)
  if (!payload) {
    logger.warn('Received invalid task_status payload')
    return
  }

  queryClient.invalidateQueries({ queryKey: taskKeys.list(workspaceId) })
  if (!payload.chatId) return
  if (payload.type === 'deleted') {
    queryClient.removeQueries({ queryKey: taskKeys.detail(payload.chatId) })
    return
  }
  if (payload.type === 'started' || payload.type === 'completed') {
    const current = queryClient.getQueryData<TaskChatHistory>(taskKeys.detail(payload.chatId))
    if (shouldSkipDetailInvalidationForStreamEvent(current, payload)) {
      return
    }
  }
  if (payload.type && DETAIL_INVALIDATING_TASK_STATUS_TYPES.has(payload.type)) {
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
      handleTaskStatusEvent(
        queryClient,
        workspaceId,
        event instanceof MessageEvent ? event.data : undefined
      )
    })

    eventSource.onerror = () => {
      logger.warn(`SSE connection error for workspace ${workspaceId}`)
    }

    return () => {
      eventSource.close()
    }
  }, [workspaceId, queryClient])
}
