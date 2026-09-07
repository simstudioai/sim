import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import { member } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { removeUserFromOrganization } from '@/lib/billing/organizations/membership'
import { reconcileOrganizationSeats } from '@/lib/billing/organizations/seats'
import {
  invalidateAfterSessionRevocation,
  revokePersonalApiKeysTx,
  revokeUserSessionsTx,
  unsuspendMemberTx,
} from '@/lib/organizations/members/lifecycle'
import {
  defineAuthorizedScimUseCase,
  type ScimUseCaseArgs,
} from '@/lib/scim/application/authorized-scim-use-case'
import { scimOperations } from '@/lib/scim/application/operations'
import { upsertTombstone } from '@/lib/scim/identity/resolve-user'
import { notFound, ScimError } from '@/lib/scim/protocol/errors'
import { deleteScimUser, findScimUserById } from '@/lib/scim/repository/users'

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
 * Okta never sends this — it deactivates instead — but Microsoft Entra does, 30
 * days after a hard delete, and OneLogin and JumpCloud can be configured to. The
 * Sim account itself survives: the person may hold access in another
 * organization later, and their audit history must remain attributable.
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
      /**
       * Owns its own invitation-safe lock scope, clears every workspace
       * permission and permission-group membership in the organization, and
       * reassigns everything the member owned — so directory-granted access is
       * withdrawn here as a consequence, and the projection rows cascade away
       * with the SCIM user below.
       */
      const removal = await removeUserFromOrganization({
        userId: current.userId,
        organizationId: context.organizationId,
        memberId: membership.id,
      })
      if (!removal.success) {
        throw new ScimError(409, undefined, removal.error ?? 'The member could not be removed')
      }
    }

    await db.transaction(async (tx) => {
      await revokeUserSessionsTx(tx, {
        userId: current.userId,
        organizationId: context.organizationId,
      })
      await revokePersonalApiKeysTx(tx, { userId: current.userId })
      /** A suspension the directory applied has no meaning once membership ends. */
      await unsuspendMemberTx(tx, { userId: current.userId, source: 'scim' })

      if (current.externalId) {
        await upsertTombstone(tx, {
          connectionId: context.connection.id,
          externalId: current.externalId,
          userId: current.userId,
        })
      }
      await deleteScimUser(tx, current.id)
    })

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
    invalidateAfterSessionRevocation({
      userId: result.userId,
      organizationId: context.organizationId,
    })
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
