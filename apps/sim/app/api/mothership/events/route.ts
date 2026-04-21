/**
 * SSE endpoint for task status events.
 *
 * Pushes `task_status` events to the browser when tasks are
 * started, completed, created, deleted, or renamed.
 *
 * Auth is handled via session cookies (EventSource sends cookies automatically).
 */

import { taskPubSub } from '@/lib/copilot/tasks'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createWorkspaceSSE } from '@/lib/events/sse-endpoint'

export const dynamic = 'force-dynamic'

export const GET = withRouteHandler(
  createWorkspaceSSE({
    label: 'mothership-events',
    subscriptions: [
      {
        subscribe: (workspaceId, send) => {
          if (!taskPubSub) return () => {}
          return taskPubSub.onStatusChanged((event) => {
            if (event.workspaceId !== workspaceId) return
            send('task_status', {
              chatId: event.chatId,
              type: event.type,
              timestamp: Date.now(),
            })
          })
        },
      },
    ],
  })
)
