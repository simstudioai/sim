import type { Context } from '@opentelemetry/api'
import { SIM_AGENT_API_URL } from '@/lib/copilot/constants'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { fetchGo } from '@/lib/copilot/request/go/fetch'
import { AbortReason } from '@/lib/copilot/request/session/abort'
import { env } from '@/lib/core/config/env'

export const DEFAULT_EXPLICIT_ABORT_TIMEOUT_MS = 3000

export async function requestExplicitStreamAbort(params: {
  streamId: string
  userId: string
  chatId?: string
  timeoutMs?: number
  otelContext?: Context
}): Promise<void> {
  const {
    streamId,
    userId,
    chatId,
    timeoutMs = DEFAULT_EXPLICIT_ABORT_TIMEOUT_MS,
    otelContext,
  } = params

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (env.COPILOT_API_KEY) {
    headers['x-api-key'] = env.COPILOT_API_KEY
  }

  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(AbortReason.ExplicitAbortFetchTimeout),
    timeoutMs
  )

  try {
    const response = await fetchGo(`${SIM_AGENT_API_URL}/api/streams/explicit-abort`, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        messageId: streamId,
        userId,
        ...(chatId ? { chatId } : {}),
      }),
      otelContext,
      spanName: 'sim → go /api/streams/explicit-abort',
      operation: 'explicit_abort',
      attributes: {
        [TraceAttr.StreamId]: streamId,
        ...(chatId ? { [TraceAttr.ChatId]: chatId } : {}),
      },
    })

    if (!response.ok) {
      throw new Error(`Explicit abort marker request failed: ${response.status}`)
    }
  } finally {
    clearTimeout(timeout)
  }
}
