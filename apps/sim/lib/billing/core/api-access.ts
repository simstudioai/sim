import { resolveWorkspaceBillingPayer } from '@/lib/billing/core/billing-attribution'
import { isPaid } from '@/lib/billing/plan-helpers'
import { isBillingEnabled, isFreeApiDeploymentGateEnabled } from '@/lib/core/config/env-flags'

/** The programmatic-execution paywall is active only when billing is enforced AND the gate flag is on. */
function isApiExecutionGateActive(): boolean {
  return isBillingEnabled && isFreeApiDeploymentGateEnabled
}

/**
 * Message for the 402 returned when a free-plan account attempts programmatic
 * workflow execution (API key, public API, or MCP server).
 */
export const API_EXECUTION_REQUIRES_PAID_PLAN_MESSAGE =
  'Programmatic workflow execution requires a paid plan. Upgrade to Pro or higher to use the API.'

/**
 * Whether workflows in `workspaceId` may run programmatically, gated on the
 * workspace-selected payer's exact subscription. Always allowed when billing
 * enforcement is off (self-hosted / `BILLING_ENABLED` unset); short-circuits
 * before any DB lookup.
 */
export async function isWorkspaceApiExecutionEntitled(
  workspaceId: string | undefined
): Promise<boolean> {
  if (!isApiExecutionGateActive() || !workspaceId) return true

  const payer = await resolveWorkspaceBillingPayer(workspaceId, { onMissing: 'return-null' })
  return isPaid(payer?.payerSubscription?.plan)
}
