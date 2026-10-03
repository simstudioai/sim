import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { env } from '@/lib/core/config/env'
import { SimChannelBatch } from '@/lib/mothership/generated/sim-transport'
import { fetchGo } from '@/lib/mothership/request/go/fetch'
import { mothershipRequestHeaders } from '@/lib/mothership/request/headers'
import { getMothershipBaseURL } from '@/lib/mothership/server/agent-url'
import { getSimConnection } from '@/lib/mothership/transport/connection'
import { executeSimControl } from '@/lib/mothership/transport/control'

const logger = createLogger('MothershipTransportReceiver')
const receivers = new Map<string, AbortController>()

export async function receiveSimControls(
  baseURL: string,
  channelId: string,
  signal: AbortSignal
): Promise<void> {
  while (!signal.aborted) {
    try {
      const response = await fetchGo(`${baseURL}/api/sim-transport/poll`, {
        method: 'POST',
        headers: mothershipRequestHeaders(),
        body: JSON.stringify({ channelId }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
        redirect: 'error',
        spanName: 'sim → worker transport poll',
        operation: 'sim_transport_poll',
      })
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error(`Transport poll refused (HTTP ${response.status})`)
      }
      const batch = SimChannelBatch.parse(await response.json())
      const replies = await Promise.allSettled(
        batch.requests.map(async (request) => {
          signal.throwIfAborted()
          const result = await executeSimControl(request)
          const reply = await fetchGo(`${baseURL}/api/sim-transport/reply`, {
            method: 'POST',
            headers: mothershipRequestHeaders(),
            body: JSON.stringify({ channelId, id: request.id, result }),
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
      logger.warn('Sim transport disconnected; reconnecting', { error: getErrorMessage(error) })
      await sleep(1000)
    }
  }
}

/** One outbound receiver per configured worker; independent of browser/chat lifetimes. */
function ensureSimReceiver(baseURL: string): void {
  const connection = getSimConnection()
  if (connection.mode !== 'checkpoint' || receivers.has(baseURL)) return
  const controller = new AbortController()
  receivers.set(baseURL, controller)
  void receiveSimControls(baseURL, connection.channelId, controller.signal)
}

export async function startSimReceivers(): Promise<void> {
  if (!env.COPILOT_API_KEY || getSimConnection().mode !== 'checkpoint') return
  const endpoints = [
    await getMothershipBaseURL(),
    env.COPILOT_DEV_URL,
    env.COPILOT_STAGING_URL,
    env.COPILOT_PROD_URL,
  ]
  for (const endpoint of endpoints) if (endpoint) ensureSimReceiver(endpoint)
  const stop = () => {
    for (const controller of receivers.values()) controller.abort()
  }
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
}
