/**
 * SSE endpoint for MCP tool-change events.
 *
 * Pushes `tools_changed` events to the browser when:
 *  - An external MCP server sends `notifications/tools/list_changed` (via connection manager)
 *  - A workflow CRUD route modifies workflow MCP server tools (via pub/sub)
 *
 * Auth is handled via session cookies (EventSource sends cookies automatically).
 */

import { createWorkspaceSSE } from '@/lib/events/sse-endpoint'
import { mcpConnectionManager } from '@/lib/mcp/connection-manager'
import { mcpPubSub } from '@/lib/mcp/pubsub'

export const dynamic = 'force-dynamic'

export const GET = createWorkspaceSSE({
  label: 'mcp-events',
  subscriptions: [
    {
      subscribe: (workspaceId, send) => {
        if (!mcpConnectionManager) return () => {}
        return mcpConnectionManager.subscribe((event) => {
          if (event.workspaceId !== workspaceId) return
          send('tools_changed', {
            source: 'external',
            serverId: event.serverId,
            timestamp: event.timestamp,
          })
        })
      },
    },
    {
      subscribe: (workspaceId, send) => {
        if (!mcpPubSub) return () => {}
        return mcpPubSub.onWorkflowToolsChanged((event) => {
          if (event.workspaceId !== workspaceId) return
          send('tools_changed', {
            source: 'workflow',
            serverId: event.serverId,
            timestamp: Date.now(),
          })
        })
      },
    },
  ],
})
