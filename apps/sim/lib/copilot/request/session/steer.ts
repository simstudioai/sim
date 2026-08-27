import type { Context } from '@opentelemetry/api'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { fetchGo } from '@/lib/copilot/request/go/fetch'
import { getMothershipBaseURL, getMothershipSourceEnvHeaders } from '@/lib/copilot/server/agent-url'
import { env } from '@/lib/core/config/env'

export const DEFAULT_STEER_TIMEOUT_MS = 3000

/**
 * Queues a mid-turn steering message with the Go side (`/api/streams/steer`).
 *
 * Acceptance means "queued", not "applied": Go acknowledges application with a
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

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (env.COPILOT_API_KEY) {
    headers['x-api-key'] = env.COPILOT_API_KEY
  }
  Object.assign(headers, getMothershipSourceEnvHeaders())

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort('steer_fetch_timeout'), timeoutMs)

  try {
    const mothershipBaseURL = await getMothershipBaseURL({ userId })
    const response = await fetchGo(`${mothershipBaseURL}/api/streams/steer`, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        messageId: streamId,
        userId,
        chatId,
        steeringId,
        content,
      }),
      otelContext,
      spanName: 'sim → go /api/streams/steer',
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
