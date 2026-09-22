import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import { acquireUserBillingIdentityLock } from '@/lib/billing/organizations/billing-identity-lock'
import { acquireOrganizationMutationLock } from '@/lib/billing/organizations/membership'
import { isEnterprise, isTeam } from '@/lib/billing/plan-helpers'
import { hasUsableSubscriptionStatus } from '@/lib/billing/subscriptions/utils'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx } from '@/lib/db/types'
import {
  type InvitationWithGrants,
  requireInvitationResendAuthority,
  resolveInvitationAdmissionOrganizationId,
} from '@/lib/invitations/core'
import { WorkspaceInvitationError } from '@/lib/invitations/workspace-invitations'
import { acquirePermissionGroupOrgLock } from '@/lib/permission-groups/locks'
import { getWorkspaceWithOwner, type WorkspaceWithOwner } from '@/lib/workspaces/permissions/utils'
import { getWorkspaceInvitePolicy, WORKSPACE_MODE } from '@/lib/workspaces/policy'
import { validateInvitationsAllowed } from '@/ee/access-control/utils/permission-check'

/**
 * Revalidates resend policy on the mutation connection. Invitation/workspace locks
 * precede organization and billing-identity locks; permission-group locks are leaves.
 */
export async function lockInvitationResendPolicy(
  tx: DbOrTx,
  invitation: InvitationWithGrants,
  actorUserId: string,
  assertedOrganizationId?: string
): Promise<void> {
  const workspaces: WorkspaceWithOwner[] = []
  for (const grant of invitation.grants) {
    const workspace = await getWorkspaceWithOwner(grant.workspaceId, { executor: tx })
    if (!workspace)
      throw new OrchestrationError(
        'conflict',
        'Invitation references a workspace that no longer exists'
      )
    workspaces.push(workspace)
  }
  const organizationIds = [
    ...new Set([
      ...(invitation.organizationId ? [invitation.organizationId] : []),
      ...workspaces.flatMap((workspace) =>
        workspace.organizationId ? [workspace.organizationId] : []
      ),
    ]),
  ].sort()
  for (const organizationId of organizationIds)
    await acquireOrganizationMutationLock(tx, organizationId)
  const billedUserIds = [
    ...new Set(
      workspaces
        .filter((workspace) => workspace.workspaceMode !== WORKSPACE_MODE.ORGANIZATION)
        .map((workspace) => workspace.billedAccountUserId)
    ),
  ].sort()
  for (const userId of billedUserIds) await acquireUserBillingIdentityLock(tx, userId)
  await requireInvitationResendAuthority(tx, invitation, actorUserId, assertedOrganizationId)
  for (const organizationId of organizationIds)
    await acquirePermissionGroupOrgLock(tx, organizationId)

  /** permission-group-enforced: invitations.send — fresh transaction reads bypass request-scoped config caches. */
  const admissionOrganizationId = await resolveInvitationAdmissionOrganizationId(invitation, tx)
  if (admissionOrganizationId)
    await validateInvitationsAllowed(actorUserId, { organizationId: admissionOrganizationId }, tx)
  for (const workspace of workspaces) {
    await validateInvitationsAllowed(actorUserId, { workspaceId: workspace.id }, tx)
    const policy = await getWorkspaceInvitePolicy(workspace, tx)
    if (!policy.allowed)
      throw new WorkspaceInvitationError({
        status: 403,
        message: policy.reason ?? 'Invites are no longer allowed on this workspace',
        upgradeRequired: policy.upgradeRequired,
      })
  }
  if (
    isBillingEnabled &&
    invitation.kind === 'organization' &&
    !workspaces.length &&
    invitation.organizationId
  ) {
    const subscription = await getOrganizationSubscription(invitation.organizationId, {
      executor: tx,
      onError: 'throw',
    })
    if (
      !subscription ||
      !hasUsableSubscriptionStatus(subscription.status) ||
      (!isTeam(subscription.plan) && !isEnterprise(subscription.plan))
    )
      throw new WorkspaceInvitationError({
        status: 403,
        message: 'Invites are no longer allowed on this organization',
        upgradeRequired: true,
      })
  }
}
