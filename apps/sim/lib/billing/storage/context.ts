import { isRecordLike } from '@sim/utils/object'
import { resolveWorkspaceBillingPayer } from '@/lib/billing/core/billing-attribution'
import type { BillingEntity } from '@/lib/billing/core/usage-log'

/**
 * Immutable workspace-selected payer used for every storage quota and counter
 * decision in one operation. Actor identity is deliberately absent.
 */
export interface StorageBillingContext {
  readonly workspaceId: string
  readonly billedAccountUserId: string
  readonly billingEntity: Readonly<BillingEntity>
  readonly plan: string | null
  readonly customStorageLimitGB: number | null
}

function readCustomStorageLimitGB(metadata: unknown): number | null {
  if (!isRecordLike(metadata)) return null
  const value = metadata.customStorageLimitGB
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/**
 * Resolves storage billing from the workspace payer once, without consulting
 * the uploader's subscriptions or organization memberships.
 */
export async function resolveStorageBillingContext(
  workspaceId: string
): Promise<StorageBillingContext> {
  const payer = await resolveWorkspaceBillingPayer(workspaceId)
  if (!payer) {
    throw new Error(`Unable to resolve storage payer for workspace ${workspaceId}`)
  }

  const billingEntity: BillingEntity = payer.organizationId
    ? { type: 'organization', id: payer.organizationId }
    : { type: 'user', id: payer.billedAccountUserId }
  Object.freeze(billingEntity)

  return Object.freeze({
    workspaceId,
    billedAccountUserId: payer.billedAccountUserId,
    billingEntity,
    plan: payer.payerSubscription?.plan ?? null,
    customStorageLimitGB:
      billingEntity.type === 'organization'
        ? readCustomStorageLimitGB(payer.payerSubscription?.metadata)
        : null,
  })
}
