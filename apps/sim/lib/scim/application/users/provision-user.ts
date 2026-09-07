import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import { type ScimUserAttributes, subscription } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { APIError } from 'better-auth/api'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { applySessionPolicyToNewMember } from '@/lib/auth/session-policy'
import { syncUsageLimitsFromSubscription } from '@/lib/billing/core/usage'
import {
  ensureUserInOrganizationTx,
  getUserOrganization,
} from '@/lib/billing/organizations/membership'
import { reconcileOrganizationSeats } from '@/lib/billing/organizations/seats'
import { isTeam } from '@/lib/billing/plan-helpers'
import { ENTITLED_SUBSCRIPTION_STATUSES } from '@/lib/billing/subscriptions/utils'
import type { DbOrTx } from '@/lib/db/types'
import {
  invalidateAfterSessionRevocation,
  suspendMemberTx,
} from '@/lib/organizations/members/lifecycle'
import { captureServerEvent } from '@/lib/posthog/server'
import {
  defineAuthorizedScimUseCase,
  type ScimUseCaseArgs,
} from '@/lib/scim/application/authorized-scim-use-case'
import { scimOperations } from '@/lib/scim/application/operations'
import { syncAccountIdentityTx } from '@/lib/scim/identity/account-identity'
import {
  assertEmailAvailable,
  consumeTombstone,
  resolveProvisionedIdentity,
} from '@/lib/scim/identity/resolve-user'
import { reconcileUserProjection } from '@/lib/scim/projection/reconcile-user'
import { primaryEmail } from '@/lib/scim/protocol/canonical'
import { ScimError, uniqueness } from '@/lib/scim/protocol/errors'
import { toUserResource } from '@/lib/scim/protocol/resources'
import {
  assertUserNameAvailable,
  deleteScimUser,
  findScimUserById,
  findScimUserByUserId,
  insertScimUser,
  toUserResourceRow,
} from '@/lib/scim/repository/users'
import { deleteUserAccount } from '@/lib/users/account-deletion'

const logger = createLogger('ScimProvisionUser')

export interface ProvisionScimUserInput {
  attributes: ScimUserAttributes
}

export interface ProvisionScimUserResult {
  scimUserId: string
  userId: string
  createdAccount: boolean
  /** False when the account was already a member and only the SCIM link was new. */
  joinedOrganization: boolean
  /** The subscription seats were validated against, so the post-commit seat sync targets the same one. */
  subscriptionId: string | undefined
  organizationId: string
  resource: ReturnType<typeof toUserResource>
}

/**
 * Whether this organization's plan lets membership grow on demand.
 *
 * Team plans add a seat when someone joins; Enterprise buys a fixed number in
 * advance and must refuse beyond it. The same rule governs SSO just-in-time
 * provisioning, so a directory and a first sign-in agree on who fits.
 */
async function resolveSeatPolicy(
  tx: DbOrTx,
  organizationId: string
): Promise<{ skipSeatValidation?: true; organizationSubscriptionId?: string }> {
  const [entitled] = await tx
    .select({ id: subscription.id, plan: subscription.plan })
    .from(subscription)
    .where(
      and(
        eq(subscription.referenceId, organizationId),
        inArray(subscription.status, ENTITLED_SUBSCRIPTION_STATUSES)
      )
    )
    .orderBy(desc(subscription.periodStart), desc(subscription.id))
    .limit(1)

  return {
    ...(isTeam(entitled?.plan) ? { skipSeatValidation: true as const } : {}),
    ...(entitled?.id ? { organizationSubscriptionId: entitled.id } : {}),
  }
}

/** Turns a membership refusal into the SCIM error a directory administrator can act on. */
function membershipFailure(code: string | undefined): ScimError {
  if (code === 'no-seats-available') {
    return new ScimError(
      409,
      undefined,
      'This organization has no available seats. Add seats in Sim, then retry provisioning.'
    )
  }
  if (code === 'already-in-other-organization') {
    return uniqueness('This user already belongs to a different Sim organization')
  }
  return new ScimError(409, undefined, 'The user could not be added to the organization')
}

/**
 * Creates a user resource, and the Sim account behind it when there is not one
 * already.
 */
