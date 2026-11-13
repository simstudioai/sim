import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { interruptibleSleep } from '@sim/utils/helpers'
import { type BackoffOptions, backoffWithJitter } from '@sim/utils/retry'
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

/**
 * A lost connection or a worker deploy: retry within a second, slowing to 4 s, so with jitter a
 * healthy deployment is back inside the worker's 5 s run-control deadline.
 */
const TRANSIENT_BACKOFF: BackoffOptions = { baseMs: 1000, maxMs: 4000 }
/**
 * The worker rejected this deployment's key, which only an operator can fix: start at 30 s and
 * slow to 10 minutes, so a misconfigured deployment polls a few hundred times a day, not every
 * second, and still reconnects on its own once the key is accepted.
 */
const REFUSED_BACKOFF: BackoffOptions = { baseMs: 30_000, maxMs: 600_000 }

/** The worker refused this deployment's key (401/403), as opposed to failing to answer. */
class TransportKeyRefused extends Error {
  constructor(readonly status: number) {
    super(`Transport key refused (HTTP ${status})`)
  }
}

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
  let failures = 0
  let outage: 'disconnected' | 'key_refused' | undefined
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
        if (response.status === 401 || response.status === 403) {
          throw new TransportKeyRefused(response.status)
        }
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
      // Only a whole iteration (poll, batch, replies) ends an outage.
      if (outage) {
        logger.info('Sim transport reconnected')
        outage = undefined
      }
    } catch (error) {
      if (signal.aborted) return
      const keyRefused = error instanceof TransportKeyRefused
      const kind = keyRefused ? 'key_refused' : 'disconnected'
      // One line per outage, and again only when it changes kind, not one per retry.
      if (outage !== kind) {
        outage = kind
        failures = 0
        if (keyRefused) {
          logger.warn('Sim transport key refused by the worker; check COPILOT_API_KEY', {
            status: error.status,
          })
        } else {
          logger.warn('Sim transport disconnected; reconnecting', {
            phase,
            error: getErrorMessage(error),
          })
        }
      }
      failures++
      await interruptibleSleep(
        backoffWithJitter(failures, null, keyRefused ? REFUSED_BACKOFF : TRANSIENT_BACKOFF),
        signal
      )
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
