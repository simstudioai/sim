import { db } from '@sim/db'
import { user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import {
  acquireOrganizationUserMutationLocks,
  removeExternalUserFromOrganizationWorkspaces,
  removeUserFromOrganization,
  WORKSPACE_BILLING_ACCOUNT_REMOVAL_ERROR,
} from '@/lib/billing/organizations/membership'
import { reconcileOrganizationSeats } from '@/lib/billing/organizations/seats'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { requireMemberManagementAuthority } from '@/lib/organizations/members/authority'
import { changeMemberRoleTx } from '@/lib/organizations/members/lifecycle'
import { findOrganizationMemberRecord } from '@/lib/organizations/queries'
import { assertMembershipNotScimManaged } from '@/ee/scim/lib/managed-membership'

const logger = createLogger('OrganizationMemberManager')

export async function updateOrganizationMemberRecord(input: {
  organizationId: string
  userId: string
  role: 'member' | 'admin' | 'owner'
  actorUserId: string
}) {
  return db.transaction(async (tx) => {
    await acquireOrganizationUserMutationLocks(tx, {
      userId: input.userId,
      organizationIds: [input.organizationId],
    })
    await requireMemberManagementAuthority(tx, input.organizationId, input.actorUserId)
    const target = await findOrganizationMemberRecord(input.organizationId, input.userId, tx)
    if (!target) throw new OrchestrationError('not_found', 'Member not found')
    if (target.role === 'owner')
      throw new OrchestrationError('validation', 'Cannot change owner role')
    if (input.role === 'owner')
      throw new OrchestrationError(
        'validation',
        'Ownership transfer is not supported via this endpoint. Use POST /organizations/[id]/transfer-ownership instead.'
      )
    await assertMembershipNotScimManaged({
      organizationId: input.organizationId,
      userId: input.userId,
      executor: tx,
    })
    const change = await changeMemberRoleTx(tx, { ...input, role: input.role })
    return {
      member: { ...target, role: input.role },
      previousRole: target.role,
      changed: change.changed,
    }
  })
}

export async function removeOrganizationMemberRecord(input: {
  organizationId: string
  userId: string
  actorUserId: string
  spareSessionId?: string
}) {
  const target = await findOrganizationMemberRecord(input.organizationId, input.userId)
  if (!target) {
    const [external] = await db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, input.userId))
      .limit(1)
    if (!external) throw new OrchestrationError('not_found', 'Member not found')
    const removal = await removeExternalUserFromOrganizationWorkspaces(input)
    if (!removal.success) {
      const message = removal.error || 'External workspace member not found'
      const code =
        message === 'External workspace member not found'
          ? 'not_found'
          : message === WORKSPACE_BILLING_ACCOUNT_REMOVAL_ERROR
            ? 'validation'
            : 'internal'
      throw new OrchestrationError(code, message)
    }
    return {
      membershipType: 'external' as const,
      target: { userId: external.id, userName: external.name, userEmail: external.email },
      removal,
      seatReduction: null,
    }
  }
  const removal = await removeUserFromOrganization({ ...input, memberId: target.id })
  if (!removal.success) {
    const message = removal.error || 'Failed to remove user from organization'
    const code =
      message === 'Member not found'
        ? 'not_found'
        : message === 'Cannot remove organization owner' ||
            message === WORKSPACE_BILLING_ACCOUNT_REMOVAL_ERROR
          ? 'validation'
          : 'internal'
    throw new OrchestrationError(code, message)
  }
  let seatReduction: Awaited<ReturnType<typeof reconcileOrganizationSeats>>
  try {
    seatReduction = await reconcileOrganizationSeats({
      organizationId: input.organizationId,
      reason: 'member-removed',
      actorId: input.actorUserId,
    })
  } catch (error) {
    logger.error('Failed to reduce seats after member removal', {
      organizationId: input.organizationId,
      error,
    })
    seatReduction = { changed: false, reason: 'Failed to reduce seats after member removal' }
  }
  return { membershipType: 'internal' as const, target, removal, seatReduction }
}
