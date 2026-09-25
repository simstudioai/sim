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
import { listRecentWorkspaceIds, sortByVisitRecency } from '@/lib/workspaces/visits'

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
  /** Most recently visited first, then newest first. */
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
 * workspaces with role/invite flags in visit order, the viewer's last active
 * workspace id, pins, and the workspace creation policy.
 *
 * Unlike the route, this performs no writes — no default-workspace creation and
 * no orphaned-workflow repair. Sidebar prefetch leaves empty lists uncached so
 * the client can still reach the route's default-workspace creation path.
 */
export async function listWorkspacesForViewer(params: {
  userId: string
  activeOrganizationId: string | null
  scope?: WorkspaceScope
}): Promise<WorkspaceListPayload> {
  const { userId, activeOrganizationId, scope = 'active' } = params

  /** Workspace pins ride along here; see `pinnedResourceTypeSchema` for why. */
  const [creationPolicy, accessibleWorkspaces, userSettings, workspacePins, recentIds] =
    await Promise.all([
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
      listRecentWorkspaceIds(userId),
    ])
  const workspaces = sortByVisitRecency(accessibleWorkspaces, recentIds)
  const [mostRecent] = workspaces
  const lastVisitedId = mostRecent && recentIds.includes(mostRecent.id) ? mostRecent.id : null

  return {
    workspaces,
    /** Visits supersede the settings column, which only predates them. */
    lastActiveWorkspaceId: lastVisitedId ?? userSettings[0]?.lastActiveWorkspaceId ?? null,
    pinnedWorkspaceIds: workspacePins.map((row) => row.resourceId),
    creationPolicy,
  }
}
