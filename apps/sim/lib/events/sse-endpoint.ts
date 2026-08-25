/**
 * Generic Workspace SSE Endpoint Factory
 *
 * Creates a GET handler that authenticates the user, verifies workspace access,
 * and streams Server-Sent Events with heartbeats and cleanup.
 */

import { createLogger } from '@sim/logger'
import { randomFloat } from '@sim/utils/random'
import type { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { SSE_HEADERS } from '@/lib/core/utils/sse'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

interface SSESubscription {
  subscribe(
    workspaceId: string,
    send: (eventName: string, data: Record<string, unknown>) => void
  ): () => void
}

interface WorkspaceSSEConfig {
  label: string
  subscriptions: SSESubscription[]
}

const encoder = new TextEncoder()

export const HEARTBEAT_INTERVAL_MS = 30_000

/**
 * Defensive ceiling on one connection's lifetime; `EventSource` reconnects past
 * this, so delivery continues across the boundary.
 *
 * `request.signal` abort and stream `cancel()` are the primary teardown paths,
 * but both fire only when the runtime reports the client disconnect, and the
 * unread check below only catches a consumer that has stopped draining. This
 * releases whatever both miss, so retention is bounded by the ceiling instead
 * of by process uptime.
 *
 * Matches the ceiling `lib/realtime/event-stream-route.ts` already uses for the
 * same purpose. It is deliberately far longer than the unread window: a healthy
 * client is drained and therefore never unread, so a short ceiling would only
 * force reconnects on the connections that are working, and every reconnect is
 * a window in which a transient event can be missed.
 */
export const MAX_CONNECTION_MS = 4 * 60 * 60 * 1000

/** Spreads reconnects so connections opened together do not expire together. */
export const MAX_CONNECTION_JITTER_MS = 60_000

/**
 * Undrained chunk count that marks a connection unread, which shortens the
 * reclaim window for a vanished consumer that the ceiling above would
 * otherwise hold for its full duration. The default queuing strategy reports
 * `desiredSize` as `1 - queued`, so this trips only once the consumer has
 * pulled nothing for several minutes — well beyond the transient backpressure
 * of a slow but live client.
 */
export const MAX_UNDRAINED_CHUNKS = 16

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

    const teardowns: Array<() => void> = []
    let cleaned = false

    const cleanup = (reason: string) => {
      if (cleaned) return
      cleaned = true
      for (const teardown of teardowns) {
        teardown()
      }
      teardowns.length = 0
      logger.info(`SSE connection closed for workspace ${workspaceId}`, { reason })
    }

    const stream = new ReadableStream({
      start(controller) {
        const close = (reason: string) => {
          cleanup(reason)
          try {
            controller.close()
          } catch {
            // Already closed
          }
        }

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
          teardowns.push(subscription.subscribe(workspaceId, send))
        }

        const deadline = Date.now() + MAX_CONNECTION_MS + randomFloat() * MAX_CONNECTION_JITTER_MS

        const heartbeat = setInterval(() => {
          if (cleaned) {
            clearInterval(heartbeat)
            return
          }
          if (Date.now() >= deadline) {
            close('expired')
            return
          }
          const desiredSize = controller.desiredSize
          if (desiredSize !== null && desiredSize <= -MAX_UNDRAINED_CHUNKS) {
            close('unread')
            return
          }
          try {
            controller.enqueue(encoder.encode(': heartbeat\n\n'))
          } catch {
            close('errored')
          }
        }, HEARTBEAT_INTERVAL_MS)
        teardowns.push(() => clearInterval(heartbeat))

        // `once` only self-removes if abort fires; the expiry and unread paths
        // close the connection while the signal is still live, so the listener
        // needs its own removal or it retains this whole scope.
        const listenerScope = new AbortController()
        request.signal.addEventListener('abort', () => close('aborted'), {
          once: true,
          signal: listenerScope.signal,
        })
        teardowns.push(() => listenerScope.abort())

        logger.info(`SSE connection opened for workspace ${workspaceId}`)
      },
      cancel() {
        cleanup('cancelled')
      },
    })

    return new Response(stream, { headers: SSE_HEADERS })
  }
}
