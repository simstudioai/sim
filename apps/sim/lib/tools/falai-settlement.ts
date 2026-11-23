import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { tasks } from '@trigger.dev/sdk'
import {
  type BillingAttributionSnapshot,
  refreshAttributionPeriod,
} from '@/lib/billing/core/attribution'
import { recordUsage, stableEventKey } from '@/lib/billing/core/usage-log'
import { resolveTriggerRegion } from '@/lib/core/async-jobs/region'
import { env } from '@/lib/core/config/env'
import { isBillingEnabled, isHosted, isTriggerDevEnabled } from '@/lib/core/config/env-flags'
import { type FalAICostMetadata, getFalAIBillingReceipt } from '@/lib/tools/falai-pricing'

const logger = createLogger('FalAICostSettlement')

export const FALAI_COST_SETTLEMENT_TASK_ID = 'falai-cost-settlement' as const

/** fal records a request's billing event after it completes; the first look waits this long. */
const FALAI_SETTLEMENT_DELAY = '2m'

/** Mothership bills fal media at cost, so a Chat generation settles without markup. */
export const MOTHERSHIP_FAL_AT_COST_MULTIPLIER = 1

/** Ledger sources a hosted fal charge can be billed under. */
type FalAISettlementSource = 'workflow' | 'copilot' | 'api-tool'

/**
 * Everything a settlement needs once the generation's run is gone. The hosted key travels as
 * its env var name, never its value, so the task reads the same key that created the request.
 */
export interface FalAICostSettlementPayload {
  envVarName: string
  endpointId: string
  requestId: string
  /** The provider cost billed at completion, before markup. */
  billedProviderCostDollars: number
  markupMultiplier: number
  ledger: {
    source: FalAISettlementSource
    workflowId?: string
    executionId?: string
    /** The run's payer as admitted; its period is refreshed when settlement outlives it. */
    billingAttribution: BillingAttributionSnapshot
  }
}

/** The outcome of one settlement attempt. `pending` means fal has not recorded the charge yet. */
type FalAICostSettlementOutcome = 'pending' | 'charged' | 'exact' | 'overbilled'

interface ScheduleFalAICostSettlementParams {
  cost: Pick<FalAICostMetadata, 'endpointId' | 'requestId' | 'costDollars' | 'source'>
  envVarName: string
  markupMultiplier: number
  source: FalAISettlementSource
  /** The run's payer; a run without one is billed on its estimate. */
  billingAttribution: BillingAttributionSnapshot | undefined
  workflowId?: string
  executionId?: string
}

/**
 * Schedules the exact-cost settlement for a hosted fal generation billed on an estimate. A
 * generation billed from its own receipt is already exact and schedules nothing. Settlement only
 * adds what the estimate missed, so a failure here leaves the estimate billed and never fails
 * the generation.
 */
export async function scheduleFalAICostSettlement(
  params: ScheduleFalAICostSettlementParams
): Promise<void> {
  const { cost, billingAttribution } = params
  if (!isHosted || !isBillingEnabled) return
  if (cost.source === 'billing_events' || !billingAttribution) return
  if (!isTriggerDevEnabled || !env.TRIGGER_SECRET_KEY) {
    logger.warn('Trigger.dev not configured; fal charge stays on its estimate', {
      endpointId: cost.endpointId,
      requestId: cost.requestId,
    })
    return
  }

  const payload: FalAICostSettlementPayload = {
    envVarName: params.envVarName,
    endpointId: cost.endpointId,
    requestId: cost.requestId,
    billedProviderCostDollars: cost.costDollars,
    markupMultiplier: params.markupMultiplier,
    ledger: {
      source: params.source,
      workflowId: params.workflowId,
      executionId: params.executionId,
      billingAttribution,
    },
  }

  try {
    await tasks.trigger(FALAI_COST_SETTLEMENT_TASK_ID, payload, {
      delay: FALAI_SETTLEMENT_DELAY,
      idempotencyKey: `falai-cost-settlement-${cost.requestId}`,
      region: await resolveTriggerRegion(),
    })
  } catch (error) {
    logger.warn('Failed to schedule the fal exact-cost settlement; the estimate stays billed', {
      endpointId: cost.endpointId,
      requestId: cost.requestId,
      error: getErrorMessage(error),
    })
  }
}

/**
 * Bills the difference between fal's exact charge for a request and the estimate billed at
 * completion. The ledger row's event key is the request, so a retried settlement never bills
 * twice. An estimate above the exact charge is left as billed: the ledger records charges only.
 * A settlement that outlives the run's billing period bills the payer's current period, since
 * the ended one may already be closed and invoiced.
 */
export async function settleFalAICost(
  payload: FalAICostSettlementPayload
): Promise<FalAICostSettlementOutcome> {
  const { envVarName, endpointId, requestId, billedProviderCostDollars, markupMultiplier, ledger } =
    payload
  const apiKey = process.env[envVarName]
  if (!apiKey) throw new Error(`Hosted fal key ${envVarName} is not configured`)

  const receipt = await getFalAIBillingReceipt({ apiKey, endpointId, requestId })
  if (!receipt) return 'pending'

  const shortfallDollars = (receipt.costDollars - billedProviderCostDollars) * markupMultiplier
  if (shortfallDollars < 0) {
    logger.info('fal estimate exceeded the exact charge', {
      endpointId,
      requestId,
      overbilledDollars: -shortfallDollars,
    })
    return 'overbilled'
  }
  if (shortfallDollars === 0) return 'exact'

  const attribution =
    Date.parse(ledger.billingAttribution.billingPeriod.end) <= Date.now()
      ? await refreshAttributionPeriod(ledger.billingAttribution)
      : ledger.billingAttribution
  await recordUsage({
    userId: attribution.actorUserId,
    workspaceId: attribution.workspaceId ?? undefined,
    workflowId: ledger.workflowId,
    executionId: ledger.executionId,
    billingEntity: { ...attribution.billingEntity },
    billingPeriod: {
      start: new Date(attribution.billingPeriod.start),
      end: new Date(attribution.billingPeriod.end),
    },
    entries: [
      {
        category: 'tool',
        source: ledger.source,
        description: `fal exact cost settlement: ${endpointId}`,
        cost: shortfallDollars,
        eventKey: stableEventKey({ kind: 'falai-cost-settlement', requestId }),
        metadata: {
          endpointId,
          requestId,
          billedProviderCostDollars,
          exactProviderCostDollars: receipt.costDollars,
          markupMultiplier,
        },
      },
    ],
  })
  logger.info('Settled fal charge to its exact cost', {
    endpointId,
    requestId,
    shortfallDollars,
  })
  return 'charged'
}
