import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isHosted } from '@/lib/core/config/env-flags'
import {
  claimServiceUsage,
  finishServiceUsage,
  serviceMeteringHealth,
} from '@/lib/mothership/billing/service-store'
import { ServiceUsageAcknowledgment, ServiceUsageReceipt } from '@/lib/mothership/generated/billing'
import { mothershipRequestHeaders } from '@/lib/mothership/request/headers'

const logger = createLogger('CopilotServiceUsage')
let running = false
let timer: ReturnType<typeof setInterval> | undefined

export async function replayServiceUsage(): Promise<void> {
  if (running) return
  running = true
  try {
    const health = await serviceMeteringHealth()
    if (health?.unknown) logger.error('Service usage requires reconciliation', health)
    for (const row of await claimServiceUsage()) {
      try {
        const receipt = ServiceUsageReceipt.parse({
          id: row.id,
          streamId: row.streamId,
          toolCallId: row.toolCallId,
          service: row.service,
          costUsd: Number(row.costUsd),
        })
        const response = await fetch(`${row.workerOrigin}/api/billing/services`, {
          method: 'POST',
          headers: mothershipRequestHeaders(),
          body: JSON.stringify({ receipts: [receipt] }),
          redirect: 'error',
          signal: AbortSignal.timeout(15_000),
        })
        if (!response.ok) throw new Error(`Service metering returned HTTP ${response.status}`)
        const acknowledgment = ServiceUsageAcknowledgment.parse(await response.json())
        if (!acknowledgment.accepted.includes(row.id))
          throw new Error('Service usage was not acknowledged')
        await finishServiceUsage(row.id)
      } catch (error) {
        await finishServiceUsage(row.id, getErrorMessage(error))
        logger.warn('Service usage awaits replay', { id: row.id, error: getErrorMessage(error) })
      }
    }
  } finally {
    running = false
  }
}

/** Delivery is independent of the browser, cancellation and tool-result lifetime. */
export function startServiceUsageReplay(): void {
  if (!isHosted || timer) return
  const replay = () =>
    void replayServiceUsage().catch((error) =>
      logger.error('Service usage replay failed', { error: getErrorMessage(error) })
    )
  timer = setInterval(replay, 60_000)
  timer.unref?.()
  replay()
}
