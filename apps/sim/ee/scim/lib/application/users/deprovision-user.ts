import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import { member } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { removeUserFromOrganization } from '@/lib/billing/organizations/membership'
import { reconcileOrganizationSeats } from '@/lib/billing/organizations/seats'
import {
  defineAuthorizedScimUseCase,
  type ScimUseCaseArgs,
} from '@/ee/scim/lib/application/authorized-scim-use-case'
import { scimOperations } from '@/ee/scim/lib/application/operations'
import { endDirectoryMembershipTx } from '@/ee/scim/lib/identity/end-directory-membership'
import { notFound, ScimError } from '@/ee/scim/lib/protocol/errors'
import { findScimUserById } from '@/ee/scim/lib/repository/users'

const logger = createLogger('ScimDeprovisionUser')

export interface DeprovisionScimUserInput {
  scimUserId: string
}

export interface DeprovisionScimUserResult {
  scimUserId: string
  userId: string
  /** False when the account had already left the organization by other means. */
  removedFromOrganization: boolean
}

/**
 * Removes a user from the organization at the directory's instruction.
 *
 * The Sim account survives because the person may join another organization
 * later and their audit history must remain attributable.
 *
 * Removal is the same primitive the settings UI uses. It ends the membership,
 * revokes sessions and personal keys, reassigns what the member owned, and
 * retires this directory row into its tombstone, all in one commit.
 */
export const deprovisionScimUser = defineAuthorizedScimUseCase({
  operation: scimOperations.deprovisionUser,
  async execute({
    input,
    context,
  }: ScimUseCaseArgs<DeprovisionScimUserInput>): Promise<DeprovisionScimUserResult> {
    const current = await findScimUserById(db, context.connection.id, input.scimUserId)
    if (!current) throw notFound('SCIM User not found')

    const [membership] = await db
      .select({ id: member.id, role: member.role })
      .from(member)
      .where(
        and(eq(member.organizationId, context.organizationId), eq(member.userId, current.userId))
      )
      .limit(1)

    /**
     * The owner is refused. Removing them would leave the organization with
     * nobody able to administer billing or transfer ownership, and a directory
     * cannot know that Sim treats one member differently.
     */
    if (membership?.role === 'owner') {
      throw new ScimError(
        409,
        undefined,
        'The organization owner cannot be deprovisioned through the directory. Transfer ownership in Sim first.'
      )
    }

    if (membership) {
      const removal = await removeUserFromOrganization({
        userId: current.userId,
        organizationId: context.organizationId,
        memberId: membership.id,
        revokePersonalApiKeys: true,
      })
      if (!removal.success) {
        throw new ScimError(409, undefined, removal.error ?? 'The member could not be removed')
      }
    } else {
      /**
       * The account left through a path that predates this connection's row, or
       * was hard-deleted and recreated. Only the directory's own record remains
       * to retire; there is no live access left to revoke.
       */
      await db.transaction((tx) =>
        endDirectoryMembershipTx(tx, {
          userId: current.userId,
          organizationId: context.organizationId,
        })
      )
    }

    return {
      scimUserId: current.id,
      userId: current.userId,
      removedFromOrganization: Boolean(membership),
    }
  },

  projectAudit: ({ result, context }) => [
    {
      action: AuditAction.SCIM_USER_DEPROVISIONED,
      resourceType: AuditResourceType.USER,
      resourceId: result.userId,
      metadata: { scimUserId: result.scimUserId },
    },
    ...(result.removedFromOrganization
      ? [
          {
            action: AuditAction.ORG_MEMBER_REMOVED,
            resourceType: AuditResourceType.ORGANIZATION,
            resourceId: context.organizationId,
            description: 'Removed from the organization through directory deprovisioning',
            metadata: { targetUserId: result.userId, scimUserId: result.scimUserId },
          },
        ]
      : []),
  ],

  afterSuccess: async ({ result, context }) => {
    if (!result.removedFromOrganization) return
    try {
      await reconcileOrganizationSeats({
        organizationId: context.organizationId,
        reason: 'scim-member-removed',
      })
    } catch (error) {
      logger.error('Failed to reconcile seats after directory deprovisioning', { error })
    }
  },
})
