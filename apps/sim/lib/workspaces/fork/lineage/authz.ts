import { isOrganizationOnEnterprisePlan } from '@/lib/billing/core/subscription'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { HttpError } from '@/lib/core/utils/http-error'
import { type ForkEdge, resolveForkEdge } from '@/lib/workspaces/fork/lineage/lineage'
import { checkWorkspaceAccess, type WorkspaceWithOwner } from '@/lib/workspaces/permissions/utils'
import { getWorkspaceCreationPolicy, type WorkspaceCreationPolicy } from '@/lib/workspaces/policy'

/** Direction of a promote, relative to the workspace the caller is acting from. */
export type PromoteDirection = 'push' | 'pull'

/**
 * Gate shared by every fork/promote route. A runtime `workspace-forking` flag is the
 * master rollout switch: on Sim Cloud it's resolved from AppConfig with org/user
 * context (dark-launchable to specific orgs/users/admins), and off-AppConfig it falls
 * back to `FORKING_ENABLED`, leaving self-hosted behaviour unchanged. An off/absent
 * flag 404s so a newer image never silently exposes forking. On Sim Cloud the
 * Enterprise-plan entitlement still applies on top of the flag. Mirrors the
 * data-drains gate - this repo gates EE features by plan + flag, not by directory.
 */
async function assertForkingEnabled(organizationId: string | null, userId: string): Promise<void> {
  const flagEnabled = await isFeatureEnabled('workspace-forking', {
    userId,
    orgId: organizationId,
  })
  if (!flagEnabled) {
    throw new ForkError('Workspace forking is not enabled on this deployment', 404)
  }
  if (isBillingEnabled) {
    const hasEnterprise = organizationId
      ? await isOrganizationOnEnterprisePlan(organizationId)
      : false
    if (!hasEnterprise) {
      throw new ForkError('Workspace forking is available on Enterprise plans only', 403)
    }
  }
}

/**
 * Domain error for fork/promote operations. Carries a concrete `statusCode` so
 * `withRouteHandler` maps it to the right HTTP status and forwards the
 * client-safe `message`.
 */
export class ForkError extends HttpError {
  readonly statusCode: number

  constructor(message: string, statusCode = 400) {
    super(message)
    this.name = 'ForkError'
    this.statusCode = statusCode
  }
}

async function requireWorkspace(
  workspaceId: string,
  userId: string
): Promise<{ workspace: WorkspaceWithOwner; canAdmin: boolean }> {
  const access = await checkWorkspaceAccess(workspaceId, userId)
  if (!access.exists || !access.workspace) {
    throw new ForkError('Workspace not found', 404)
  }
  await assertForkingEnabled(access.workspace.organizationId, userId)
  return { workspace: access.workspace, canAdmin: access.canAdmin }
}

/** Require admin access; returns the (active) workspace. */
export async function assertWorkspaceAdminAccess(
  workspaceId: string,
  userId: string
): Promise<WorkspaceWithOwner> {
  const { workspace, canAdmin } = await requireWorkspace(workspaceId, userId)
  if (!canAdmin) {
    throw new ForkError('Admin access is required for this workspace', 403)
  }
  return workspace
}

export interface ForkAuthorization {
  source: WorkspaceWithOwner
  policy: WorkspaceCreationPolicy
}

/**
 * Authorize forking `sourceWorkspaceId`: the caller needs admin access to the
 * source (a fork copies its deployed workflows and resources en masse) and must
 * pass the workspace-creation policy for the parent's org (the child inherits the
 * parent's org/mode; plan caps apply). Org owners/admins derive workspace admin.
 *
 * `pinOrganization` makes the child ALWAYS land in the source's org - including a
 * personal source (org `null`) - rather than the acting user's membership org,
 * which the policy would otherwise fall back to when the source is personal.
 */
export async function assertCanFork(
  sourceWorkspaceId: string,
  userId: string
): Promise<ForkAuthorization> {
  const source = await assertWorkspaceAdminAccess(sourceWorkspaceId, userId)
  const policy = await getWorkspaceCreationPolicy({
    userId,
    activeOrganizationId: source.organizationId,
    pinOrganization: true,
  })
  if (!policy.canCreate) {
    throw new ForkError(
      policy.reason ?? 'You cannot create another workspace on your current plan',
      policy.status >= 400 ? policy.status : 403
    )
  }
  return { source, policy }
}

export interface PromoteAuthorization {
  edge: ForkEdge
  source: WorkspaceWithOwner
  target: WorkspaceWithOwner
  sourceWorkspaceId: string
  targetWorkspaceId: string
}

/**
 * Authorize a promote along the strict edge between `currentWorkspaceId` and
 * `otherWorkspaceId`. Requires admin on BOTH the source and the target: a sync
 * reads the source's deployed workflows/resources and force-replaces the target's,
 * and the sync surface is only ever offered to workspace admins. `push` sends
 * current -> other; `pull` brings other -> current.
 */
export async function assertCanPromote(
  currentWorkspaceId: string,
  otherWorkspaceId: string,
  direction: PromoteDirection,
  userId: string
): Promise<PromoteAuthorization> {
  const edge = await resolveForkEdge(currentWorkspaceId, otherWorkspaceId)
  if (!edge) {
    throw new ForkError('These workspaces are not a direct fork edge', 400)
  }
  const sourceWorkspaceId = direction === 'push' ? currentWorkspaceId : otherWorkspaceId
  const targetWorkspaceId = direction === 'push' ? otherWorkspaceId : currentWorkspaceId
  const source = await assertWorkspaceAdminAccess(sourceWorkspaceId, userId)
  const target = await assertWorkspaceAdminAccess(targetWorkspaceId, userId)
  return { edge, source, target, sourceWorkspaceId, targetWorkspaceId }
}

/** Authorize rolling back the last promote into `targetWorkspaceId` (admin only). */
export async function assertCanRollback(
  targetWorkspaceId: string,
  userId: string
): Promise<WorkspaceWithOwner> {
  return assertWorkspaceAdminAccess(targetWorkspaceId, userId)
}
