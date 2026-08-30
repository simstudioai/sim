import { useEffect } from 'react'
import { createLogger } from '@sim/logger'
import type { QueryClient } from '@tanstack/react-query'
import { useQueryClient } from '@tanstack/react-query'
import { isChatEnabled } from '@/lib/core/config/env-flags'
import { suspendDesktopChatScopes } from '@/lib/desktop/chat-scope'
import { createRotatingEventSource } from '@/lib/events/rotating-event-source'
import { getLiveAssistantMessageId } from '@/lib/mothership/chat/effective-transcript'
import { type MothershipChatHistory, mothershipChatKeys } from '@/hooks/queries/mothership-chats'

const logger = createLogger('MothershipChatEvents')

/** Workspaces this process has subscribed to before, so a re-subscribe can be told from a first one. */
const everSubscribed = new Set<string>()

const CHAT_STATUS_TYPES = ['started', 'completed', 'created', 'deleted', 'renamed'] as const
type ChatStatusEventType = (typeof CHAT_STATUS_TYPES)[number]
const CHAT_STATUS_TYPE_SET = new Set<string>(CHAT_STATUS_TYPES)

interface ChatStatusEventPayload {
  chatId?: string
  type?: ChatStatusEventType
  streamId?: string
}

const DETAIL_INVALIDATING_CHAT_STATUS_TYPES = new Set<ChatStatusEventType>([
  'started',
  'completed',
  'renamed',
])

function isChatStatusEventType(value: unknown): value is ChatStatusEventType {
  return typeof value === 'string' && CHAT_STATUS_TYPE_SET.has(value)
}

function isLocalOptimisticActiveStream(current: MothershipChatHistory | undefined) {
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
function hasNewerKnownActiveStream(current: MothershipChatHistory | undefined, streamId: string) {
  if (!current?.activeStreamId || current.activeStreamId === streamId) return false

  const activeIndex = current.messages.findIndex((message) => message.id === current.activeStreamId)
  const eventStreamIndex = current.messages.findIndex((message) => message.id === streamId)
  if (activeIndex === -1) return false
  if (eventStreamIndex === -1) return false
  return activeIndex > eventStreamIndex
}

function shouldSkipDetailInvalidationForStreamEvent(
  current: MothershipChatHistory | undefined,
  payload: ChatStatusEventPayload
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

function parseChatStatusEventPayload(data: unknown): ChatStatusEventPayload | null {
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
    ...(isChatStatusEventType(record.type) ? { type: record.type } : {}),
    ...(typeof record.streamId === 'string' ? { streamId: record.streamId } : {}),
  }
}

export function handleMothershipChatStatusEvent(
  queryClient: Pick<QueryClient, 'getQueryData' | 'invalidateQueries' | 'removeQueries'>,
  workspaceId: string,
  data: unknown
): void {
  const payload = parseChatStatusEventPayload(data)
  if (!payload) {
    logger.warn('Received invalid task_status payload')
    return
  }

  // workspaceLists covers both the active and archived (Recently Deleted)
  // lists: delete/restore events move chats between the two scopes.
  queryClient.invalidateQueries({ queryKey: mothershipChatKeys.workspaceLists(workspaceId) })
  if (!payload.chatId) return
  if (payload.type === 'deleted') {
    // A task may be deleted from another window, browser, or device. Stop its
    // local native resources here too; relying only on this renderer's delete
    // mutation would leave pages and PTYs running indefinitely.
    void suspendDesktopChatScopes(payload.chatId)
    queryClient.removeQueries({ queryKey: mothershipChatKeys.detail(payload.chatId) })
    return
  }
  if (payload.type === 'started' || payload.type === 'completed') {
    const current = queryClient.getQueryData<MothershipChatHistory>(
      mothershipChatKeys.detail(payload.chatId)
    )
    if (shouldSkipDetailInvalidationForStreamEvent(current, payload)) {
      return
    }
  }
  if (payload.type && DETAIL_INVALIDATING_CHAT_STATUS_TYPES.has(payload.type)) {
    queryClient.invalidateQueries({ queryKey: mothershipChatKeys.detail(payload.chatId) })
  }
}

/**
 * Re-syncs the workspace chat lists after a gap in the event stream.
 *
 * `task_status` events are transient — nothing replays what was published while
 * no connection was open — so a reconnect may have missed a create, rename, or
 * delete. The lists carry that workspace-level state, and refetching them is
 * always safe.
 *
 * Chat details are deliberately left alone. The only one that would refetch is
 * the mounted chat, which may be rendering an in-flight stream, and refetching
 * there replaces the optimistic transcript with a server copy that does not yet
 * hold the streaming message. Cached state cannot reliably say whether a turn is
 * still running — the optimistic markers outlive it — so detail reconciliation
 * stays as it is today and belongs with the streaming state that can answer it.
 */
export function resyncMothershipChatCaches(
  queryClient: Pick<QueryClient, 'invalidateQueries'>,
  workspaceId: string
): void {
  queryClient.invalidateQueries({ queryKey: mothershipChatKeys.workspaceLists(workspaceId) })
}

/**
 * Subscribes to chat status SSE events and invalidates chat caches on changes.
 * The SSE event name remains `task_status` for wire compatibility.
 *
 * No-ops when Chat is disabled — this is mounted from the persistent sidebar, so
 * without the guard every session would hold an open connection to an endpoint
 * that cannot serve it.
 */
export function useMothershipChatEvents(workspaceId: string | undefined) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!workspaceId || !isChatEnabled) return

    const isResubscribe = everSubscribed.has(workspaceId)
    everSubscribed.add(workspaceId)
    const connection = createRotatingEventSource({
      url: `/api/mothership/events?workspaceId=${encodeURIComponent(workspaceId)}`,
      events: {
        task_status: (event) => {
          handleMothershipChatStatusEvent(
            queryClient,
            workspaceId,
            event instanceof MessageEvent ? event.data : undefined
          )
        },
      },
      onOpen: (reason) => {
        if (reason === 'reconnect' || (reason === 'initial' && isResubscribe)) {
          resyncMothershipChatCaches(queryClient, workspaceId)
        }
      },
      onError: () => {
        logger.warn(`SSE connection error for workspace ${workspaceId}`)
      },
    })

    return () => {
      connection.close()
    }
  }, [workspaceId, queryClient])
}
