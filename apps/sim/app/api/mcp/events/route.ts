/**
 * SSE endpoint for MCP tool-change events.
 *
 * Pushes `tools_changed` events to the browser when:
 *  - An external MCP server sends `notifications/tools/list_changed` (via connection manager)
 *  - A workflow CRUD route modifies workflow MCP server tools (via pub/sub)
 *
 * Auth is handled via session cookies (EventSource sends cookies automatically).
 */

import type { NextRequest } from 'next/server'
import { mcpEventsQuerySchema } from '@/lib/api/contracts/mcp'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createWorkspaceSSE } from '@/lib/events/sse-endpoint'
import { mcpConnectionManager } from '@/lib/mcp/connection-manager'
import { mcpPubSub } from '@/lib/mcp/pubsub'

export const dynamic = 'force-dynamic'

const mcpEventsHandler = createWorkspaceSSE({
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

export const GET = withRouteHandler(async (request: NextRequest) => {
  const queryValidation = mcpEventsQuerySchema.safeParse({
    workspaceId: request.nextUrl.searchParams.get('workspaceId'),
  })

  if (!queryValidation.success || !queryValidation.data.workspaceId) {
    return new Response('Missing workspaceId query parameter', { status: 400 })
  }

  return mcpEventsHandler(request)
})
