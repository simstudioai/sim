import { db } from '@sim/db'
import { pinnedItem, settings, type workspace as workspaceTable } from '@sim/db/schema'
import type { PermissionType } from '@sim/platform-authz/workspace'
import { and, eq } from 'drizzle-orm'
import type { PlanCategory } from '@/lib/billing/plan-helpers'
import {
  evaluateWorkspaceInvitePolicy,
  getInvitePlanCategoryForOrganization,
  getInvitePlanCategoryForUser,
  getWorkspaceCreationPolicy,
  resolveInviteFlags,
  WORKSPACE_MODE,
  type WorkspaceCreationPolicy,
  type WorkspaceInviteFlags,
} from '@/lib/workspaces/policy'
import { listAccessibleWorkspaceRowsForUser, type WorkspaceScope } from '@/lib/workspaces/utils'

type WorkspaceRow = typeof workspaceTable.$inferSelect

/** Accessible workspace row decorated with the viewer's role and invite policy flags. */
export type WorkspaceWithInviteFlags = WorkspaceRow &
  WorkspaceInviteFlags & {
    role: 'owner' | 'admin' | 'member'
    permissions: PermissionType
    /**
     * The viewer's admin access to this workspace derives from their
     * organization role. `role: 'admin'` alone cannot say so — an explicit
     * workspace admin looks identical — and the two differ in what the viewer
     * can do: derived access has no permission row to give up, so leaving is
     * refused by `DELETE /api/workspaces/members/[id]`.
     */
    isOrgAdmin: boolean
  }

/** The GET /api/workspaces payload assembled by {@link listWorkspacesForViewer}. */
export interface WorkspaceListPayload {
  workspaces: WorkspaceWithInviteFlags[]
  lastActiveWorkspaceId: string | null
  /** Workspace ids the viewer pinned to the top of the switcher. */
  pinnedWorkspaceIds: string[]
  creationPolicy: WorkspaceCreationPolicy
}

/**
 * Decorates accessible workspace rows with the viewer's role and per-workspace
 * invite policy flags (resolving each workspace's billed plan category once per
 * billed user / organization).
 */
async function buildWorkspacesWithInviteFlags(
  userWorkspaces: Array<{
    workspace: WorkspaceRow
    permissionType: PermissionType
    viaOrgAdmin: boolean
  }>,
  userId: string
): Promise<WorkspaceWithInviteFlags[]> {
  const nonOrgBilledUserIds = [
    ...new Set(
      userWorkspaces
        .filter(({ workspace: ws }) => ws.workspaceMode !== WORKSPACE_MODE.ORGANIZATION)
        .map(({ workspace: ws }) => ws.billedAccountUserId)
    ),
  ]
  const orgIds = [
    ...new Set(
      userWorkspaces
        .filter(
          ({ workspace: ws }) =>
            ws.workspaceMode === WORKSPACE_MODE.ORGANIZATION && ws.organizationId
        )
        .map(({ workspace: ws }) => ws.organizationId as string)
    ),
  ]
  const planCategoryByBilledUser = new Map<string, PlanCategory>()
  const planCategoryByOrg = new Map<string, PlanCategory>()
  await Promise.all([
    ...nonOrgBilledUserIds.map(async (billedUserId) => {
      planCategoryByBilledUser.set(billedUserId, await getInvitePlanCategoryForUser(billedUserId))
    }),
    ...orgIds.map(async (orgId) => {
      planCategoryByOrg.set(orgId, await getInvitePlanCategoryForOrganization(orgId))
    }),
  ])

  return userWorkspaces.map(({ workspace: workspaceDetails, permissionType, viaOrgAdmin }) => {
    const billedPlanCategory: PlanCategory =
      workspaceDetails.workspaceMode === WORKSPACE_MODE.ORGANIZATION
        ? workspaceDetails.organizationId
          ? (planCategoryByOrg.get(workspaceDetails.organizationId) ?? 'free')
          : 'free'
        : (planCategoryByBilledUser.get(workspaceDetails.billedAccountUserId) ?? 'free')
    const invitePolicy = evaluateWorkspaceInvitePolicy(workspaceDetails, { billedPlanCategory })

    return {
      ...workspaceDetails,
      role:
        workspaceDetails.ownerId === userId
          ? ('owner' as const)
          : permissionType === 'admin'
            ? ('admin' as const)
            : ('member' as const),
      permissions: permissionType,
      isOrgAdmin: viaOrgAdmin,
      ...resolveInviteFlags(invitePolicy, workspaceDetails.billedAccountUserId === userId),
    }
  })
}

/**
 * Read-only assembly of the GET /api/workspaces payload for a viewer: accessible
 * workspaces with role/invite flags, the viewer's last active workspace id, and
 * the workspace creation policy.
 *
 * Unlike the route, this performs no writes — no default-workspace creation and
 * no orphaned-workflow repair. It exists for the workspace layout's sidebar
 * prefetch, which only runs after host-context authorization has proven the
 * viewer already has at least one accessible workspace.
 */
export async function listWorkspacesForViewer(params: {
  userId: string
  activeOrganizationId: string | null
  scope?: WorkspaceScope
}): Promise<WorkspaceListPayload> {
  const { userId, activeOrganizationId, scope = 'active' } = params

  /** Workspace pins ride along here; see `pinnedResourceTypeSchema` for why. */
  const [creationPolicy, workspaces, userSettings, workspacePins] = await Promise.all([
    getWorkspaceCreationPolicy({ userId, activeOrganizationId }),
    listAccessibleWorkspaceRowsForUser(userId, scope).then((rows) =>
      buildWorkspacesWithInviteFlags(rows, userId)
    ),
    db
      .select({ lastActiveWorkspaceId: settings.lastActiveWorkspaceId })
      .from(settings)
      .where(eq(settings.userId, userId))
      .limit(1),
    db
      .select({ resourceId: pinnedItem.resourceId })
      .from(pinnedItem)
      .where(and(eq(pinnedItem.userId, userId), eq(pinnedItem.resourceType, 'workspace'))),
  ])

  return {
    workspaces,
    lastActiveWorkspaceId: userSettings[0]?.lastActiveWorkspaceId ?? null,
    pinnedWorkspaceIds: workspacePins.map((row) => row.resourceId),
    creationPolicy,
  }
}
