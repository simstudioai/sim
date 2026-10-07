/**
 * Generic Workspace SSE Endpoint Factory
 *
 * Creates a GET handler that authenticates the user, verifies workspace access,
 * and streams Server-Sent Events with heartbeats and cleanup.
 */

import type { SessionPrincipal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { noop } from '@sim/utils/helpers'
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
  /** Settles once the subscription receives events; the stream is announced only after it. */
  ready?: () => Promise<void>
}

interface WorkspaceSSEConfig {
  label: string
  subscriptions: SSESubscription[]
}

const encoder = new TextEncoder()

export const HEARTBEAT_INTERVAL_MS = 30_000

/** Written once a stream's subscriptions are live; clients ignore comments. */
export const OPENED_COMMENT = ': connected\n\n'

/**
 * How long a stream waits for its subscriptions before opening anyway. A subscription still not
 * live is in an outage, which open streams ride out the same way, and a client that hears nothing
 * gives up on the connection: Sim desktop after 15 s.
 */
export const OPEN_DEADLINE_MS = 5_000

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
  return async function GET(
    request: NextRequest,
    authenticatedPrincipal?: SessionPrincipal
  ): Promise<Response> {
    const userId = authenticatedPrincipal?.userId ?? (await getSession())?.user?.id
    if (!userId) {
      return new Response('Unauthorized', { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const workspaceId = searchParams.get('workspaceId')
    if (!workspaceId) {
      return new Response('Missing workspaceId query parameter', { status: 400 })
    }

    const permissions = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    if (!permissions) {
      return new Response('Access denied to workspace', { status: 403 })
    }

    return createSSEStream(request, {
      label: `${config.label}:workspace:${workspaceId}`,
      subscriptions: config.subscriptions.map((subscription) => ({
        subscribe: (send) => subscription.subscribe(workspaceId, send),
        ready: subscription.ready,
      })),
    })
  }
}

interface SSEStreamConfig {
  label: string
  subscriptions: Array<{
    subscribe(send: (eventName: string, data: Record<string, unknown>) => void): () => void
    /** Settles once the subscription receives events; the stream is announced only after it. */
    ready?: () => Promise<void>
  }>
  /** Rechecks a long-lived authorization before each publication and on heartbeats. */
  revalidate?: () => Promise<void>
}

/** Shared SSE transport; callers authorize their scope before opening the stream. */
export function createSSEStream(request: NextRequest, config: SSEStreamConfig): Response {
  const logger = createLogger(`${config.label}-SSE`)
  const teardowns: Array<() => void> = []
  let cleaned = false

  const cleanup = (reason: string) => {
    if (cleaned) return
    cleaned = true
    for (const teardown of teardowns.splice(0)) {
      try {
        teardown()
      } catch (error) {
        logger.warn(`SSE teardown failed for ${config.label}`, {
          reason,
          error: getErrorMessage(error),
        })
      }
    }
    logger.info(`SSE connection closed for ${config.label}`, { reason })
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

      let authorization: Promise<void> | undefined
      const revalidate = (): Promise<void> => {
        if (!config.revalidate) return Promise.resolve()
        authorization ??= config.revalidate().finally(() => {
          authorization = undefined
        })
        return authorization
      }
      /**
       * The stream's writes in order: the opening, then each event once it is authorized. An event
       * waits here while the stream has not opened or an earlier event is still being written.
       */
      let writes: Promise<void> = Promise.resolve()
      /** Settles when the stream opens, or when it closes first. */
      let opening: Promise<void> = Promise.resolve()
      /** The one authorization every event that arrived before the stream opened waits for. */
      let preOpenAuthorization: Promise<void> | undefined
      let opened = false
      let pendingEvents = 0
      const send = (eventName: string, data: Record<string, unknown>) => {
        if (cleaned) return
        const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`
        // Defensive: the opening and the writes queued before it settle in the same run of
        // microtasks, so an event sent from a microtask in between must still queue behind them.
        if (opened && pendingEvents === 0 && !config.revalidate) {
          enqueue(payload)
          return
        }
        if (pendingEvents >= MAX_UNDRAINED_CHUNKS) {
          close('pending_backpressure')
          return
        }
        pendingEvents += 1
        // Authorized as soon as the stream is open, so events in flight together share one check:
        // those that arrived before it opened share one that starts when it opens, and later ones
        // share whichever check is in flight. Each is written only after every event before it.
        const authorized = opened
          ? revalidate()
          : (preOpenAuthorization ??= opening.then(() => (cleaned ? undefined : revalidate())))
        // Defensive: a rejection is handled once the write chain reaches this event, which can be
        // after the authorization settles; this keeps it from surfacing as unhandled meanwhile.
        authorized.catch(noop)
        writes = writes
          .then(() => authorized)
          .then(
            () => {
              pendingEvents -= 1
              enqueue(payload)
            },
            () => {
              pendingEvents -= 1
              close('authorization_lost')
            }
          )
      }

      // An abort listener never fires for a signal that is already aborted, so a client that left
      // while the route was authorizing would otherwise hold its subscriptions until rotation.
      if (request.signal.aborted) {
        close('aborted')
        return
      }

      try {
        // The runtime sends the status and headers with the first body chunk, so the stream writes
        // one as soon as it opens. A client reads its state once the stream opens, so it opens once
        // every subscription receives events, or at the deadline when one is in an outage. A
        // heartbeat cannot open it first: the deadline is shorter than the heartbeat interval.
        // Closing settles it too, so a stream closed before it opened is not kept alive by a
        // subscription that never becomes ready.
        opening = Promise.race([
          Promise.all(config.subscriptions.map((subscription) => subscription.ready?.())),
          new Promise<void>((resolve) => {
            const deadline = setTimeout(resolve, OPEN_DEADLINE_MS)
            teardowns.push(() => {
              clearTimeout(deadline)
              resolve()
            })
          }),
        ]).then(
          () => {
            opened = true
            enqueue(OPENED_COMMENT)
          },
          () => close('subscription_failed')
        )
        writes = opening
        for (const subscription of config.subscriptions) {
          teardowns.push(subscription.subscribe(send))
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
          if (config.revalidate) {
            void revalidate().then(
              () => enqueue(': heartbeat\n\n'),
              () => close('authorization_lost')
            )
          } else {
            enqueue(': heartbeat\n\n')
          }
        }, HEARTBEAT_INTERVAL_MS)
        teardowns.push(() => clearInterval(heartbeat))

        const listenerScope = new AbortController()
        request.signal.addEventListener('abort', () => close('aborted'), {
          once: true,
          signal: listenerScope.signal,
        })
        teardowns.push(() => listenerScope.abort())

        logger.info(`SSE connection opened for ${config.label}`)
      } catch (error) {
        cleanup('setup_failed')
        logger.error(`Failed to open SSE connection for ${config.label}`, {
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
