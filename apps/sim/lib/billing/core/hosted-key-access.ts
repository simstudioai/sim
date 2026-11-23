import { resolveWorkspaceBillingPayer } from '@/lib/billing/core/attribution'
import { payerHasPaidAccess } from '@/lib/billing/core/chat-access'
import type { UsageUpgradePayer } from '@/lib/billing/usage-upgrade'
import { isBillingEnabled, isHosted } from '@/lib/core/config/env-flags'
import { HttpError } from '@/lib/core/utils/http-error'

/**
 * Sim's hosted key was withheld because the run's payer is on the free plan. Carries a 402 so the
 * run fails as the caller's plan, not as a Sim fault.
 */
export class HostedKeyRequiresPaidPlanError extends HttpError {
  readonly statusCode = 402

  /** @param subject - what asked for the key: a tool's name or a model id */
  constructor(subject: string) {
    super(
      `${subject} with Sim's hosted key is available on paid plans. Upgrade your plan, or add your own API key under Settings > BYOK.`
    )
    this.name = 'HostedKeyRequiresPaidPlanError'
  }
}

/**
 * Whether a run may spend on Sim's hosted provider keys, for models and tools alike: only a payer
 * with paid access ({@link payerHasPaidAccess}) may. The payer is the run's admitted attribution,
 * or the workspace's payer for a surface that carries none; a workspace without a payer, or a free
 * payer whose credit balance cannot be read, is refused.
 */
export async function mayUseHostedKey(
  workspaceId: string | null | undefined,
  billingAttribution?: UsageUpgradePayer
): Promise<boolean> {
  if (!isHosted || !isBillingEnabled) return true

  let payer = billingAttribution ?? null
  if (!payer && workspaceId) {
    const workspacePayer = await resolveWorkspaceBillingPayer(workspaceId, {
      onMissing: 'return-null',
    })
    if (workspacePayer) {
      payer = {
        billingEntity: workspacePayer.organizationId
          ? { type: 'organization', id: workspacePayer.organizationId }
          : { type: 'user', id: workspacePayer.billedAccountUserId },
        payerSubscription: workspacePayer.payerSubscription,
      }
    }
  }

  return payer !== null && payerHasPaidAccess(payer, { onBalanceUnavailable: 'deny' })
}
