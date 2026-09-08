import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import type { ScimUserAttributes } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { APIError } from 'better-auth/api'
import { auth } from '@/lib/auth'
import { applySessionPolicyToNewMember } from '@/lib/auth/session-policy'
import { syncUsageLimitsFromSubscription } from '@/lib/billing/core/usage'
import { ensureUserInOrganizationTx } from '@/lib/billing/organizations/membership'
import { resolveOrganizationSeatPolicyTx } from '@/lib/billing/organizations/seat-policy'
import { reconcileOrganizationSeats } from '@/lib/billing/organizations/seats'
import {
  getInstanceOrganizationId,
  isInstanceOrganizationMode,
} from '@/lib/organizations/instance-org'
import { suspendMemberTx, unsuspendMemberTx } from '@/lib/organizations/members/lifecycle'
import { invalidateAfterSessionRevocation } from '@/lib/organizations/members/revocation'
import { captureServerEvent } from '@/lib/posthog/server'
import { deleteUserAccount } from '@/lib/users/account-deletion'
import {
  defineAuthorizedScimUseCase,
  type ScimUseCaseArgs,
} from '@/ee/scim/lib/application/authorized-scim-use-case'
import { scimOperations } from '@/ee/scim/lib/application/operations'
import { syncAccountIdentityTx } from '@/ee/scim/lib/identity/account-identity'
import {
  assertEmailAvailable,
  consumeTombstone,
  resolveProvisionedIdentity,
} from '@/ee/scim/lib/identity/resolve-user'
import { reconcileUserProjection } from '@/ee/scim/lib/projection/reconcile-user'
import { primaryEmail } from '@/ee/scim/lib/protocol/canonical'
import { ScimError, uniqueness } from '@/ee/scim/lib/protocol/errors'
import { toUserResource } from '@/ee/scim/lib/protocol/resources'
import {
  assertUserNameAvailable,
  findScimUserById,
  findScimUserByUserId,
  insertScimUser,
  toUserResourceRow,
} from '@/ee/scim/lib/repository/users'

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
     * In instance-organization mode every account is placed in the instance
     * organization at creation, and an account belongs to one organization. A
     * connection for any other organization could never admit anyone.
     */
    if (isInstanceOrganizationMode()) {
      const instanceOrganizationId = await getInstanceOrganizationId()
      if (instanceOrganizationId && instanceOrganizationId !== context.organizationId) {
        throw new ScimError(
          409,
          undefined,
          'This deployment places every account in its instance organization, so directory provisioning is available only for that organization.'
        )
      }
    }

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

    if (await findScimUserByUserId(db, context.connection.id, userId)) {
      throw uniqueness('This directory already provisions the user')
    }

    let provisioned: {
      scimUserId: string
      joinedOrganization: boolean
      subscriptionId: string | undefined
      resource: ReturnType<typeof toUserResource>
    }
    try {
      provisioned = await db.transaction(async (tx) => {
        const seatPolicy = await resolveOrganizationSeatPolicyTx(tx, context.organizationId)
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
          /** A relinked account may still carry the suspension a lost deprovisioning left behind. */
          if (attributes.active) await unsuspendMemberTx(tx, { userId, source: 'scim' })
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
        const record = await findScimUserById(tx, context.connection.id, inserted.id)
        if (!record) {
          throw new ScimError(500, undefined, 'The provisioned user could not be read back')
        }
        return {
          scimUserId: inserted.id,
          joinedOrganization: !membership.alreadyMember,
          subscriptionId: seatPolicy.organizationSubscriptionId,
          resource: toUserResource(toUserResourceRow(record, []), context.baseUrl),
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
    return {
      ...provisioned,
      userId,
      createdAccount,
      organizationId: context.organizationId,
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
