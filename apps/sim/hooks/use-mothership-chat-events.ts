import { useEffect } from 'react'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { QueryClient } from '@tanstack/react-query'
import { useQueryClient } from '@tanstack/react-query'
import { getDesktopBridge } from '@/lib/desktop'
import { suspendDesktopChatScopes } from '@/lib/desktop/chat-scope'
import { createRotatingEventSource } from '@/lib/events/rotating-event-source'
import { getLiveAssistantMessageId } from '@/lib/mothership/chat/live-message-id'
import {
  type MothershipChatHistory,
  type MothershipChatMetadata,
  type MothershipChatOwner,
  mothershipChatKeys,
} from '@/hooks/queries/mothership-chats'
import { desktopActivityKeys } from '@/hooks/queries/utils/desktop-activity-keys'
import { useMothershipQueueStore } from '@/stores/mothership-queue/store'

const logger = createLogger('MothershipChatEvents')

/** Owner scopes this process subscribed to, so returning to a scope reconciles missed events. */
const everSubscribed = new Set<string>()

const CHAT_STATUS_TYPES = [
  'started',
  'completed',
  'created',
  'deleted',
  'renamed',
  'updated',
] as const
type ChatStatusEventType = (typeof CHAT_STATUS_TYPES)[number]
const CHAT_STATUS_TYPE_SET = new Set<string>(CHAT_STATUS_TYPES)

interface ChatStatusEventPayload {
  chatId?: string
  type?: ChatStatusEventType
  streamId?: string
}

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
  owner: MothershipChatOwner,
  data: unknown
): void {
  const payload = parseChatStatusEventPayload(data)
  if (!payload) {
    logger.warn('Received invalid task_status payload')
    return
  }

  /** Delete and restore move chats between active and archived owner lists. */
  queryClient.invalidateQueries({ queryKey: mothershipChatKeys.ownerLists(owner) })
  if (!payload.chatId) return
  if (payload.type === 'deleted') {
    // A task may be deleted from another window, browser, or device. Stop its
    // local native resources here too; relying only on this renderer's delete
    // mutation would leave pages and PTYs running indefinitely.
    void suspendDesktopChatScopes(payload.chatId)
    queryClient.removeQueries({ queryKey: mothershipChatKeys.detail(payload.chatId) })
    /** This tab's queue for the chat goes too, and no later send may bring it back. */
    useMothershipQueueStore.getState().clearChat(payload.chatId)
    return
  }
  /** A restore is published as `created`; the chat takes queued sends again. */
  if (payload.type === 'created') useMothershipQueueStore.getState().reopenChat(payload.chatId)
  if (payload.type === 'renamed') {
    /**
     * The lists invalidated above carry the title every surface renders; the
     * detail only needs marking stale, not a full transcript reload.
     */
    queryClient.invalidateQueries({
      queryKey: mothershipChatKeys.detail(payload.chatId),
      refetchType: 'none',
    })
    return
  }
  if (payload.type !== 'started' && payload.type !== 'completed') return
  const current = queryClient.getQueryData<MothershipChatHistory>(
    mothershipChatKeys.detail(payload.chatId)
  )
  if (shouldSkipDetailInvalidationForStreamEvent(current, payload)) return
  /**
   * A completion of the cached live stream only marks the detail stale. The
   * server persists the turn before closing the stream, so a surface rendering
   * it refetches through its own finalization; the live message alone cannot
   * tell this tab's stream from a server-loaded mid-stream snapshot, so any
   * other cached copy reloads the saved transcript on its next mount.
   */
  const completesCachedLiveStream =
    payload.type === 'completed' &&
    current?.activeStreamId === payload.streamId &&
    isLocalOptimisticActiveStream(current)
  queryClient.invalidateQueries({
    queryKey: mothershipChatKeys.detail(payload.chatId),
    ...(completesCachedLiveStream ? { refetchType: 'none' as const } : {}),
  })
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
  owner: MothershipChatOwner
): void {
  queryClient.invalidateQueries({ queryKey: mothershipChatKeys.ownerLists(owner) })
}

/** The chat route a page shows, so a notification never repeats what is on screen. */
function chatRoute(owner: MothershipChatOwner, chatId: string): string {
  return typeof owner === 'string'
    ? `/workspace/${owner}/chat/${chatId}`
    : `/o/${owner.organizationId}/chat/${chatId}`
}

/**
 * Reflects a turn starting or ending in the chats that run in the background: the desktop
 * activity list changes, and a chat the user is not looking at that finished its turn is
 * announced. The desktop app decides whether to show that notification (notifications on, the
 * chat not on screen in the focused window); the chat on screen announces its own completion.
 */
export function reflectBackgroundChatStatus(
  queryClient: Pick<QueryClient, 'getQueryData' | 'invalidateQueries'>,
  owner: MothershipChatOwner,
  data: unknown
): void {
  const payload = parseChatStatusEventPayload(data)
  if (payload?.type !== 'started' && payload?.type !== 'completed') return
  queryClient.invalidateQueries({ queryKey: desktopActivityKeys.lists() })
  if (payload.type !== 'completed' || !payload.chatId) return
  const settings = getDesktopBridge()?.settings
  if (!settings) return
  const route = chatRoute(owner, payload.chatId)
  if (typeof window !== 'undefined' && window.location.pathname === route) return
  const chats = queryClient.getQueryData<MothershipChatMetadata[]>(
    mothershipChatKeys.ownerList(owner)
  )
  const name = chats?.find((chat) => chat.id === payload.chatId)?.name
  void settings
    .notify({ title: name ?? 'Task complete', body: 'Sim finished responding.', route })
    .catch((error) =>
      logger.warn('Could not show a chat completion notification', {
        error: getErrorMessage(error),
      })
    )
}

/**
 * Subscribes to chat status SSE events and invalidates chat caches on changes.
 * The SSE event name remains `task_status` for wire compatibility.
 *
 * No-ops when Chat is disabled — this is mounted from the persistent sidebar, so
 * without the guard every session would hold an open connection to an endpoint
 * that cannot serve it.
 */
export function useMothershipChatEvents(
  owner: MothershipChatOwner | undefined,
  chatEnabled: boolean
) {
  const queryClient = useQueryClient()
  const workspaceId = typeof owner === 'string' ? owner : undefined
  const organizationId = typeof owner === 'object' ? owner.organizationId : undefined

  useEffect(() => {
    if ((!workspaceId && !organizationId) || !chatEnabled) return

    const eventOwner = organizationId ? { organizationId } : workspaceId!
    const ownerParam = organizationId
      ? `organizationId=${encodeURIComponent(organizationId)}`
      : `workspaceId=${encodeURIComponent(workspaceId!)}`
    const isResubscribe = everSubscribed.has(ownerParam)
    everSubscribed.add(ownerParam)
    const connection = createRotatingEventSource({
      url: `/api/mothership/events?${ownerParam}`,
      events: {
        task_status: (event) => {
          const data = event instanceof MessageEvent ? event.data : undefined
          handleMothershipChatStatusEvent(queryClient, eventOwner, data)
          reflectBackgroundChatStatus(queryClient, eventOwner, data)
        },
      },
      onOpen: (reason) => {
        if (reason === 'reconnect' || (reason === 'initial' && isResubscribe)) {
          resyncMothershipChatCaches(queryClient, eventOwner)
        }
      },
      onError: () => {
        logger.warn('Chat status SSE connection error')
      },
    })

    return () => {
      connection.close()
    }
  }, [workspaceId, organizationId, queryClient, chatEnabled])
}
