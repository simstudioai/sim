/**
 * Chat Status Pub/Sub Adapter
 *
 * Broadcasts chat status events across processes using Redis Pub/Sub.
 * Gracefully falls back to process-local EventEmitter when Redis is unavailable.
 *
 * The Redis channel and SSE label retain the legacy `task:status_changed`
 * identifier so live status updates keep flowing across pods during a rolling
 * deploy (old and new pods must publish/subscribe on the same channel).
 */

import { createPubSubChannel, type PubSubChannel } from '@/lib/events/pubsub'

export type ChatStatusOwner =
  | { workspaceId: string; organizationId?: never; userId?: never }
  | { organizationId: string; userId: string; workspaceId?: never }

export type ChatStatusEvent = ChatStatusOwner & {
  chatId: string
  type: 'started' | 'completed' | 'created' | 'deleted' | 'renamed' | 'updated'
  streamId?: string
}

type ChatPubSubGlobal = typeof globalThis & {
  _chatStatusChannel?: PubSubChannel<ChatStatusEvent> | null
}

const g = globalThis as ChatPubSubGlobal

if (!('_chatStatusChannel' in g)) {
  g._chatStatusChannel =
    typeof window !== 'undefined'
      ? null
      : createPubSubChannel<ChatStatusEvent>({ channel: 'task:status_changed', label: 'task' })
}

const channel = g._chatStatusChannel

export const chatPubSub = channel
  ? {
      publishStatusChanged: (event: ChatStatusEvent) => channel.publish(event),
      onStatusChanged: (handler: (event: ChatStatusEvent) => void) => channel.subscribe(handler),
      dispose: () => channel.dispose(),
    }
  : null

/** Projects canonical chat ownership into the same status channel for both surfaces. */
export function publishChatStatusChanged(
  chat: { workspaceId?: string | null; organizationId?: string | null; userId?: string | null },
  event: Pick<ChatStatusEvent, 'chatId' | 'type' | 'streamId'>
): void {
  if (chat.organizationId) {
    if (!chat.userId || chat.workspaceId) throw new Error('Invalid organization chat owner')
    chatPubSub?.publishStatusChanged({
      organizationId: chat.organizationId,
      userId: chat.userId,
      ...event,
    })
  } else if (chat.workspaceId) {
    chatPubSub?.publishStatusChanged({ workspaceId: chat.workspaceId, ...event })
  }
}
