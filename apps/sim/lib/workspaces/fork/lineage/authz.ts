import { isOrganizationOnEnterprisePlan } from '@/lib/billing/core/subscription'
import { isBillingEnabled, isForkingEnabled } from '@/lib/core/config/env-flags'
import { HttpError } from '@/lib/core/utils/http-error'
import { type ForkEdge, resolveForkEdge } from '@/lib/workspaces/fork/lineage/lineage'
import { checkWorkspaceAccess, type WorkspaceWithOwner } from '@/lib/workspaces/permissions/utils'
import { getWorkspaceCreationPolicy, type WorkspaceCreationPolicy } from '@/lib/workspaces/policy'

/** Direction of a promote, relative to the workspace the caller is acting from. */
export type PromoteDirection = 'push' | 'pull'

/**
 * Enterprise-only gate shared by every fork/promote route. On Sim Cloud the gate
 * is the Enterprise plan; on self-hosted it's `FORKING_ENABLED`, which 404s when
 * unset so a newer image doesn't silently expose forking. Mirrors the data-drains
 * gate - this repo gates EE features by plan + env flag, not by directory.
 */
async function assertForkingEnabled(organizationId: string | null): Promise<void> {
  if (!isBillingEnabled && !isForkingEnabled) {
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
): Promise<{
  workspace: WorkspaceWithOwner
  hasAccess: boolean
  canWrite: boolean
  canAdmin: boolean
}> {
  const access = await checkWorkspaceAccess(workspaceId, userId)
  if (!access.exists || !access.workspace) {
    throw new ForkError('Workspace not found', 404)
  }
  await assertForkingEnabled(access.workspace.organizationId)
  return {
    workspace: access.workspace,
    hasAccess: access.hasAccess,
    canWrite: access.canWrite,
    canAdmin: access.canAdmin,
  }
}

/** Require at least read access; returns the (active) workspace. */
export async function assertWorkspaceReadAccess(
  workspaceId: string,
  userId: string
): Promise<WorkspaceWithOwner> {
  const { workspace, hasAccess } = await requireWorkspace(workspaceId, userId)
  if (!hasAccess) {
    throw new ForkError('You do not have access to this workspace', 403)
  }
  return workspace
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
 * Authorize forking `sourceWorkspaceId`: the caller needs read access to the
 * source and must pass the workspace-creation policy for the parent's org (the
 * child inherits the parent's org/mode; plan caps apply).
 */
export async function assertCanFork(
  sourceWorkspaceId: string,
  userId: string
): Promise<ForkAuthorization> {
  const source = await assertWorkspaceReadAccess(sourceWorkspaceId, userId)
  const policy = await getWorkspaceCreationPolicy({
    userId,
    activeOrganizationId: source.organizationId,
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
 * `otherWorkspaceId`. Requires read on the source and admin on the target (a
 * force replace is destructive). `push` sends current -> other; `pull` brings
 * other -> current.
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
  const source = await assertWorkspaceReadAccess(sourceWorkspaceId, userId)
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
