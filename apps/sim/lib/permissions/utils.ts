import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { member, permissions, type permissionTypeEnum, user, workspace } from '@/db/schema'

export type PermissionType = (typeof permissionTypeEnum.enumValues)[number]

/**
 * Get the highest permission level a user has for a specific entity
 *
 * @param userId - The ID of the user to check permissions for
 * @param entityType - The type of entity (e.g., 'workspace', 'workflow', etc.)
 * @param entityId - The ID of the specific entity
 * @returns Promise<PermissionType | null> - The highest permission the user has for the entity, or null if none
 */
export async function getUserEntityPermissions(
  userId: string,
  entityType: string,
  entityId: string
): Promise<PermissionType | null> {
  const result = await db
    .select({ permissionType: permissions.permissionType })
    .from(permissions)
    .where(
      and(
        eq(permissions.userId, userId),
        eq(permissions.entityType, entityType),
        eq(permissions.entityId, entityId)
      )
    )

  if (result.length === 0) {
    return null
  }

  // If multiple permissions exist (legacy data), return the highest one
  const permissionOrder: Record<PermissionType, number> = { admin: 3, write: 2, read: 1 }
  const highestPermission = result.reduce((highest, current) => {
    return permissionOrder[current.permissionType] > permissionOrder[highest.permissionType]
      ? current
      : highest
  })

  return highestPermission.permissionType
}

/**
 * Check if a user has admin permission for a specific workspace
 *
 * @param userId - The ID of the user to check permissions for
 * @param workspaceId - The ID of the workspace to check admin permission for
 * @returns Promise<boolean> - True if the user has admin permission for the workspace, false otherwise
 */
export async function hasAdminPermission(userId: string, workspaceId: string): Promise<boolean> {
  const result = await db
    .select()
    .from(permissions)
    .where(
      and(
        eq(permissions.userId, userId),
        eq(permissions.entityType, 'workspace'),
        eq(permissions.entityId, workspaceId),
        eq(permissions.permissionType, 'admin')
      )
    )
    .limit(1)

  return result.length > 0
}

/**
 * Retrieves a list of users with their associated permissions for a given workspace.
 *
 * @param workspaceId - The ID of the workspace to retrieve user permissions for.
 * @returns A promise that resolves to an array of user objects, each containing user details and their permission type.
 */
export async function getUsersWithPermissions(workspaceId: string) {
  const usersWithPermissions = await db
    .select({
      userId: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      permissionType: permissions.permissionType,
    })
    .from(permissions)
    .innerJoin(user, eq(permissions.userId, user.id))
    .where(and(eq(permissions.entityType, 'workspace'), eq(permissions.entityId, workspaceId)))
    .orderBy(user.email)

  // Since each user has only one permission, we can use the results directly
  return usersWithPermissions.map((row) => ({
    userId: row.userId,
    email: row.email,
    name: row.name,
    image: row.image,
    permissionType: row.permissionType,
  }))
}

/**
 * Check if a user is an admin or owner of any organization that has access to a workspace
 *
 * @param userId - The ID of the user to check
 * @param workspaceId - The ID of the workspace
 * @returns Promise<boolean> - True if the user is an organization admin with access to the workspace
 */
export async function isOrganizationAdminForWorkspace(
  userId: string,
  workspaceId: string
): Promise<boolean> {
  try {
    // Get the workspace owner
    const workspaceRecord = await db
      .select({ ownerId: workspace.ownerId })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1)

    if (workspaceRecord.length === 0) {
      return false
    }

    const workspaceOwnerId = workspaceRecord[0].ownerId

    // Check if the user is an admin/owner of any organization that the workspace owner belongs to
    const orgMemberships = await db
      .select({
        organizationId: member.organizationId,
        role: member.role,
      })
      .from(member)
      .where(
        and(
          eq(member.userId, userId),
          // Only admin and owner roles can manage workspace permissions
          eq(member.role, 'admin') // We'll also check for 'owner' separately
        )
      )

    // Also check for owner role
    const ownerMemberships = await db
      .select({
        organizationId: member.organizationId,
        role: member.role,
      })
      .from(member)
      .where(and(eq(member.userId, userId), eq(member.role, 'owner')))

    const allOrgMemberships = [...orgMemberships, ...ownerMemberships]

    if (allOrgMemberships.length === 0) {
      return false
    }

    // Check if the workspace owner is a member of any of these organizations
    for (const membership of allOrgMemberships) {
      const workspaceOwnerInOrg = await db
        .select()
        .from(member)
        .where(
          and(
            eq(member.userId, workspaceOwnerId),
            eq(member.organizationId, membership.organizationId)
          )
        )
        .limit(1)

      if (workspaceOwnerInOrg.length > 0) {
        return true
      }
    }

    return false
  } catch (error) {
    console.error('Error checking organization admin status for workspace:', error)
    return false
  }
}

