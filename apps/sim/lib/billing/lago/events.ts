import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { dollarsToCredits } from '@/lib/billing/credits/conversion'
import { LAGO_BILLING_METRIC_CODE } from '@/lib/billing/lago/config'
import { lagoRequest } from '@/lib/billing/lago/client'
import { toLagoCustomerExternalId } from '@/lib/billing/lago/external-ids'
import type { LagoBillingEntityType, LagoEventPayload } from '@/lib/billing/lago/types'
import { isLagoBillingProvider } from '@/lib/core/config/env-flags'

const logger = createLogger('LagoEvents')

export interface EmitLagoUsageEventParams {
  eventKey: string
  subscriptionExternalId: string
  entityType: LagoBillingEntityType
  entityId: string
  costUsd: number
  source: string
  category: string
  workspaceId?: string | null
  workflowId?: string | null
  executionId?: string | null
}

/**
 * Sends a usage event to Lago. Fire-and-forget — errors are logged, never thrown.
 */
export function emitLagoUsageEvent(params: EmitLagoUsageEventParams): void {
  if (!isLagoBillingProvider) return

  void emitLagoUsageEventInternal(params).catch((error) => {
    logger.warn('Failed to emit Lago usage event', {
      eventKey: params.eventKey,
      error: getErrorMessage(error),
    })
  })
}

async function emitLagoUsageEventInternal(params: EmitLagoUsageEventParams): Promise<void> {
  const externalCustomerId = toLagoCustomerExternalId(params.entityType, params.entityId)
  const isLlmCostMetric = LAGO_BILLING_METRIC_CODE === 'llm_cost'
  const properties = isLlmCostMetric
    ? {
        precise_total_amount_cents: Math.max(0, Math.round(params.costUsd * 100)),
        source: params.source,
        category: params.category,
        ...(params.workspaceId ? { workspace_id: params.workspaceId } : {}),
        ...(params.workflowId ? { workflow_id: params.workflowId } : {}),
        ...(params.executionId ? { execution_id: params.executionId } : {}),
      }
    : {
        cost_usd: params.costUsd,
        credits: dollarsToCredits(params.costUsd),
        source: params.source,
        category: params.category,
        ...(params.workspaceId ? { workspace_id: params.workspaceId } : {}),
        ...(params.workflowId ? { workflow_id: params.workflowId } : {}),
        ...(params.executionId ? { execution_id: params.executionId } : {}),
      }

  const payload: { event: LagoEventPayload } = {
    event: {
      transaction_id: params.eventKey,
      external_subscription_id: params.subscriptionExternalId,
      code: LAGO_BILLING_METRIC_CODE,
      timestamp: Math.floor(Date.now() / 1000),
      properties,
    },
  }

  await lagoRequest('POST', '/events', payload)

  logger.debug('Emitted Lago usage event', {
    transactionId: params.eventKey,
    externalCustomerId,
    costUsd: params.costUsd,
  })
}
