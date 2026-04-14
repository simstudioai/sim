/**
 * Task List Change Pub/Sub Adapter
 *
 * Broadcasts workspace-scoped task list change notifications across processes
 * using Redis Pub/Sub. Gracefully falls back to a process-local EventEmitter
 * when Redis is unavailable.
 *
 * Channel: `task:status_changed`
 */

import { createPubSubChannel } from '@/lib/events/pubsub'

interface TaskListChangedEvent {
  workspaceId: string
}

const channel =
  typeof window !== 'undefined'
    ? null
    : createPubSubChannel<TaskListChangedEvent>({ channel: 'task:status_changed', label: 'task' })

export const taskPubSub = channel
  ? {
      publishTaskListChanged: (event: TaskListChangedEvent) => channel.publish(event),
      onTaskListChanged: (handler: (event: TaskListChangedEvent) => void) =>
        channel.subscribe(handler),
      dispose: () => channel.dispose(),
    }
  : null
