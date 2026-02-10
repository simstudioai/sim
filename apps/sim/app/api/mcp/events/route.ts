/**
 * SSE endpoint for MCP tool-change events.
 *
 * Pushes `tools_changed` events to the browser when:
 *  - An external MCP server sends `notifications/tools/list_changed` (via connection manager)
 *  - A workflow CRUD route modifies workflow MCP server tools (via pub/sub)
 *
 * Auth is handled via session cookies (EventSource sends cookies automatically).
 */

import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { SSE_HEADERS } from '@/lib/core/utils/sse'
import { mcpConnectionManager } from '@/lib/mcp/connection-manager'
import { mcpPubSub } from '@/lib/mcp/pubsub'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('McpEventsSSE')

export const dynamic = 'force-dynamic'

const HEARTBEAT_INTERVAL_MS = 30_000

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session?.user?.id) {
    return new Response('Unauthorized', { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const workspaceId = searchParams.get('workspaceId')
  if (!workspaceId) {
    return new Response('Missing workspaceId query parameter', { status: 400 })
  }

  const permissions = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
  if (!permissions) {
    return new Response('Access denied to workspace', { status: 403 })
  }

  const encoder = new TextEncoder()
  const unsubscribers: Array<() => void> = []

  const stream = new ReadableStream({
    start(controller) {
      const send = (eventName: string, data: Record<string, unknown>) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`)
          )
        } catch {
          // Stream already closed
        }
      }

      // Subscribe to external MCP server tool changes
      if (mcpConnectionManager) {
        const unsub = mcpConnectionManager.subscribe((event) => {
          if (event.workspaceId !== workspaceId) return
          send('tools_changed', {
            source: 'external',
            serverId: event.serverId,
            timestamp: event.timestamp,
          })
        })
        unsubscribers.push(unsub)
      }

      // Subscribe to workflow CRUD tool changes
      if (mcpPubSub) {
        const unsub = mcpPubSub.onWorkflowToolsChanged((event) => {
          if (event.workspaceId !== workspaceId) return
          send('tools_changed', {
            source: 'workflow',
            serverId: event.serverId,
            timestamp: Date.now(),
          })
        })
        unsubscribers.push(unsub)
      }

      // Heartbeat to keep the connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'))
        } catch {
          clearInterval(heartbeat)
        }
      }, HEARTBEAT_INTERVAL_MS)
      unsubscribers.push(() => clearInterval(heartbeat))

      // Cleanup when client disconnects
      request.signal.addEventListener('abort', () => {
        for (const unsub of unsubscribers) {
          unsub()
        }
        try {
          controller.close()
        } catch {
          // Already closed
        }
        logger.info(`SSE connection closed for workspace ${workspaceId}`)
      })

      logger.info(`SSE connection opened for workspace ${workspaceId}`)
    },
  })

  return new Response(stream, { headers: SSE_HEADERS })
}
