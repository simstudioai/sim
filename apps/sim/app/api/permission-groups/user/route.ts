import { db } from '@sim/db'
import { permissionGroup, permissionGroupMember } from '@sim/db/schema'
import { and, asc, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { userPermissionConfigQuerySchema } from '@/lib/api/contracts/permission-groups'
import { getSession } from '@/lib/auth'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { parsePermissionGroupConfig } from '@/lib/permission-groups/types'
import {
  checkWorkspaceAccess,
  isOrganizationAdminOrOwner,
} from '@/lib/workspaces/permissions/utils'

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

  const [explicit] = await db
    .select({
      permissionGroupId: permissionGroupMember.permissionGroupId,
      config: permissionGroup.config,
      groupName: permissionGroup.name,
    })
    .from(permissionGroupMember)
    .innerJoin(permissionGroup, eq(permissionGroupMember.permissionGroupId, permissionGroup.id))
    .where(
      and(
        eq(permissionGroupMember.userId, session.user.id),
        eq(permissionGroup.organizationId, organizationId)
      )
    )
    .orderBy(asc(permissionGroup.createdAt), asc(permissionGroup.id))
    .limit(1)

  let resolved = explicit
  if (!resolved) {
    const [defaultGroup] = await db
      .select({
        permissionGroupId: permissionGroup.id,
        config: permissionGroup.config,
        groupName: permissionGroup.name,
      })
      .from(permissionGroup)
      .where(
        and(eq(permissionGroup.organizationId, organizationId), eq(permissionGroup.isDefault, true))
      )
      .limit(1)
    resolved = defaultGroup
  }

  if (!resolved) {
    return NextResponse.json({
      permissionGroupId: null,
      groupName: null,
      config: null,
      entitled: true,
      organizationId,
      isOrgAdmin,
    })
  }

  return NextResponse.json({
    permissionGroupId: resolved.permissionGroupId,
    groupName: resolved.groupName,
    config: parsePermissionGroupConfig(resolved.config),
    entitled: true,
    organizationId,
    isOrgAdmin,
  })
})
