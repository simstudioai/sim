import { isUserCredentialPrincipal } from '@sim/auth/principal'
import { defineAuthorizedBillingReadUseCase } from '@/lib/billing/application/authorized-billing-read-use-case'
import { type BillingReadPrincipal, billingOperations } from '@/lib/billing/application/operations'
import {
  checkBillingBlocked,
  checkBillingEntityBlocked,
  checkUsageStatus,
} from '@/lib/billing/calculations/usage-monitor'
import {
  checkAttributedBillingBlocks,
  resolveBillingAttribution,
  resolveSystemBillingAttribution,
  toUsageLimitSubscription,
} from '@/lib/billing/core/billing-attribution'
import type { HighestPrioritySubscription } from '@/lib/billing/core/plan'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { type BillingEntity, deriveBillingContext } from '@/lib/billing/core/usage-log'
import {
  canUserManageBillingEntity,
  canUserManageWorkspaceBilling,
  type WorkspaceBillingAuthorityContext,
} from '@/lib/billing/core/workspace-billing-authority'
import { dollarsToCredits } from '@/lib/billing/credits/conversion'
import {
  getStorageLimitForBillingContext,
  getStorageUsageForBillingContext,
  getUserStorageLimit,
  getUserStorageUsage,
  resolveStorageBillingContext,
} from '@/lib/billing/storage'

export interface GetBillingStatusInput {
  workspaceId?: string
}

export interface BillingCreditsStatus {
  used: number
  limit: number
  remaining: number
}

export interface BillingStorageStatus {
  usedBytes: number
  limitBytes: number
  percentUsed: number
}

/**
 * `credits` and `storage` describe the resolved payer's pooled allowances, not
 * the caller's own consumption, so they are only projected to a caller who may
 * manage that payer's billing — see {@link canReadPayerPool} on the workspace
 * branch and {@link isSelfBillingEntity} on the account branch. Every other
 * caller reads them as `null` while still seeing the plan and standing the
 * workspace UI already shows them.
 */
export interface BillingStatusResult {
  workspaceId: string | null
  period: { start: string; end: string }
  plan: string
  status: 'active' | 'limit_exceeded' | 'billing_blocked'
  credits: BillingCreditsStatus | null
  storage: BillingStorageStatus | null
}

function storageStatus(usedBytes: number, limitBytes: number): BillingStorageStatus {
  return {
    usedBytes,
    limitBytes,
    percentUsed: limitBytes > 0 ? (usedBytes / limitBytes) * 100 : 0,
  }
}

function creditsStatus(usage: { currentUsage: number; limit: number }): BillingCreditsStatus {
  return {
    used: dollarsToCredits(usage.currentUsage),
    limit: dollarsToCredits(usage.limit),
    remaining: dollarsToCredits(usage.limit - usage.currentUsage),
  }
}

/**
 * Resolves whether a caller may read the resolved payer's pooled allowances.
 *
 * Only a human principal can hold billing authority: it is payer identity, or
 * an admin role in the hosting organization, and never a workspace role. A
 * workspace API key is deliberately actor-less — `WorkspaceApiKeyPrincipal`
 * carries a key and a workspace but no user — so there is no identity to
 * evaluate that authority against, and it is therefore never a billing
 * manager.
 *
 * Attributing the key to whoever created it would close the gap on paper and
 * open a worse one. Any workspace `admin` may mint a workspace key, and a
 * workspace `admin` is not a billing manager, so the key would launder exactly
 * the role this projection excludes. The pool is the payer's, not the
 * workspace's — organization-wide on an organization-hosted workspace — so it
 * spans workspaces that admin has no standing in at all. Substituting a key's
 * owner for the acting principal is also what the application operation
 * boundary forbids outright, and the creator's authority can be revoked while
 * the key keeps working.
 *
 * A workspace key still reads the plan, period, and standing it needs to
 * monitor the workspace, including `limit_exceeded` and `billing_blocked`.
 */
async function canReadPayerPool(
  principal: BillingReadPrincipal,
  workspace: WorkspaceBillingAuthorityContext
): Promise<boolean> {
  if (!isUserCredentialPrincipal(principal)) return false
  return canUserManageWorkspaceBilling(workspace, principal.userId)
}

