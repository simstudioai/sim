/**
 * Task Status Pub/Sub Adapter
 *
 * Broadcasts task status events across processes using Redis Pub/Sub.
 * Gracefully falls back to process-local EventEmitter when Redis is unavailable.
 *
 * Channel: `task:status_changed`
 */

import { createPubSubChannel, type PubSubChannel } from '@/lib/events/pubsub'

interface TaskStatusEvent {
  workspaceId: string
  chatId: string
  type: 'started' | 'completed' | 'created' | 'deleted' | 'renamed'
  streamId?: string
}

type TaskPubSubGlobal = typeof globalThis & {
  _taskStatusChannel?: PubSubChannel<TaskStatusEvent> | null
}

const g = globalThis as TaskPubSubGlobal

if (!('_taskStatusChannel' in g)) {
  g._taskStatusChannel =
    typeof window !== 'undefined'
      ? null
      : createPubSubChannel<TaskStatusEvent>({ channel: 'task:status_changed', label: 'task' })
}

const channel = g._taskStatusChannel

export const taskPubSub = channel
  ? {
      publishStatusChanged: (event: TaskStatusEvent) => channel.publish(event),
      onStatusChanged: (handler: (event: TaskStatusEvent) => void) => channel.subscribe(handler),
      dispose: () => channel.dispose(),
    }
  : null
