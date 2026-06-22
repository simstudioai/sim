import { NextResponse } from 'next/server'
import { userPermissionConfigQuerySchema } from '@/lib/api/contracts/permission-groups'
import { getSession } from '@/lib/auth'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  checkWorkspaceAccess,
  isOrganizationAdminOrOwner,
} from '@/lib/workspaces/permissions/utils'
import { resolveWorkspaceGroup } from '@/ee/access-control/utils/permission-check'

export const GET = withRouteHandler(async (req: Request) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const queryResult = userPermissionConfigQuerySchema.safeParse(
    Object.fromEntries(new URL(req.url).searchParams.entries())
  )
  if (!queryResult.success) {
    return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
  }
  const { workspaceId } = queryResult.data

  const access = await checkWorkspaceAccess(workspaceId, session.user.id)
  if (!access.exists) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }
  if (!access.hasAccess) {
    return NextResponse.json({ error: 'Not a member of this workspace' }, { status: 403 })
  }

  const organizationId = access.workspace?.organizationId ?? null

  // Workspaces without an organization have no permission groups, and the caller
  // can never be an org admin in that case.
  if (!organizationId) {
    return NextResponse.json({
      permissionGroupId: null,
      groupName: null,
      config: null,
      entitled: false,
      organizationId: null,
      isOrgAdmin: false,
    })
  }

  // Resolve role + entitlement against the WORKSPACE's owning organization (not
  // the caller's active org) so management gating is scoped to the org that
  // actually governs this workspace. External members are not org admins here.
  const isOrgAdmin = await isOrganizationAdminOrOwner(session.user.id, organizationId)

  if (!(await isOrganizationOnEnterprisePlan(organizationId))) {
    return NextResponse.json({
      permissionGroupId: null,
      groupName: null,
      config: null,
      entitled: false,
      organizationId,
      isOrgAdmin,
    })
  }

  // Single source of truth: specific-scope group covering this workspace ->
  // the user's all-workspaces group -> org default -> none.
  const resolved = await resolveWorkspaceGroup(session.user.id, organizationId, workspaceId)

  return NextResponse.json({
    permissionGroupId: resolved?.permissionGroupId ?? null,
    groupName: resolved?.groupName ?? null,
    config: resolved?.config ?? null,
    entitled: true,
    organizationId,
    isOrgAdmin,
  })
})
