/**
 * Generic Workspace SSE Endpoint Factory
 *
 * Creates a GET handler that authenticates the user, verifies workspace access,
 * and streams Server-Sent Events with heartbeats and cleanup.
 */

import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
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
 * Starts a make-before-break rotation for one connection. Healthy clients open
 * a replacement before this stream closes; orphaned streams are released after
 * the grace period without relying on runtime disconnect propagation. Because
 * checks run on the heartbeat interval, the upper bound is the lifetime, jitter,
 * grace period, and up to one heartbeat of scheduling delay.
 *
 * `request.signal` abort and stream `cancel()` are the primary teardown paths,
 * but both fire only when the runtime reports the client disconnect, and the
 * unread check below only catches queues the HTTP adapter leaves undrained. The
 * production adapter may keep pulling after the socket disappears, so this
 * deadline is the primary bound rather than a fallback.
 */
export const MAX_CONNECTION_MS = 15 * 60 * 1000

/** Spreads reconnects so connections opened together do not expire together. */
export const MAX_CONNECTION_JITTER_MS = 60_000

/** Time for a healthy client to connect its replacement before the old stream closes. */
export const ROTATION_GRACE_MS = 30_000

/**
 * Best-effort queued-chunk limit for adapters that propagate backpressure into
 * the Web Stream. This is not the lifecycle guarantee: adapters may keep
 * pulling after a socket disappears, so the rotation deadline remains required.
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
      for (const teardown of teardowns.splice(0)) {
        try {
          teardown()
        } catch (error) {
          logger.warn(`SSE teardown failed for workspace ${workspaceId}`, {
            reason,
            error: getErrorMessage(error),
          })
        }
      }
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

        const enqueue = (payload: string): boolean => {
          if (cleaned) return false
          try {
            controller.enqueue(encoder.encode(payload))
            return true
          } catch {
            close('errored')
            return false
          }
        }

        const send = (eventName: string, data: Record<string, unknown>) => {
          enqueue(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`)
        }

        try {
          for (const subscription of config.subscriptions) {
            teardowns.push(subscription.subscribe(workspaceId, send))
          }

          const rotationDeadline =
            Date.now() + MAX_CONNECTION_MS + randomFloat() * MAX_CONNECTION_JITTER_MS
          let rotationStartedAt: number | null = null

          const heartbeat = setInterval(() => {
            if (cleaned) {
              clearInterval(heartbeat)
              return
            }

            const now = Date.now()
            if (rotationStartedAt !== null && now - rotationStartedAt >= ROTATION_GRACE_MS) {
              close('rotated')
              return
            }
            if (rotationStartedAt === null && now >= rotationDeadline) {
              if (enqueue('event: rotate\ndata: {}\n\n')) {
                rotationStartedAt = now
              }
              return
            }

            const desiredSize = controller.desiredSize
            if (desiredSize !== null && desiredSize <= -MAX_UNDRAINED_CHUNKS) {
              close('unread')
              return
            }
            enqueue(': heartbeat\n\n')
          }, HEARTBEAT_INTERVAL_MS)
          teardowns.push(() => clearInterval(heartbeat))

          const listenerScope = new AbortController()
          request.signal.addEventListener('abort', () => close('aborted'), {
            once: true,
            signal: listenerScope.signal,
          })
          teardowns.push(() => listenerScope.abort())

          logger.info(`SSE connection opened for workspace ${workspaceId}`)
        } catch (error) {
          cleanup('setup_failed')
          logger.error(`Failed to open SSE connection for workspace ${workspaceId}`, {
            error: getErrorMessage(error),
          })
          try {
            controller.error(error)
          } catch {}
        }
      },
      cancel() {
        cleanup('cancelled')
      },
    })

    return new Response(stream, { headers: SSE_HEADERS })
  }
}
