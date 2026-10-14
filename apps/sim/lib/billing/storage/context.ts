import { db } from '@sim/db'
import { member } from '@sim/db/schema'
import { isRecordLike } from '@sim/utils/object'
import { and, eq } from 'drizzle-orm'
import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import { resolveWorkspaceBillingPayer } from '@/lib/billing/core/billing-attribution'
import { getHighestPriorityPersonalSubscription } from '@/lib/billing/core/subscription'
import type { BillingEntity } from '@/lib/billing/core/usage-log'
import type { DbOrTx } from '@/lib/db/types'

/**
 * Immutable resource-selected payer used for every storage quota and counter
 * decision in one operation. Actor identity is deliberately absent.
 */
export interface StoragePayerContext {
  readonly billedAccountUserId: string
  readonly billingEntity: Readonly<BillingEntity>
  readonly plan: string | null
  readonly customStorageLimitGB: number | null
}

export interface StorageBillingContext extends StoragePayerContext {
  readonly workspaceId: string
}

/** Canonical Project ownership supplied by an authorized application operation. */
export interface ProjectStorageOwnerSnapshot {
  readonly projectId: string
  readonly ownerId: string
  readonly organizationId: string | null
}

/** Ownership and payer assertions are rechecked under the Project mutation lock. */
export interface ProjectStorageBillingContext
  extends StoragePayerContext,
    ProjectStorageOwnerSnapshot {}

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
  workspaceId: string,
  executor: DbOrTx = db
): Promise<StorageBillingContext> {
  const payer = await resolveWorkspaceBillingPayer(workspaceId, { executor })
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

/** Resolves a Project's exact organization or personal payer independently of its creator and caller. */
export async function resolveProjectStorageBillingContext(
  owner: ProjectStorageOwnerSnapshot,
  executor: DbOrTx = db
): Promise<ProjectStorageBillingContext> {
  const [organizationOwners, payerSubscription] = await Promise.all([
    owner.organizationId
      ? executor
          .select({ userId: member.userId })
          .from(member)
          .where(and(eq(member.organizationId, owner.organizationId), eq(member.role, 'owner')))
          .limit(1)
      : Promise.resolve([]),
    owner.organizationId
      ? getOrganizationSubscription(owner.organizationId, { onError: 'throw', executor })
      : getHighestPriorityPersonalSubscription(owner.ownerId, {
          onError: 'throw',
          executor,
        }),
  ])
  const billedAccountUserId = owner.organizationId ? organizationOwners[0]?.userId : owner.ownerId
  if (!billedAccountUserId) throw new Error('Organization billing owner is unavailable')
  const payerId = owner.organizationId ?? owner.ownerId
  if (payerSubscription && payerSubscription.referenceId !== payerId) {
    throw new Error(`Resolved subscription does not belong to Project payer ${payerId}`)
  }
  const billingEntity: BillingEntity = owner.organizationId
    ? { type: 'organization', id: owner.organizationId }
    : { type: 'user', id: owner.ownerId }
  return Object.freeze({
    ...owner,
    billedAccountUserId,
    billingEntity: Object.freeze(billingEntity),
    plan: payerSubscription?.plan ?? null,
    customStorageLimitGB: owner.organizationId
      ? readCustomStorageLimitGB(payerSubscription?.metadata)
      : null,
  })
}
