import { db } from '@sim/db'
import { member, type WorkspaceMode, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, count, eq, isNull } from 'drizzle-orm'
import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import { getHighestPrioritySubscription } from '@/lib/billing/core/plan'
import { getUserOrganization } from '@/lib/billing/organizations/membership'
import { isEnterprise, isMax, isPro, isTeam } from '@/lib/billing/plan-helpers'
import { hasUsableSubscriptionStatus } from '@/lib/billing/subscriptions/utils'
import { isBillingEnabled } from '@/lib/core/config/feature-flags'
import { UPGRADE_TO_INVITE_REASON } from '@/lib/workspaces/policy-constants'

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
 * - `personal`: never allowed; tooltip routes the user to upgrade.
 * - `organization`: allowed for workspaces that belong to an active
 *   Team/Enterprise org; seat-gated at the API layer.
 * - `grandfathered_shared`: allowed only when the workspace's billed
 *   account user has an active Team/Enterprise subscription. Otherwise
 *   blocked with the same upgrade tooltip as `personal` so the UX is
 *   uniform across plans.
 *
 * Billing-disabled deployments always allow invites.
 *
 * Existing members on a grandfathered workspace keep their access —
 * this policy only governs *new* invitations.
 */
export async function getWorkspaceInvitePolicy(
  workspaceState: WorkspaceOwnershipState
): Promise<WorkspaceInvitePolicy> {
  const requiresSubscriptionLookup =
    isBillingEnabled && workspaceState.workspaceMode === WORKSPACE_MODE.GRANDFATHERED_SHARED
  const billedUserHasTeamOrEnterprise = requiresSubscriptionLookup
    ? await hasActiveTeamOrEnterpriseSubscription(workspaceState.billedAccountUserId)
    : false
  return evaluateWorkspaceInvitePolicy(workspaceState, { billedUserHasTeamOrEnterprise })
}

/**
 * Pure evaluator — given precomputed subscription context, returns the
 * policy synchronously. Exposed so bulk callers (e.g. listing every
 * workspace a user can see) can batch the subscription lookups by
 * unique billed account user rather than re-querying per workspace.
 */
export function evaluateWorkspaceInvitePolicy(
  workspaceState: WorkspaceOwnershipState,
  context: { billedUserHasTeamOrEnterprise: boolean }
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
    if (workspaceState.organizationId === null) {
      return {
        allowed: false,
        reason: UPGRADE_TO_INVITE_REASON,
        requiresSeat: false,
        organizationId: null,
        upgradeRequired: true,
      }
    }

    return {
      allowed: true,
      reason: null,
      requiresSeat: true,
      organizationId: workspaceState.organizationId,
      upgradeRequired: false,
    }
  }

  if (workspaceState.workspaceMode === WORKSPACE_MODE.GRANDFATHERED_SHARED) {
    return {
      allowed: context.billedUserHasTeamOrEnterprise,
      reason: context.billedUserHasTeamOrEnterprise ? null : UPGRADE_TO_INVITE_REASON,
      requiresSeat: false,
      organizationId: null,
      upgradeRequired: !context.billedUserHasTeamOrEnterprise,
    }
  }

  return {
    allowed: false,
    reason: UPGRADE_TO_INVITE_REASON,
    requiresSeat: false,
    organizationId: null,
    upgradeRequired: true,
  }
}

export async function hasActiveTeamOrEnterpriseSubscription(userId: string): Promise<boolean> {
  try {
    const sub = await getHighestPrioritySubscription(userId)
    if (!sub) return false
    if (!hasUsableSubscriptionStatus(sub.status)) return false
    return isTeam(sub.plan) || isEnterprise(sub.plan)
  } catch (error) {
    logger.error('Failed to resolve subscription for invite policy', { userId, error })
    return false
  }
}

export async function getWorkspaceCreationPolicy({
  userId,
  activeOrganizationId,
}: GetWorkspaceCreationPolicyParams): Promise<WorkspaceCreationPolicy> {
  const membership = await getUserOrganization(userId)
  const organizationId = activeOrganizationId ?? membership?.organizationId ?? null
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

  if (!isBillingEnabled) {
    if (organizationId && orgRole) {
      const billedAccountUserId = await requireOrganizationOwnerId(organizationId)

      if (!['owner', 'admin'].includes(orgRole)) {
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

      if (!['owner', 'admin'].includes(orgRole)) {
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

export async function countNonOrganizationOwnedWorkspaces(userId: string): Promise<number> {
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