export const provisionScimUser = defineAuthorizedScimUseCase({
  operation: scimOperations.provisionUser,
  async execute({
    input,
    context,
  }: ScimUseCaseArgs<ProvisionScimUserInput>): Promise<ProvisionScimUserResult> {
    const { attributes } = input
    const email = primaryEmail(attributes)

    /**
     * Account creation happens before the transaction because it runs through
     * Better Auth, which owns its own writes and its own hooks — the blocked
     * email gate, the usage-counter row, and instance-organization placement all
     * hang off them. Reimplementing that with a direct insert would skip every
     * one.
     */
    const resolution = await resolveProvisionedIdentity(db, {
      connectionId: context.connection.id,
      organizationId: context.organizationId,
      attributes,
    })

    let userId: string
    let createdAccount = false

    /**
     * `userName` is unique per connection. Checked up front for a message the
     * directory administrator can read; a race that slips past this lands on the
     * unique index and is rendered as the same 409 by the error mapper.
     */
    await assertUserNameAvailable(db, context.connection.id, attributes.userName)

    if (resolution.action === 'create') {
      await assertEmailAvailable(db, email)
      try {
        const created = await auth.api.createUser({
          body: {
            email,
            name: attributes.name.formatted,
            data: { emailVerified: false },
          },
        })
        userId = created.user.id
      } catch (error) {
        /**
         * Two creates for one address can race past the availability check;
         * Better Auth's unique constraint is the arbiter, and the loser is a
         * duplicate the directory must resolve, not a server fault to retry.
         */
        if (error instanceof APIError && error.statusCode === 422) {
          throw uniqueness('Another Sim account already uses this email address')
        }
        throw error
      }
      createdAccount = true
    } else {
      userId = resolution.userId
    }

    const existing = await findScimUserByUserId(db, context.connection.id, userId)
    if (existing) {
      /**
       * A SCIM row whose account has already left the organization is the
       * residue of a deprovisioning interrupted between its two commits. The
       * directory is telling us the person is back; clearing the stale row lets
       * it proceed rather than reporting a conflict nobody can act on.
       */
      const stillMember = await getUserOrganization(userId)
      if (stillMember?.organizationId === context.organizationId) {
        throw uniqueness('This directory already provisions the user')
      }
      await deleteScimUser(db, existing.id)
    }

    let provisioned: {
      scimUserId: string
      joinedOrganization: boolean
      subscriptionId: string | undefined
    }
    try {
      provisioned = await db.transaction(async (tx) => {
        const seatPolicy = await resolveSeatPolicy(tx, context.organizationId)
        const membership = await ensureUserInOrganizationTx(tx, {
          userId,
          organizationId: context.organizationId,
          role: 'member',
          ...seatPolicy,
        })
        if (!membership.success) throw membershipFailure(membership.failureCode)

        /**
         * A relinked account takes the directory's current identity. A rename
         * that arrives as delete-and-recreate must land the same way as one that
         * arrives as a PATCH, or the response would describe an address the
         * account does not have.
         */
        if (resolution.action === 'link') {
          await syncAccountIdentityTx(tx, { userId, email, name: attributes.name.formatted })
        }

        const inserted = await insertScimUser(tx, {
          connectionId: context.connection.id,
          userId,
          attributes,
          active: attributes.active,
        })

        /**
         * Microsoft Entra pre-provisions a disabled account before its start date,
         * so a create can arrive already inactive and must land suspended rather
         * than briefly usable.
         */
        if (!attributes.active) {
          await suspendMemberTx(tx, {
            userId,
            organizationId: context.organizationId,
            source: 'scim',
          })
        }

        await consumeTombstone(tx, {
          connectionId: context.connection.id,
          externalId: attributes.externalId,
        })
        await reconcileUserProjection(tx, {
          connectionId: context.connection.id,
          organizationId: context.organizationId,
          scimUserId: inserted.id,
          settings: context.connection.settings,
        })
        return {
          scimUserId: inserted.id,
          joinedOrganization: !membership.alreadyMember,
          subscriptionId: seatPolicy.organizationSubscriptionId,
        }
      })
    } catch (error) {
      /**
       * The account was created through Better Auth ahead of this transaction,
       * so a refusal here — no seats, a lock timeout — would otherwise leave an
       * orphan with no membership and no directory link. Removing it means the
       * directory's retry starts from a clean slate instead of a half-state.
       */
      if (createdAccount) {
        await deleteUserAccount(userId).catch((cleanupError) =>
          logger.error('Failed to remove an account after provisioning was refused', {
            userId,
            cleanupError,
          })
        )
      }
      throw error
    }
    const { scimUserId, joinedOrganization, subscriptionId } = provisioned

    const record = await findScimUserById(db, context.connection.id, scimUserId)
    if (!record) throw new ScimError(500, undefined, 'The provisioned user could not be read back')

    return {
      scimUserId,
      userId,
      createdAccount,
      joinedOrganization,
      subscriptionId,
      organizationId: context.organizationId,
      resource: toUserResource(toUserResourceRow(record, []), context.baseUrl),
    }
  },

  projectAudit: ({ result }) => [
    {
      action: AuditAction.SCIM_USER_PROVISIONED,
      resourceType: AuditResourceType.USER,
      resourceId: result.userId,
      metadata: { scimUserId: result.scimUserId, createdAccount: result.createdAccount },
    },
    ...(result.joinedOrganization
      ? [
          {
            action: AuditAction.ORG_MEMBER_ADDED,
            resourceType: AuditResourceType.ORGANIZATION,
            resourceId: result.organizationId,
            description: 'Joined the organization through directory provisioning',
            metadata: { memberRole: 'member', scimUserId: result.scimUserId },
          },
        ]
      : []),
  ],

  /**
   * Post-commit effects mirror what SSO just-in-time admission runs, each
   * guarded on its own: a failure to reconcile seats must not undo a membership
   * that is already committed and already correct.
   */
  afterSuccess: async ({ result, context }) => {
    /** A member provisioned already inactive had their sessions revoked inside the transaction. */
    if (!result.resource.active) {
      invalidateAfterSessionRevocation({
        userId: result.userId,
        organizationId: context.organizationId,
      })
    }
    try {
      await applySessionPolicyToNewMember(result.userId, context.organizationId)
    } catch (error) {
      logger.error('Failed to apply session policy to a provisioned member', { error })
    }
    try {
      await reconcileOrganizationSeats({
        organizationId: context.organizationId,
        reason: 'scim-member-added',
        /** The subscription admission was validated against, not whichever is newest now. */
        ...(result.subscriptionId ? { subscriptionId: result.subscriptionId } : {}),
      })
    } catch (error) {
      logger.error('Failed to reconcile seats after directory provisioning', { error })
    }
    try {
      await syncUsageLimitsFromSubscription(result.userId)
    } catch (error) {
      logger.error('Failed to sync usage limits after directory provisioning', { error })
    }
    captureServerEvent(
      result.userId,
      'scim_user_provisioned',
      { organization_id: context.organizationId, created_account: result.createdAccount },
      { groups: { organization: context.organizationId } }
    )
  },
})
