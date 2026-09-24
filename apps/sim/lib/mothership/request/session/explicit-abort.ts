import type { Context } from '@opentelemetry/api'
import { sleep } from '@sim/utils/helpers'
import { toRecordOrNull } from '@sim/utils/object'
import {
  COPILOT_BILLING_PROTOCOL,
  COPILOT_BILLING_PROTOCOL_HEADER,
} from '@/lib/billing/core/billing-attribution'
import { env } from '@/lib/core/config/env'
import { AbortRequest, type AbortResponse } from '@/lib/mothership/generated/protocol'
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
  timeoutMs?: number
  otelContext?: Context
}): Promise<Pick<AbortResponse, 'settled'>> {
  const {
    streamId,
    userId,
    chatId,
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

  let awaitingSettlement = false
  try {
    const mothershipBaseURL = await getMothershipBaseURL({ userId })
    while (!controller.signal.aborted) {
      const response = await fetchGo(`${mothershipBaseURL}/api/streams/explicit-abort`, {
        method: 'POST',
        headers,
        signal: controller.signal,
        /** Sim authorizes the actor and canonical run before this service-authenticated signal. */
        body: JSON.stringify(AbortRequest.parse({ messageId: streamId })),
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
      const text = await response.text()
      const acknowledgement = toRecordOrNull(text ? JSON.parse(text) : null)
      /** Only an explicit pending acknowledgement can be polled; legacy empty replies prove nothing. */
      if (acknowledgement?.settled !== false) {
        return { settled: acknowledgement?.settled === true }
      }
      /** Stop is idempotent. Its first acknowledgement can precede worker cleanup. */
      awaitingSettlement = true
      await sleep(200)
    }
    return { settled: false }
  } catch (error) {
    if (awaitingSettlement && controller.signal.aborted) return { settled: false }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}
