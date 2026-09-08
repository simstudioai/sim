import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import {
  account,
  invitation,
  member,
  permissions,
  scimConnection,
  ssoProvider,
  user,
  workspace,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { normalizeSSODomain } from '@sim/utils/sso-domain'
import { normalizeEmail } from '@sim/utils/string'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { applySessionPolicyToNewMember } from '@/lib/auth/session-policy'
import { ssoJitAdmissionOperation } from '@/lib/auth/sso/application/operations'
import { syncUsageLimitsFromSubscription } from '@/lib/billing/core/usage'
import {
  acquireOrganizationUserMutationLocks,
  ensureUserInOrganizationTx,
} from '@/lib/billing/organizations/membership'
import { resolveOrganizationSeatPolicyTx } from '@/lib/billing/organizations/seat-policy'
import { reconcileOrganizationSeats } from '@/lib/billing/organizations/seats'
import { assertOperationPrincipal, type OperationUseCase } from '@/lib/core/application/operation'
import { captureServerEvent } from '@/lib/posthog/server'
import { isScimEntitledForOrganization } from '@/ee/scim/lib/entitlement'

const logger = createLogger('SsoJitAdmission')

export interface SsoJitAdmissionInput {
  providerId: string
}

export type SsoJitAdmissionResult =
  | {
      kind: 'provisioned' | 'already-member'
      organizationId: string
      memberId: string
    }
  | {
      kind: 'provisioning-disabled' | 'organization-not-bound'
      organizationId: string | null
    }
  | {
      kind: 'pending-invitation' | 'external-collaborator'
      organizationId: string
    }
  | {
      kind: 'denied'
      reason:
        | 'account-not-linked'
        | 'admission-failed'
        | 'domain-mismatch'
        | 'organization-conflict'
        | 'provider-not-trusted'
        | 'provider-not-found'
        | 'seats-unavailable'
        | 'user-not-found'
    }

interface SuccessfulAdmission {
  result: SsoJitAdmissionResult
  userName?: string
  userEmail?: string
  organizationSubscriptionId?: string
}

async function runAdmissionTransaction(
  userId: string,
  providerId: string
): Promise<SuccessfulAdmission> {
  return db.transaction(async (tx) => {
    const [provider] = await tx
      .select({
        id: ssoProvider.id,
        domain: ssoProvider.domain,
        domainVerified: ssoProvider.domainVerified,
        jitProvisioningEnabled: ssoProvider.jitProvisioningEnabled,
        organizationId: ssoProvider.organizationId,
      })
      .from(ssoProvider)
      .where(eq(ssoProvider.providerId, providerId))
      .limit(1)
      .for('share')

    if (!provider) {
      return { result: { kind: 'denied', reason: 'provider-not-found' } }
    }
    if (!provider.domainVerified) {
      return { result: { kind: 'denied', reason: 'provider-not-trusted' } }
    }

    const [[userRow], [linkedAccount]] = await Promise.all([
      tx
        .select({ id: user.id, email: user.email, name: user.name })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1),
      tx
        .select({ id: account.id })
        .from(account)
        .where(and(eq(account.userId, userId), eq(account.providerId, providerId)))
        .limit(1),
    ])

    if (!userRow) {
      return { result: { kind: 'denied', reason: 'user-not-found' } }
    }
    if (!linkedAccount) {
      return { result: { kind: 'denied', reason: 'account-not-linked' } }
    }
    const userDomain = normalizeSSODomain(userRow.email)
    const providerDomain = normalizeSSODomain(provider.domain)
    if (!userDomain || !providerDomain || userDomain !== providerDomain) {
      return { result: { kind: 'denied', reason: 'domain-mismatch' } }
    }

    const attribution = { userName: userRow.name, userEmail: userRow.email }
    if (!provider.organizationId) {
      return {
        ...attribution,
        result: { kind: 'organization-not-bound', organizationId: null },
      }
    }

    await acquireOrganizationUserMutationLocks(tx, {
      userId,
      organizationIds: [provider.organizationId],
    })

    /**
     * An organization whose directory is the only way in has said so on its
     * SCIM connection; a first sign-in must not create a membership the directory
     * did not ask for and will not know about.
     */
    const [directoryOnly] = await tx
      .select({ id: scimConnection.id })
      .from(scimConnection)
      .where(
        and(
          eq(scimConnection.organizationId, provider.organizationId),
          eq(scimConnection.status, 'active'),
          sql`coalesce((${scimConnection.settings} ->> 'disableJit')::boolean, false) = true`
        )
      )
      .limit(1)

    /** A directory that can no longer sync (plan lapsed, feature off) no longer owns the door either. */
    const directoryOwnsAdmission =
      Boolean(directoryOnly) && (await isScimEntitledForOrganization(provider.organizationId, tx))

    if (!provider.jitProvisioningEnabled || directoryOwnsAdmission) {
      const [sameOrganization] = await tx
        .select({ id: member.id })
        .from(member)
        .where(and(eq(member.userId, userId), eq(member.organizationId, provider.organizationId)))
        .limit(1)
      if (sameOrganization) {
        return {
          ...attribution,
          result: {
            kind: 'already-member',
            organizationId: provider.organizationId,
            memberId: sameOrganization.id,
          },
        }
      }
      return {
        ...attribution,
        result: {
          kind: 'provisioning-disabled',
          organizationId: provider.organizationId,
        },
      }
    }

    const memberships = await tx
      .select({ id: member.id, organizationId: member.organizationId })
      .from(member)
      .where(eq(member.userId, userId))

    const sameOrganization = memberships.find(
      (membership) => membership.organizationId === provider.organizationId
    )
    if (sameOrganization) {
      return {
        ...attribution,
        result: {
          kind: 'already-member',
          organizationId: provider.organizationId,
          memberId: sameOrganization.id,
        },
      }
    }

    const normalizedEmail = normalizeEmail(userRow.email)
    const [[pendingInvitation], [externalPermission]] = await Promise.all([
      tx
        .select({ id: invitation.id })
        .from(invitation)
        .where(
          and(
            eq(invitation.organizationId, provider.organizationId),
            eq(invitation.status, 'pending'),
            gt(invitation.expiresAt, new Date()),
            sql`lower(trim(${invitation.email})) = ${normalizedEmail}`
          )
        )
        .limit(1),
      tx
        .select({ id: permissions.id })
        .from(permissions)
        .innerJoin(
          workspace,
          and(eq(permissions.entityType, 'workspace'), eq(permissions.entityId, workspace.id))
        )
        .where(
          and(
            eq(permissions.userId, userId),
            eq(workspace.organizationId, provider.organizationId),
            isNull(workspace.archivedAt)
          )
        )
        .limit(1),
    ])

    if (pendingInvitation) {
      return {
        ...attribution,
        result: {
          kind: 'pending-invitation',
          organizationId: provider.organizationId,
        },
      }
    }
    if (externalPermission) {
      return {
        ...attribution,
        result: {
          kind: 'external-collaborator',
          organizationId: provider.organizationId,
        },
      }
    }
    if (memberships.length > 0) {
      return {
        ...attribution,
        result: { kind: 'denied', reason: 'organization-conflict' },
      }
    }

    const seatPolicy = await resolveOrganizationSeatPolicyTx(tx, provider.organizationId)
    const membershipResult = await ensureUserInOrganizationTx(tx, {
      userId,
      organizationId: provider.organizationId,
      role: 'member',
      ...seatPolicy,
    })

    if (!membershipResult.success || !membershipResult.memberId) {
      const reason =
        membershipResult.failureCode === 'already-in-other-organization'
          ? 'organization-conflict'
          : membershipResult.failureCode === 'no-seats-available'
            ? 'seats-unavailable'
            : membershipResult.failureCode === 'user-not-found'
              ? 'user-not-found'
              : 'admission-failed'
      return { ...attribution, result: { kind: 'denied', reason } }
    }

    return {
      ...attribution,
      ...(seatPolicy.organizationSubscriptionId
        ? { organizationSubscriptionId: seatPolicy.organizationSubscriptionId }
        : {}),
      result: {
        kind: membershipResult.alreadyMember ? 'already-member' : 'provisioned',
        organizationId: provider.organizationId,
        memberId: membershipResult.memberId,
      },
    }
  })
}

