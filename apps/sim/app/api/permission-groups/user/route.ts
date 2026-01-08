import { db } from '@sim/db'
import { member, permissionGroup, permissionGroupMember } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing'
import { parsePermissionGroupConfig } from '@/lib/permission-groups/types'

export async function GET(req: Request) {
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const organizationId = searchParams.get('organizationId')

  if (!organizationId) {
    return NextResponse.json({ error: 'organizationId is required' }, { status: 400 })
  }

  const [membership] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, session.user.id), eq(member.organizationId, organizationId)))
    .limit(1)

  if (!membership) {
    return NextResponse.json({ error: 'Not a member of this organization' }, { status: 403 })
  }

  // Short-circuit: if org is not on enterprise plan, ignore permission configs
  const isEnterprise = await isOrganizationOnEnterprisePlan(organizationId)
  if (!isEnterprise) {
    return NextResponse.json({
      permissionGroupId: null,
      groupName: null,
      config: null,
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
        eq(permissionGroup.organizationId, organizationId)
      )
    )
    .limit(1)

  if (!groupMembership) {
    return NextResponse.json({
      permissionGroupId: null,
      groupName: null,
      config: null,
    })
  }

  return NextResponse.json({
    permissionGroupId: groupMembership.permissionGroupId,
    groupName: groupMembership.groupName,
    config: parsePermissionGroupConfig(groupMembership.config),
  })
}