/**
 * Check if a user has admin permissions (either direct workspace admin or organization admin)
 *
 * @param userId - The ID of the user to check permissions for
 * @param workspaceId - The ID of the workspace to check admin permission for
 * @returns Promise<boolean> - True if the user has admin permission for the workspace, false otherwise
 */
export async function hasWorkspaceAdminAccess(
  userId: string,
  workspaceId: string
): Promise<boolean> {
  // Check direct workspace admin permission
  const directAdmin = await hasAdminPermission(userId, workspaceId)
  if (directAdmin) {
    return true
  }

  // Check organization admin permission
  const orgAdmin = await isOrganizationAdminForWorkspace(userId, workspaceId)
  return orgAdmin
}

/**
 * Get all workspaces that a user can manage (either as direct admin or organization admin)
 *
 * @param userId - The ID of the user
 * @returns Promise<Array<{id: string, name: string, ownerId: string}>> - Array of workspaces the user can manage
 */
export async function getManageableWorkspaces(userId: string): Promise<
  Array<{
    id: string
    name: string
    ownerId: string
    accessType: 'direct' | 'organization'
  }>
> {
  const manageableWorkspaces: Array<{
    id: string
    name: string
    ownerId: string
    accessType: 'direct' | 'organization'
  }> = []

  // Get workspaces where user has direct admin permissions
  const directWorkspaces = await db
    .select({
      id: workspace.id,
      name: workspace.name,
      ownerId: workspace.ownerId,
    })
    .from(workspace)
    .innerJoin(permissions, eq(permissions.entityId, workspace.id))
    .where(
      and(
        eq(permissions.userId, userId),
        eq(permissions.entityType, 'workspace'),
        eq(permissions.permissionType, 'admin')
      )
    )

  directWorkspaces.forEach((ws) => {
    manageableWorkspaces.push({
      ...ws,
      accessType: 'direct',
    })
  })

  // Get workspaces where user has organization admin access
  // First, get organizations where the user is admin/owner
  const adminOrgs = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(
      and(
        eq(member.userId, userId)
        // Check for both admin and owner roles
      )
    )

  // Get all organization workspaces for these orgs
  for (const org of adminOrgs) {
    // Get all members of this organization
    const orgMembers = await db
      .select({ userId: member.userId })
      .from(member)
      .where(eq(member.organizationId, org.organizationId))

    // Get workspaces owned by org members
    const orgWorkspaces = await db
      .select({
        id: workspace.id,
        name: workspace.name,
        ownerId: workspace.ownerId,
      })
      .from(workspace)
      .where(
        // Find workspaces owned by any org member
        eq(workspace.ownerId, orgMembers.length > 0 ? orgMembers[0].userId : 'none')
      )

    // Add these workspaces if not already included
    orgWorkspaces.forEach((ws) => {
      if (!manageableWorkspaces.find((existing) => existing.id === ws.id)) {
        manageableWorkspaces.push({
          ...ws,
          accessType: 'organization',
        })
      }
    })
  }

  return manageableWorkspaces
}

/**
 * Check if a user is an owner or admin of a specific organization
 *
 * @param userId - The ID of the user to check
 * @param organizationId - The ID of the organization
 * @returns Promise<boolean> - True if the user is an owner or admin of the organization
 */
export async function isOrganizationOwnerOrAdmin(
  userId: string,
  organizationId: string
): Promise<boolean> {
  try {
    const memberRecord = await db
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
      .limit(1)

    if (memberRecord.length === 0) {
      return false // User is not a member of the organization
    }

    const userRole = memberRecord[0].role
    return ['owner', 'admin'].includes(userRole)
  } catch (error) {
    console.error('Error checking organization ownership/admin status:', error)
    return false
  }
}
