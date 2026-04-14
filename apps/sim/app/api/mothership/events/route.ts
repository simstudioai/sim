/**
 * SSE endpoint for task status events.
 *
 * Pushes `task_status` events to the browser when the workspace task list
 * changes.
 *
 * Auth is handled via session cookies (EventSource sends cookies automatically).
 */

import { taskPubSub } from '@/lib/copilot/tasks'
import { createWorkspaceSSE } from '@/lib/events/sse-endpoint'

export const dynamic = 'force-dynamic'

export const GET = createWorkspaceSSE({
  label: 'mothership-events',
  subscriptions: [
    {
      subscribe: (workspaceId, send) => {
        if (!taskPubSub) return () => {}
        return taskPubSub.onTaskListChanged((event) => {
          if (event.workspaceId !== workspaceId) return
          send('task_status', {})
        })
      },
    },
  ],
})
