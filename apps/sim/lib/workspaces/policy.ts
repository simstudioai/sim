import { db } from '@sim/db'
import { member, type WorkspaceMode, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, count, eq, isNull } from 'drizzle-orm'
import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import { getHighestPrioritySubscription } from '@/lib/billing/core/plan'
import { getUserOrganization } from '@/lib/billing/organizations/membership'
import { isEnterprise, isPro, isTeam } from '@/lib/billing/plan-helpers'
import { hasUsableSubscriptionStatus } from '@/lib/billing/subscriptions/utils'
import { isBillingEnabled } from '@/lib/core/config/feature-flags'

const logger = createLogger('WorkspacePolicy')

export const WORKSPACE_MODE = {
  PERSONAL: 'personal',
  ORGANIZATION: 'organization',
  GRANDFATHERED_SHARED: 'grandfathered_shared',
} as const satisfies Record<string, WorkspaceMode>

interface WorkspaceOwnershipState {
  organizationId?: string | null
  workspaceMode?: WorkspaceMode | null
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

export function isOrganizationWorkspace(workspaceState: WorkspaceOwnershipState): boolean {
  return (
    workspaceState.workspaceMode === WORKSPACE_MODE.ORGANIZATION &&
    typeof workspaceState.organizationId === 'string' &&
    workspaceState.organizationId.length > 0
  )
}

export function canWorkspaceInviteMembers(workspaceState: WorkspaceOwnershipState): boolean {
  return workspaceState.workspaceMode !== WORKSPACE_MODE.PERSONAL
}

export function getWorkspaceInviteDisabledReason(
  workspaceState: WorkspaceOwnershipState
): string | null {
  if (canWorkspaceInviteMembers(workspaceState)) {
    return null
  }

  return 'Member invites are only available for organization-owned or grandfathered shared workspaces.'
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
      const billedAccountUserId = (await getOrganizationOwnerId(organizationId)) ?? userId

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
      if (!['owner', 'admin'].includes(orgRole)) {
        const billedAccountUserId = (await getOrganizationOwnerId(organizationId)) ?? userId

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

      const billedAccountUserId = (await getOrganizationOwnerId(organizationId)) ?? userId

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
  const maxWorkspaces = isPro(highestPrioritySubscription?.plan) ? 3 : 1
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

async function getOrganizationOwnerId(organizationId: string): Promise<string | null> {
  try {
    const [ownerMembership] = await db
      .select({ userId: member.userId })
      .from(member)
      .where(and(eq(member.organizationId, organizationId), eq(member.role, 'owner')))
      .limit(1)

    return ownerMembership?.userId ?? null
  } catch (error) {
    logger.error('Failed to resolve organization owner for workspace policy', {
      organizationId,
      error,
    })
    return null
  }
}