async function runProvisioningPostCommitEffects(
  userId: string,
  admission: SuccessfulAdmission
): Promise<void> {
  if (admission.result.kind !== 'provisioned') return

  const organizationId = admission.result.organizationId
  await applySessionPolicyToNewMember(userId, organizationId)

  try {
    recordAudit({
      workspaceId: null,
      actorId: userId,
      actorName: admission.userName,
      actorEmail: admission.userEmail,
      action: AuditAction.ORG_MEMBER_ADDED,
      resourceType: AuditResourceType.ORGANIZATION,
      resourceId: organizationId,
      description: 'Joined organization as member through SSO just-in-time provisioning',
      metadata: {
        memberId: admission.result.memberId,
        memberRole: 'member',
        operation: ssoJitAdmissionOperation.id,
        source: 'sso_jit',
      },
    })
    captureServerEvent(
      userId,
      'org_member_added',
      {
        organization_id: organizationId,
        member_role: 'member',
      },
      { groups: { organization: organizationId } }
    )
  } catch (error) {
    logger.error('Failed to record SSO JIT admission telemetry', {
      userId,
      organizationId,
      error,
    })
  }

  try {
    await reconcileOrganizationSeats({
      organizationId,
      reason: 'sso-jit-member-added',
      actorId: userId,
      ...(admission.organizationSubscriptionId
        ? { subscriptionId: admission.organizationSubscriptionId }
        : {}),
    })
  } catch (error) {
    logger.error('Failed to reconcile organization seats after SSO JIT admission', {
      userId,
      organizationId,
      error,
    })
  }

  try {
    await syncUsageLimitsFromSubscription(userId)
  } catch (error) {
    logger.error('Failed to sync usage limits after SSO JIT admission', {
      userId,
      organizationId,
      error,
    })
  }
}

export const admitSsoUser: OperationUseCase<
  typeof ssoJitAdmissionOperation,
  SsoJitAdmissionInput,
  SsoJitAdmissionResult
> = {
  operation: ssoJitAdmissionOperation,
  async execute({ principal, input }) {
    assertOperationPrincipal(principal, ssoJitAdmissionOperation)
    const admission = await runAdmissionTransaction(principal.userId, input.providerId)
    await runProvisioningPostCommitEffects(principal.userId, admission)
    return admission.result
  },
}
