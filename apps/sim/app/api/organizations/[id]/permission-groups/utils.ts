import { db } from '@sim/db'
import { permissionGroup } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing'
import { isOrganizationAdminOrOwner } from '@/lib/workspaces/permissions/utils'

/**
 * Authorize an organization-scoped access-control management request. The caller
 * must be an organization owner/admin and the organization must be entitled to
 * the Access Control (Permission Groups) enterprise feature. Returns a
 * `NextResponse` to short-circuit on failure, or `null` when authorized.
 */
export async function authorizeOrgAccessControl(
  userId: string,
  organizationId: string
): Promise<NextResponse | null> {
  const isAdmin = await isOrganizationAdminOrOwner(userId, organizationId)
  if (!isAdmin) {
    return NextResponse.json({ error: 'Admin permissions required' }, { status: 403 })
  }

  const entitled = await isOrganizationOnEnterprisePlan(organizationId)
  if (!entitled) {
    return NextResponse.json({ error: 'Access Control is an Enterprise feature' }, { status: 403 })
  }

  return null
}

/** Load a permission group only if it belongs to the given organization. */
export async function loadGroupInOrganization(groupId: string, organizationId: string) {
  const [group] = await db
    .select({
      id: permissionGroup.id,
      organizationId: permissionGroup.organizationId,
      name: permissionGroup.name,
      description: permissionGroup.description,
      config: permissionGroup.config,
      createdBy: permissionGroup.createdBy,
      createdAt: permissionGroup.createdAt,
      updatedAt: permissionGroup.updatedAt,
      isDefault: permissionGroup.isDefault,
    })
    .from(permissionGroup)
    .where(and(eq(permissionGroup.id, groupId), eq(permissionGroup.organizationId, organizationId)))
    .limit(1)

  return group ?? null
}