/**
 * Whether the account-branch caller is themselves the payer.
 *
 * Omitting `workspaceId` selects account scope, whose operation policy is
 * `personal_self`. That reads naturally as "my own billing", and it is —
 * except that {@link getHighestPrioritySubscription} resolves a subscription
 * from any `member` row regardless of role, so a plain non-admin member of an
 * organization lands on the organization's pooled subscription. Credits then
 * come from the pooled organization usage and storage from the organization's
 * counter, which is the whole organization's consumption rather than the
 * caller's own.
 *
 * The pool is therefore gated exactly as the workspace branch gates it, rather
 * than the branch being forced back to the caller's personal subscription:
 * plan, period, and standing stay resolved from the payer that actually funds
 * the caller, so a monitor still sees `limit_exceeded` and `billing_blocked`
 * truthfully, while only the pooled figures require authority over the payer.
 * A caller with no organization payer is their own payer and keeps reading
 * their own credits and storage unchanged.
 */
function isSelfBillingEntity(billingEntity: Readonly<BillingEntity>, userId: string): boolean {
  return billingEntity.type === 'user' && billingEntity.id === userId
}

/** Only invoked once payer-pool disclosure is authorized. */
async function resolvePayerStorage(workspaceId: string): Promise<BillingStorageStatus> {
  const storageContext = await resolveStorageBillingContext(workspaceId)
  const usedBytes = await getStorageUsageForBillingContext(storageContext)
  return storageStatus(usedBytes, getStorageLimitForBillingContext(storageContext))
}

/** Only invoked once payer-pool disclosure is authorized. */
async function resolveAccountStorage(
  userId: string,
  subscription: HighestPrioritySubscription
): Promise<BillingStorageStatus> {
  const [usedBytes, limitBytes] = await Promise.all([
    getUserStorageUsage(userId, subscription),
    getUserStorageLimit(userId, subscription),
  ])
  return storageStatus(usedBytes, limitBytes)
}

export const getBillingStatus = defineAuthorizedBillingReadUseCase({
  operation: billingOperations.readStatus,
  requestedWorkspaceId: (input: GetBillingStatusInput) => input.workspaceId,
  execute: async ({ principal, scope }): Promise<BillingStatusResult> => {
    if (scope.kind === 'workspace') {
      const [attribution, canViewPayerPool] = await Promise.all([
        isUserCredentialPrincipal(principal)
          ? resolveBillingAttribution({
              actorUserId: principal.userId,
              workspaceId: scope.workspace.workspaceId,
            })
          : resolveSystemBillingAttribution(scope.workspace.workspaceId),
        canReadPayerPool(principal, scope.workspace),
      ])
      const [usage, block, storage] = await Promise.all([
        checkUsageStatus(attribution.billedAccountUserId, toUsageLimitSubscription(attribution)),
        checkAttributedBillingBlocks(attribution),
        canViewPayerPool ? resolvePayerStorage(scope.workspace.workspaceId) : null,
      ])
      return {
        workspaceId: scope.workspace.workspaceId,
        period: attribution.billingPeriod,
        plan: attribution.payerSubscription?.plan ?? 'free',
        status: block.blocked ? 'billing_blocked' : usage.isExceeded ? 'limit_exceeded' : 'active',
        credits: canViewPayerPool ? creditsStatus(usage) : null,
        storage,
      }
    }

    const subscription = await getHighestPrioritySubscription(scope.userId)
    const { billingEntity, billingPeriod } = deriveBillingContext(scope.userId, subscription)
    const isSelfPayer = isSelfBillingEntity(billingEntity, scope.userId)
    const canViewPayerPool = isSelfPayer
      ? true
      : await canUserManageBillingEntity(billingEntity, scope.userId)
    const [usage, actorBlock, payerBlock, storage] = await Promise.all([
      checkUsageStatus(scope.userId, subscription),
      checkBillingBlocked(scope.userId),
      isSelfPayer ? Promise.resolve({ blocked: false }) : checkBillingEntityBlocked(billingEntity),
      canViewPayerPool ? resolveAccountStorage(scope.userId, subscription) : null,
    ])
    return {
      workspaceId: null,
      period: {
        start: billingPeriod.start.toISOString(),
        end: billingPeriod.end.toISOString(),
      },
      plan: subscription?.plan ?? 'free',
      status:
        actorBlock.blocked || payerBlock.blocked
          ? 'billing_blocked'
          : usage.isExceeded
            ? 'limit_exceeded'
            : 'active',
      credits: canViewPayerPool ? creditsStatus(usage) : null,
      storage,
    }
  },
})
