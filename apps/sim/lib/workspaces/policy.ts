import { db } from '@sim/db'
import { member, type WorkspaceMode, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import { and, count, eq, isNull } from 'drizzle-orm'
import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import { getHighestPrioritySubscription } from '@/lib/billing/core/plan'
import { getUserOrganization } from '@/lib/billing/organizations/membership'
import type { PlanCategory } from '@/lib/billing/plan-helpers'
import { getPlanType, isEnterprise, isMax, isPro, isTeam } from '@/lib/billing/plan-helpers'
import { hasUsableSubscriptionStatus } from '@/lib/billing/subscriptions/utils'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import {
  CONTACT_OWNER_TO_UPGRADE_REASON,
  UPGRADE_TO_INVITE_REASON,
} from '@/lib/workspaces/policy-constants'

const logger = createLogger('WorkspacePolicy')

export const WORKSPACE_MODE = {
  PERSONAL: 'personal',
  ORGANIZATION: 'organization',
  GRANDFATHERED_SHARED: 'grandfathered_shared',
} as const satisfies Record<string, WorkspaceMode>

interface WorkspaceOwnershipState {
  organizationId: string | null
  workspaceMode: WorkspaceMode
  billedAccountUserId: string
  ownerId: string
}

export {
  CONTACT_OWNER_TO_UPGRADE_REASON,
  UPGRADE_TO_INVITE_REASON,
} from '@/lib/workspaces/policy-constants'

export interface WorkspaceInvitePolicy {
  allowed: boolean
  reason: string | null
  requiresSeat: boolean
  organizationId: string | null
  upgradeRequired: boolean
}

/** Caller-facing invite flags derived from an evaluated invite policy. */
export interface WorkspaceInviteFlags {
  inviteMembersEnabled: boolean
  inviteDisabledReason: string | null
  inviteUpgradeRequired: boolean
}

/**
 * Derives the caller-facing invite flags for a workspace response. Only the
 * billed user can act on an upgrade, so everyone else gets the contact-owner
 * message when invites are disabled.
 */
export function resolveInviteFlags(
  invitePolicy: WorkspaceInvitePolicy,
  callerIsBilledUser: boolean
): WorkspaceInviteFlags {
  return {
    inviteMembersEnabled: invitePolicy.allowed,
    inviteDisabledReason: invitePolicy.allowed
      ? null
      : callerIsBilledUser
        ? (invitePolicy.reason ?? UPGRADE_TO_INVITE_REASON)
        : CONTACT_OWNER_TO_UPGRADE_REASON,
    inviteUpgradeRequired: invitePolicy.upgradeRequired && callerIsBilledUser,
  }
}

export interface WorkspaceCreationPolicy {
  canCreate: boolean
  workspaceMode: WorkspaceMode
  organizationId: string | null
  billedAccountUserId: string
  maxWorkspaces: number | null
  currentWorkspaceCount: number
  reason: string | null
  status: number
}

interface GetWorkspaceCreationPolicyParams {
  userId: string
  activeOrganizationId?: string | null
  /**
   * When true, `activeOrganizationId` is authoritative: it is used exactly as given
   * (including `null`, which means a personal workspace) and never falls back to the
   * caller's membership org. Forks set this so the child always lands in the SOURCE's
   * org, not whatever org the acting user happens to belong to.
   */
  pinOrganization?: boolean
}

export function isOrganizationWorkspace(
  workspaceState: Pick<WorkspaceOwnershipState, 'workspaceMode' | 'organizationId'>
): boolean {
  return (
    workspaceState.workspaceMode === WORKSPACE_MODE.ORGANIZATION &&
    workspaceState.organizationId !== null &&
    workspaceState.organizationId.length > 0
  )
}

/**
 * Computes whether new members can be invited to the given workspace
 * under the active product policy.
 *
 * Any paid billed account (Pro, Team, or Enterprise) may invite — the
 * seat, and any Pro→Team upgrade, is provisioned when the invitee
 * accepts, so invites are no longer seat-gated at this layer. Free
 * accounts are blocked with an upgrade tooltip because there is no
 * payment method to charge at acceptance.
 *
 * - `organization`: allowed; the org already holds a Team/Enterprise
 *   subscription. Only Enterprise keeps an invite-time `requiresSeat`
 *   gate (fixed seats).
 * - `personal` / `grandfathered_shared`: allowed when the billed user is
 *   Pro/Team/Enterprise. For Pro, acceptance creates the org and moves the
 *   subscription to the Team tier.
 *
 * Billing-disabled deployments always allow invites. Existing members
 * keep their access — this policy only governs *new* invitations.
 */
export async function getWorkspaceInvitePolicy(
  workspaceState: WorkspaceOwnershipState
): Promise<WorkspaceInvitePolicy> {
  const billedPlanCategory = isBillingEnabled
    ? await resolveBilledPlanCategory(workspaceState)
    : 'free'
  return evaluateWorkspaceInvitePolicy(workspaceState, { billedPlanCategory })
}

/**
 * Pure evaluator — given the billed account's resolved plan category,
 * returns the policy synchronously. Exposed so bulk callers (e.g. listing
 * every workspace a user can see) can batch the subscription lookups by
 * unique billed account user rather than re-querying per workspace.
 */
export function evaluateWorkspaceInvitePolicy(
  workspaceState: WorkspaceOwnershipState,
  context: { billedPlanCategory: PlanCategory }
): WorkspaceInvitePolicy {
  if (!isBillingEnabled) {
    return {
      allowed: true,
      reason: null,
      requiresSeat: false,
      organizationId: workspaceState.organizationId,
      upgradeRequired: false,
    }
  }

  if (workspaceState.workspaceMode === WORKSPACE_MODE.ORGANIZATION) {
    if (workspaceState.organizationId === null || context.billedPlanCategory === 'free') {
      return blockInvite(workspaceState.organizationId)
    }

    return {
      allowed: true,
      reason: null,
      requiresSeat: context.billedPlanCategory === 'enterprise',
      organizationId: workspaceState.organizationId,
      upgradeRequired: false,
    }
  }

  switch (context.billedPlanCategory) {
    case 'pro':
    case 'team':
      return {
        allowed: true,
        reason: null,
        requiresSeat: false,
        organizationId: workspaceState.organizationId,
        upgradeRequired: false,
      }
    case 'enterprise':
      return {
        allowed: true,
        reason: null,
        requiresSeat: true,
        organizationId: workspaceState.organizationId,
        upgradeRequired: false,
      }
    default:
      return blockInvite(workspaceState.organizationId)
  }
}

function blockInvite(organizationId: string | null): WorkspaceInvitePolicy {
  return {
    allowed: false,
    reason: UPGRADE_TO_INVITE_REASON,
    requiresSeat: false,
    organizationId,
    upgradeRequired: true,
  }
}

async function resolveBilledPlanCategory(
  workspaceState: WorkspaceOwnershipState
): Promise<PlanCategory> {
  if (
    workspaceState.workspaceMode === WORKSPACE_MODE.ORGANIZATION &&
    workspaceState.organizationId
  ) {
    return getInvitePlanCategoryForOrganization(workspaceState.organizationId)
  }
  return getInvitePlanCategoryForUser(workspaceState.billedAccountUserId)
}

/**
 * Resolve the invite-governing plan category for an organization from its
 * subscription. Exposed so bulk callers can batch by unique organization id.
 * Returns `'free'` when there is no usable subscription so lapsed orgs are
 * blocked consistently with accept-time provisioning.
 */
export async function getInvitePlanCategoryForOrganization(
  organizationId: string
): Promise<PlanCategory> {
  try {
    const orgSub = await getOrganizationSubscription(organizationId)
    if (!orgSub || !hasUsableSubscriptionStatus(orgSub.status)) return 'free'
    return getPlanType(orgSub.plan)
  } catch (error) {
    logger.error('Failed to resolve organization subscription for invite policy', {
      organizationId,
      error,
    })
    return 'free'
  }
}

/**
 * Resolve the invite-governing plan category for a single billed account
 * user. Exposed so bulk callers can batch by unique user id. Returns
 * `'free'` when there is no usable paid subscription.
 */
export async function getInvitePlanCategoryForUser(userId: string): Promise<PlanCategory> {
  try {
    const sub = await getHighestPrioritySubscription(userId)
    if (!sub || !hasUsableSubscriptionStatus(sub.status)) return 'free'
    return getPlanType(sub.plan)
  } catch (error) {
    logger.error('Failed to resolve subscription for invite policy', { userId, error })
    return 'free'
  }
}

export async function getWorkspaceCreationPolicy({
  userId,
  activeOrganizationId,
  pinOrganization = false,
}: GetWorkspaceCreationPolicyParams): Promise<WorkspaceCreationPolicy> {
  const membership = await getUserOrganization(userId)
  const organizationId = pinOrganization
    ? (activeOrganizationId ?? null)
    : (activeOrganizationId ?? membership?.organizationId ?? null)
  const orgRole =
    organizationId == null
      ? undefined
      : membership?.organizationId === organizationId
        ? membership.role
        : (
            await db
              .select({ role: member.role })
              .from(member)
              .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
              .limit(1)
          )[0]?.role

  if (activeOrganizationId && !orgRole) {
    const billedAccountUserId = await requireOrganizationOwnerId(activeOrganizationId)

    return {
      canCreate: false,
      workspaceMode: WORKSPACE_MODE.ORGANIZATION,
      organizationId: activeOrganizationId,
      billedAccountUserId,
      maxWorkspaces: null,
      currentWorkspaceCount: 0,
      reason: 'Only organization owners and admins can create organization workspaces.',
      status: 403,
    }
  }

  if (!isBillingEnabled) {
    if (organizationId && orgRole) {
      const billedAccountUserId = await requireOrganizationOwnerId(organizationId)

      if (!isOrgAdminRole(orgRole)) {
        return {
          canCreate: false,
          workspaceMode: WORKSPACE_MODE.ORGANIZATION,
          organizationId,
          billedAccountUserId,
          maxWorkspaces: null,
          currentWorkspaceCount: 0,
          reason: 'Only organization owners and admins can create organization workspaces.',
          status: 403,
        }
      }

      return {
        canCreate: true,
        workspaceMode: WORKSPACE_MODE.ORGANIZATION,
        organizationId,
        billedAccountUserId,
        maxWorkspaces: null,
        currentWorkspaceCount: 0,
        reason: null,
        status: 200,
      }
    }

    const currentWorkspaceCount = await countNonOrganizationOwnedWorkspaces(userId)

    return {
      canCreate: true,
      workspaceMode: WORKSPACE_MODE.PERSONAL,
      organizationId: null,
      billedAccountUserId: userId,
      maxWorkspaces: null,
      currentWorkspaceCount,
      reason: null,
      status: 200,
    }
  }

  if (organizationId && orgRole) {
    const organizationSubscription = await getOrganizationSubscription(organizationId)

    if (
      organizationSubscription &&
      hasUsableSubscriptionStatus(organizationSubscription.status) &&
      (isTeam(organizationSubscription.plan) || isEnterprise(organizationSubscription.plan))
    ) {
      const billedAccountUserId = await requireOrganizationOwnerId(organizationId)

      if (!isOrgAdminRole(orgRole)) {
        return {
          canCreate: false,
          workspaceMode: WORKSPACE_MODE.ORGANIZATION,
          organizationId,
          billedAccountUserId,
          maxWorkspaces: null,
          currentWorkspaceCount: 0,
          reason: 'Only organization owners and admins can create organization workspaces.',
          status: 403,
        }
      }

      return {
        canCreate: true,
        workspaceMode: WORKSPACE_MODE.ORGANIZATION,
        organizationId,
        billedAccountUserId,
        maxWorkspaces: null,
        currentWorkspaceCount: 0,
        reason: null,
        status: 200,
      }
    }
  }

  const highestPrioritySubscription = await getHighestPrioritySubscription(userId)
  const plan = highestPrioritySubscription?.plan
  const maxWorkspaces = isMax(plan) ? 10 : isPro(plan) ? 3 : 1
  const currentWorkspaceCount = await countNonOrganizationOwnedWorkspaces(userId)

  if (currentWorkspaceCount >= maxWorkspaces) {
    return {
      canCreate: false,
      workspaceMode: WORKSPACE_MODE.PERSONAL,
      organizationId: null,
      billedAccountUserId: userId,
      maxWorkspaces,
      currentWorkspaceCount,
      reason: `This plan supports up to ${maxWorkspaces} personal workspace${maxWorkspaces === 1 ? '' : 's'}.`,
      status: 403,
    }
  }

  return {
    canCreate: true,
    workspaceMode: WORKSPACE_MODE.PERSONAL,
    organizationId: null,
    billedAccountUserId: userId,
    maxWorkspaces,
    currentWorkspaceCount,
    reason: null,
    status: 200,
  }
}

async function countNonOrganizationOwnedWorkspaces(userId: string): Promise<number> {
  const [result] = await db
    .select({ value: count() })
    .from(workspace)
    .where(and(eq(workspace.ownerId, userId), isNull(workspace.organizationId)))

  return result?.value ?? 0
}

/**
 * Returns the userId of the organization owner, or `null` if the
 * organization has no owner row. Unexpected DB errors propagate to the
 * caller so data-integrity issues surface loudly rather than being
 * silently fallen back to the caller's identity.
 */
export async function getOrganizationOwnerId(organizationId: string): Promise<string | null> {
  const [ownerMembership] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.role, 'owner')))
    .limit(1)

  return ownerMembership?.userId ?? null
}

/**
 * Like `getOrganizationOwnerId` but throws when no owner row exists.
 * Use when the caller needs a guaranteed billed-account userId — every
 * Better Auth organization is expected to have exactly one owner, so a
 * missing owner is a data-integrity issue that should surface loudly.
 */
async function requireOrganizationOwnerId(organizationId: string): Promise<string> {
  const ownerId = await getOrganizationOwnerId(organizationId)
  if (!ownerId) {
    logger.error('Organization is missing its owner membership row', { organizationId })
    throw new Error(`Organization ${organizationId} has no owner membership`)
  }
  return ownerId
}
