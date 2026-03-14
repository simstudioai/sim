/**
 * Generic Workspace SSE Endpoint Factory
 *
 * Creates a GET handler that authenticates the user, verifies workspace access,
 * and streams Server-Sent Events with heartbeats and cleanup.
 */

import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { SSE_HEADERS } from '@/lib/core/utils/sse'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

export interface SSESubscription {
  subscribe(
    workspaceId: string,
    send: (eventName: string, data: Record<string, unknown>) => void
  ): () => void
}

interface WorkspaceSSEConfig {
  label: string
  subscriptions: SSESubscription[]
}

const HEARTBEAT_INTERVAL_MS = 30_000

export function createWorkspaceSSE(config: WorkspaceSSEConfig) {
  const logger = createLogger(`${config.label}-SSE`)

  return async function GET(request: NextRequest): Promise<Response> {
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
    let cleaned = false

    const cleanup = () => {
      if (cleaned) return
      cleaned = true
      for (const unsub of unsubscribers) {
        unsub()
      }
      logger.info(`SSE connection closed for workspace ${workspaceId}`)
    }

    const stream = new ReadableStream({
      start(controller) {
        const send = (eventName: string, data: Record<string, unknown>) => {
          if (cleaned) return
          try {
            controller.enqueue(
              encoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`)
            )
          } catch {
            // Stream already closed
          }
        }

        for (const subscription of config.subscriptions) {
          const unsub = subscription.subscribe(workspaceId, send)
          unsubscribers.push(unsub)
        }

        const heartbeat = setInterval(() => {
          if (cleaned) {
            clearInterval(heartbeat)
            return
          }
          try {
            controller.enqueue(encoder.encode(': heartbeat\n\n'))
          } catch {
            clearInterval(heartbeat)
          }
        }, HEARTBEAT_INTERVAL_MS)
        unsubscribers.push(() => clearInterval(heartbeat))

        request.signal.addEventListener(
          'abort',
          () => {
            cleanup()
            try {
              controller.close()
            } catch {
              // Already closed
            }
          },
          { once: true }
        )

        logger.info(`SSE connection opened for workspace ${workspaceId}`)
      },
      cancel() {
        cleanup()
      },
    })

    return new Response(stream, { headers: SSE_HEADERS })
  }
}
