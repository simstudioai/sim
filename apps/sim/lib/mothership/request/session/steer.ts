import type { Context } from '@opentelemetry/api'
import { TraceAttr } from '@/lib/mothership/observability/trace-attributes'
import { mothershipRequestHeaders } from '@/lib/mothership/request/headers'
import { fetchWorker } from '@/lib/mothership/request/worker/fetch'
import { getMothershipBaseURL } from '@/lib/mothership/server/agent-url'

export const DEFAULT_STEER_TIMEOUT_MS = 3000

/**
 * Queues a mid-turn steering message with the worker (`/api/streams/steer`).
 *
 * Acceptance means "queued", not "applied": the worker acknowledges application with a
 * `run`/`steering_applied` stream event carrying the steeringId. A caller that
 * never sees that ack before the stream ends must re-send the content as an
 * ordinary message — that contract is what makes delivery loss-free without
 * this call having to prove stream liveness.
 */
export async function requestStreamSteering(params: {
  streamId: string
  userId: string
  chatId: string
  steeringId: string
  content: string
  timeoutMs?: number
  otelContext?: Context
}): Promise<{ queued: boolean; status: number }> {
  const {
    streamId,
    userId,
    chatId,
    steeringId,
    content,
    timeoutMs = DEFAULT_STEER_TIMEOUT_MS,
    otelContext,
  } = params

  const headers = mothershipRequestHeaders()

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort('steer_fetch_timeout'), timeoutMs)

  try {
    const mothershipBaseURL = await getMothershipBaseURL({ userId })
    const response = await fetchWorker(`${mothershipBaseURL}/api/streams/steer`, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        messageId: streamId,
        steeringId,
        content,
      }),
      otelContext,
      spanName: 'sim → worker /api/streams/steer',
      operation: 'steer',
      attributes: {
        [TraceAttr.StreamId]: streamId,
        [TraceAttr.ChatId]: chatId,
      },
    })
    return { queued: response.ok, status: response.status }
  } finally {
    clearTimeout(timeout)
  }
}
