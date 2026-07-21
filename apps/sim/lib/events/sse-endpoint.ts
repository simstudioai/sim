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

interface SSESubscription {
  subscribe(workspaceId: string, send: SSESend): () => void
}

interface WorkspaceSSEConfig {
  label: string
  subscriptions: SSESubscription[]
}

const HEARTBEAT_INTERVAL_MS = 30_000

export type SSESend = (eventName: string, data: Record<string, unknown>) => void

interface SSEStreamConfig {
  label: string
  request: Request
  subscribe: (send: SSESend) => () => void
  metadata?: Record<string, unknown>
  maxBufferedBytes?: number
  maxConnectionDurationMs?: number
}

/** Creates an authenticated caller's named-event SSE response and owns stream cleanup. */
export function createSSEStream({
  label,
  request,
  subscribe,
  metadata = {},
  maxBufferedBytes,
  maxConnectionDurationMs,
}: SSEStreamConfig): Response {
  if (
    maxBufferedBytes !== undefined &&
    (!Number.isSafeInteger(maxBufferedBytes) || maxBufferedBytes <= 0)
  ) {
    throw new Error('SSE maxBufferedBytes must be a positive safe integer')
  }
  if (
    maxConnectionDurationMs !== undefined &&
    (!Number.isSafeInteger(maxConnectionDurationMs) || maxConnectionDurationMs <= 0)
  ) {
    throw new Error('SSE maxConnectionDurationMs must be a positive safe integer')
  }

  const logger = createLogger(`${label}-SSE`)
  const encoder = new TextEncoder()
  const unsubscribers: Array<() => void> = []
  let cleaned = false

  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    for (const unsubscribe of unsubscribers) {
      unsubscribe()
    }
    logger.info('SSE connection closed', metadata)
  }

  const stream = new ReadableStream(
    {
      start(controller) {
        const enqueue = (payload: string): void => {
          if (cleaned) return
          const chunk = encoder.encode(payload)
          if (
            maxBufferedBytes !== undefined &&
            controller.desiredSize !== null &&
            chunk.byteLength > controller.desiredSize
          ) {
            logger.warn('SSE client fell behind; closing stream', metadata)
            cleanup()
            try {
              controller.error(new Error('SSE client fell behind the live event stream'))
            } catch {}
            return
          }
          try {
            controller.enqueue(chunk)
          } catch {
            cleanup()
          }
        }

        const send: SSESend = (eventName, data) => {
          enqueue(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`)
        }

        const unsubscribe = subscribe(send)
        if (cleaned) {
          unsubscribe()
          return
        }
        unsubscribers.push(unsubscribe)

        const heartbeat = setInterval(() => {
          if (cleaned) {
            clearInterval(heartbeat)
            return
          }
          enqueue(': heartbeat\n\n')
        }, HEARTBEAT_INTERVAL_MS)
        unsubscribers.push(() => clearInterval(heartbeat))

        if (maxConnectionDurationMs !== undefined) {
          const rotation = setTimeout(() => {
            logger.info('Rotating SSE connection', metadata)
            cleanup()
            try {
              controller.close()
            } catch {}
          }, maxConnectionDurationMs)
          unsubscribers.push(() => clearTimeout(rotation))
        }

        request.signal.addEventListener(
          'abort',
          () => {
            cleanup()
            try {
              controller.close()
            } catch {}
          },
          { once: true }
        )

        logger.info('SSE connection opened', metadata)
      },
      cancel() {
        cleanup()
      },
    },
    maxBufferedBytes === undefined
      ? undefined
      : {
          highWaterMark: maxBufferedBytes,
          size: (chunk: Uint8Array) => chunk.byteLength,
        }
  )

  return new Response(stream, { headers: SSE_HEADERS })
}

export function createWorkspaceSSE(config: WorkspaceSSEConfig) {
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

    return createSSEStream({
      label: config.label,
      request,
      metadata: { workspaceId },
      subscribe: (send) => {
        const unsubscribers = config.subscriptions.map((subscription) =>
          subscription.subscribe(workspaceId, send)
        )
        return () => {
          for (const unsubscribe of unsubscribers) {
            unsubscribe()
          }
        }
      },
    })
  }
}
