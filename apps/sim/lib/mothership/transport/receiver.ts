import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { truncate } from '@sim/utils/string'
import { env } from '@/lib/core/config/env'
import { isMothershipBenchmarkEnabled } from '@/lib/core/config/env-flags'
import {
  SIM_CONTROL_KINDS,
  SIM_CONTROL_UNSUPPORTED,
  SimChannelBatchEnvelope,
  type SimConnection,
  SimControlRequest,
  SimControlRequestHeader,
  type SimControlResult,
} from '@/lib/mothership/generated/sim-transport'
import { fetchGo } from '@/lib/mothership/request/go/fetch'
import { mothershipRequestHeaders } from '@/lib/mothership/request/headers'
import { getMothershipBaseURL } from '@/lib/mothership/server/agent-url'
import { getSimConnection } from '@/lib/mothership/transport/connection'
import { executeSimControl } from '@/lib/mothership/transport/control'

const logger = createLogger('MothershipTransportReceiver')
const receivers = new Map<string, AbortController>()

interface ReceivedControl {
  id: string
  answer: () => Promise<SimControlResult>
}

/** Each request parses alone, so one unknown or malformed request never costs its batch-mates. */
function receiveControl(raw: unknown): ReceivedControl | null {
  const request = SimControlRequest.safeParse(raw)
  if (request.success) return { id: request.data.id, answer: () => executeSimControl(request.data) }
  const header = SimControlRequestHeader.safeParse(raw)
  if (!header.success) {
    logger.warn('Unreadable Sim control request dropped')
    return null
  }
  const { id, operation } = header.data
  const kind = operation && truncate(operation.kind, 64)
  if (operation && !SIM_CONTROL_KINDS.some((known) => known === operation.kind)) {
    logger.warn('Unsupported Sim control kind', { kind })
    const body = JSON.stringify({ error: SIM_CONTROL_UNSUPPORTED, kind })
    return { id, answer: async () => ({ status: 501, body }) }
  }
  logger.warn('Invalid Sim control request', {
    kind,
    issues: request.error.issues.map((issue) => issue.path.join('.')),
  })
  return {
    id,
    answer: async () => ({
      status: 400,
      body: JSON.stringify({ error: 'Invalid Sim control request' }),
    }),
  }
}

export async function receiveSimControls(
  baseURL: string,
  channelId: string,
  signal: AbortSignal
): Promise<void> {
  while (!signal.aborted) {
    let phase: 'poll' | 'parse' | 'reply' = 'poll'
    try {
      const response = await fetchGo(`${baseURL}/api/sim-transport/poll`, {
        method: 'POST',
        headers: mothershipRequestHeaders(),
        body: JSON.stringify({ channelId, accepts: SIM_CONTROL_KINDS }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
        redirect: 'error',
        spanName: 'sim → worker transport poll',
        operation: 'sim_transport_poll',
      })
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error(`Transport poll refused (HTTP ${response.status})`)
      }
      phase = 'parse'
      const batch = SimChannelBatchEnvelope.parse(await response.json())
      const controls = batch.requests.flatMap((raw) => receiveControl(raw) ?? [])
      phase = 'reply'
      const replies = await Promise.allSettled(
        controls.map(async (control) => {
          signal.throwIfAborted()
          const result = await control.answer()
          const reply = await fetchGo(`${baseURL}/api/sim-transport/reply`, {
            method: 'POST',
            headers: mothershipRequestHeaders(),
            body: JSON.stringify({ channelId, id: control.id, result }),
            redirect: 'error',
            signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
            spanName: 'sim → worker transport reply',
            operation: 'sim_transport_reply',
          })
          await reply.body?.cancel()
          if (!reply.ok && reply.status !== 410)
            throw new Error(`Transport reply refused (HTTP ${reply.status})`)
        })
      )
      const failed = replies.find((reply) => reply.status === 'rejected')
      if (failed?.status === 'rejected') throw failed.reason
    } catch (error) {
      if (signal.aborted) return
      logger.warn('Sim transport disconnected; reconnecting', {
        phase,
        error: getErrorMessage(error),
      })
      await sleep(1000)
    }
  }
}

/** One outbound receiver per configured worker; independent of browser/chat lifetimes. */
function ensureSimReceiver(baseURL: string, mode?: SimConnection['mode']): void {
  const connection = getSimConnection(mode)
  const endpoint = baseURL.replace(/\/$/, '')
  if (connection.mode !== 'checkpoint' || receivers.has(endpoint)) return
  const controller = new AbortController()
  receivers.set(endpoint, controller)
  void receiveSimControls(endpoint, connection.channelId, controller.signal)
}

export async function startSimReceivers(): Promise<void> {
  if (!env.COPILOT_API_KEY) return
  if (getSimConnection().mode === 'checkpoint') {
    const endpoints = [
      await getMothershipBaseURL(),
      env.COPILOT_DEV_URL,
      env.COPILOT_STAGING_URL,
      env.COPILOT_PROD_URL,
    ]
    for (const endpoint of endpoints) if (endpoint) ensureSimReceiver(endpoint)
  }
  const benchmarkUrl = env.MOTHERSHIP_BENCHMARK_URL ?? env.COPILOT_DEV_URL
  if (isMothershipBenchmarkEnabled && benchmarkUrl) {
    ensureSimReceiver(benchmarkUrl, 'checkpoint')
  }
  if (!receivers.size) return
  const stop = () => {
    for (const controller of receivers.values()) controller.abort()
  }
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
}
