import type { Context } from '@opentelemetry/api'
import {
  COPILOT_BILLING_PROTOCOL,
  COPILOT_BILLING_PROTOCOL_HEADER,
} from '@/lib/billing/core/billing-attribution'
import { env } from '@/lib/core/config/env'
import type { AbortResponse } from '@/lib/mothership/generated/protocol'
import { TraceAttr } from '@/lib/mothership/generated/trace-attributes-v1'
import { fetchGo } from '@/lib/mothership/request/go/fetch'
import { AbortReason } from '@/lib/mothership/request/session/abort'
import {
  getMothershipBaseURL,
  getMothershipSourceEnvHeaders,
} from '@/lib/mothership/server/agent-url'

export const DEFAULT_EXPLICIT_ABORT_TIMEOUT_MS = 3000

export async function requestExplicitStreamAbort(params: {
  streamId: string
  userId: string
  chatId?: string
  workspaceId?: string
  timeoutMs?: number
  otelContext?: Context
}): Promise<Pick<AbortResponse, 'settled'>> {
  const {
    streamId,
    userId,
    chatId,
    workspaceId,
    timeoutMs = DEFAULT_EXPLICIT_ABORT_TIMEOUT_MS,
    otelContext,
  } = params

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    [COPILOT_BILLING_PROTOCOL_HEADER]: COPILOT_BILLING_PROTOCOL.legacy,
  }
  if (env.COPILOT_API_KEY) {
    headers['x-api-key'] = env.COPILOT_API_KEY
  }
  Object.assign(headers, getMothershipSourceEnvHeaders())

  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(AbortReason.ExplicitAbortFetchTimeout),
    timeoutMs
  )

  try {
    const mothershipBaseURL = await getMothershipBaseURL({ userId })
    const response = await fetchGo(`${mothershipBaseURL}/api/streams/explicit-abort`, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        messageId: streamId,
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
    /** The Go service does not report worker settlement; an empty acknowledgement cannot prove it. */
    const text = await response.text()
    const acknowledgement: unknown = text ? JSON.parse(text) : null
    return {
      settled:
        acknowledgement !== null &&
        typeof acknowledgement === 'object' &&
        'settled' in acknowledgement &&
        acknowledgement.settled === true,
    }
  } finally {
    clearTimeout(timeout)
  }
}
