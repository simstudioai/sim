import { db } from '@sim/db'
import { permissionGroup, permissionGroupMember } from '@sim/db/schema'
import { and, asc, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { isWorkspaceOnEnterprisePlan } from '@/lib/billing'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { parsePermissionGroupConfig } from '@/lib/permission-groups/types'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

export const GET = withRouteHandler(async (req: Request) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const workspaceId = searchParams.get('workspaceId')

  if (!workspaceId) {
    return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
  }

  const access = await checkWorkspaceAccess(workspaceId, session.user.id)
  if (!access.exists) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }
  if (!access.hasAccess) {
    return NextResponse.json({ error: 'Not a member of this workspace' }, { status: 403 })
  }

  const isEnterprise = await isWorkspaceOnEnterprisePlan(workspaceId)
  if (!isEnterprise) {
    return NextResponse.json({
      permissionGroupId: null,
      groupName: null,
      config: null,
      entitled: false,
    })
  }

  const [groupMembership] = await db
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
        eq(permissionGroup.workspaceId, workspaceId)
      )
    )
    .orderBy(asc(permissionGroup.createdAt), asc(permissionGroup.id))
    .limit(1)

  if (!groupMembership) {
    return NextResponse.json({
      permissionGroupId: null,
      groupName: null,
      config: null,
      entitled: true,
    })
  }

  return NextResponse.json({
    permissionGroupId: groupMembership.permissionGroupId,
    groupName: groupMembership.groupName,
    config: parsePermissionGroupConfig(groupMembership.config),
    entitled: true,
  })
})
