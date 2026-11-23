import { createLogger } from '@sim/logger'
import { task } from '@trigger.dev/sdk'
import {
  FALAI_COST_SETTLEMENT_TASK_ID,
  type FalAICostSettlementPayload,
  settleFalAICost,
} from '@/lib/tools/falai-settlement'

const logger = createLogger('FalAICostSettlementTask')

/**
 * Settles a hosted fal generation billed on an estimate to fal's exact charge. A receipt fal
 * has not recorded yet fails the attempt so the retries keep looking for about an hour; past
 * that the estimate stands.
 */
export const falaiCostSettlementTask = task({
  id: FALAI_COST_SETTLEMENT_TASK_ID,
  retry: {
    maxAttempts: 8,
    factor: 2,
    minTimeoutInMs: 60_000,
    maxTimeoutInMs: 15 * 60_000,
  },
  queue: { concurrencyLimit: 5 },
  run: async (payload: FalAICostSettlementPayload) => {
    const outcome = await settleFalAICost(payload)
    if (outcome === 'pending') {
      throw new Error(`fal has not recorded the charge for request ${payload.requestId} yet`)
    }
    logger.info('fal cost settlement finished', {
      requestId: payload.requestId,
      endpointId: payload.endpointId,
      outcome,
    })
    return { outcome }
  },
})
