import { db } from '@sim/db'
import { member, permissions, user, type WorkspaceMode, workspace } from '@sim/db/schema'
import {
  isOrgAdminRole,
  ORG_ADMIN_ROLES,
  PERMISSION_RANK,
  type PermissionType,
  permissionSatisfies,
  resolveEffectiveWorkspacePermission,
} from '@sim/platform-authz/workspace'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { HttpError } from '@/lib/core/utils/http-error'
import { getOrgAdminWorkspaceRows } from '@/lib/workspaces/utils'

export type { PermissionType }
export interface WorkspaceBasic {
  id: string
}

export interface WorkspaceWithOwner {
  id: string
  name: string
  ownerId: string
  organizationId: string | null
  workspaceMode: WorkspaceMode
  billedAccountUserId: string
  archivedAt?: Date | null
}

export interface WorkspaceAccess {
  exists: boolean
  hasAccess: boolean
  canWrite: boolean
  canAdmin: boolean
  workspace: WorkspaceWithOwner | null
  /** The viewer's raw effective permission, or `null` when the workspace doesn't exist or they have none. */
  permission: PermissionType | null
}

/**
 * Check if a workspace exists
 *
 * @param workspaceId - The workspace ID to check
 * @returns True if the workspace exists, false otherwise
 */
export async function workspaceExists(
  workspaceId: string,
  options?: { includeArchived?: boolean }
): Promise<boolean> {
  const { includeArchived = false } = options ?? {}
  const [ws] = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(
      includeArchived
        ? eq(workspace.id, workspaceId)
        : and(eq(workspace.id, workspaceId), isNull(workspace.archivedAt))
    )
    .limit(1)

  return !!ws
}

/**
 * Get a workspace by ID for existence check
 *
 * @param workspaceId - The workspace ID to look up
 * @returns The workspace if found, null otherwise
 */
export async function getWorkspaceById(
  workspaceId: string,
  options?: { includeArchived?: boolean }
): Promise<WorkspaceBasic | null> {
  const exists = await workspaceExists(workspaceId, options)
  return exists ? { id: workspaceId } : null
}

/**
 * Get a workspace with owner info by ID
 *
 * @param workspaceId - The workspace ID to look up
 * @returns The workspace with owner info if found, null otherwise
 */
export async function getWorkspaceWithOwner(
  workspaceId: string,
  options?: { includeArchived?: boolean }
): Promise<WorkspaceWithOwner | null> {
  const { includeArchived = false } = options ?? {}
  const [ws] = await db
    .select({
      id: workspace.id,
      name: workspace.name,
      ownerId: workspace.ownerId,
      organizationId: workspace.organizationId,
      workspaceMode: workspace.workspaceMode,
      billedAccountUserId: workspace.billedAccountUserId,
      archivedAt: workspace.archivedAt,
    })
    .from(workspace)
    .where(
      includeArchived
        ? eq(workspace.id, workspaceId)
        : and(eq(workspace.id, workspaceId), isNull(workspace.archivedAt))
    )
    .limit(1)

  return ws || null
}

/**
 * Resolve the effective workspace permission for a user under the governance
 * inheritance model: the owners/admins of the organization that owns the
 * workspace are derived workspace admins. Returns the higher of any explicit
 * grant and the org-admin derivation. The workspace owner is not special-cased —
 * they always hold an explicit `admin` row, so the resolver's lookup covers them.
 *
 * Delegates to the shared resolver in `@sim/platform-authz/workspace` so the
 * rule has a single source of truth shared with the realtime server.
 *
 * @param userId - The user to resolve the permission for
 * @param ws - The workspace (organization already loaded)
 */
export async function getEffectiveWorkspacePermission(
  userId: string,
  ws: Pick<WorkspaceWithOwner, 'id' | 'organizationId'>
): Promise<PermissionType | null> {
  return resolveEffectiveWorkspacePermission(userId, ws.id, ws.organizationId)
}

/**
 * Check workspace access for a user
 *
 * Verifies the workspace exists and the user has access to it.
 * Returns access level (read/write) based on ownership, explicit permissions,
 * and organization-admin inheritance.
 *
 * @param workspaceId - The workspace ID to check
 * @param userId - The user ID to check access for
 * @returns WorkspaceAccess object with exists, hasAccess, canWrite, and workspace data
 */
export async function checkWorkspaceAccess(
  workspaceId: string,
  userId: string
): Promise<WorkspaceAccess> {
  const ws = await getWorkspaceWithOwner(workspaceId)

  if (!ws) {
    return {
      exists: false,
      hasAccess: false,
      canWrite: false,
      canAdmin: false,
      workspace: null,
      permission: null,
    }
  }

  const permission = await getEffectiveWorkspacePermission(userId, ws)
  const hasAccess = permission !== null
  const canWrite = permissionSatisfies(permission, 'write')
  const canAdmin = permissionSatisfies(permission, 'admin')

  return { exists: true, hasAccess, canWrite, canAdmin, workspace: ws, permission }
}

/**
 * Thrown when a user attempts to access a workspace they don't have access to,
 * or that doesn't exist / has been archived. Carries `statusCode = 403` so the
 * centralized route wrapper maps it to HTTP 403 instead of defaulting to 500.
 * The `message` is intentionally client-safe and is exposed to API responses.
 */
export class WorkspaceAccessDeniedError extends HttpError {
  readonly statusCode = 403
  readonly workspaceId: string

  constructor(workspaceId: string) {
    super(`Workspace access denied: ${workspaceId}`)
    this.name = 'WorkspaceAccessDeniedError'
    this.workspaceId = workspaceId
  }
}

export function isWorkspaceAccessDeniedError(error: unknown): error is WorkspaceAccessDeniedError {
  return error instanceof WorkspaceAccessDeniedError
}

export async function assertActiveWorkspaceAccess(
  workspaceId: string,
  userId: string
): Promise<WorkspaceAccess> {
  const access = await checkWorkspaceAccess(workspaceId, userId)
  if (!access.exists || !access.hasAccess) {
    throw new WorkspaceAccessDeniedError(workspaceId)
  }
  return access
}

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
  if (entityType === 'workspace') {
    return (await checkWorkspaceAccess(entityId, userId)).permission
  }

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

  const highestPermission = result.reduce((highest, current) => {
    return PERMISSION_RANK[current.permissionType] > PERMISSION_RANK[highest.permissionType]
      ? current
      : highest
  })

  return highestPermission.permissionType
}

/**
 * Retrieves a list of users with their associated permissions for a given workspace.
 *
 * A member is `isExternal` when they hold workspace access but belong to a
 * different organization than the workspace (or to any organization when the
 * workspace is personal/grandfathered and has none). The workspace owner is
 * never external. This mirrors the accept-time `external` membership intent so
 * the UI tag matches how the member actually joined.
 *
 * @param workspaceId - The ID of the workspace to retrieve user permissions for.
 * @returns A promise that resolves to an array of user objects, each containing user details and their permission type.
 */
export type MemberRoleSource = 'owner' | 'explicit' | 'org-admin'

export interface WorkspaceMemberWithRole {
  userId: string
  email: string
  name: string
  image: string | null
  permissionType: PermissionType
  isExternal: boolean
  joinedAt: string
  /**
   * Where the effective role comes from. `org-admin` and `owner` roles are
   * derived and cannot be changed through the member UI.
   */
  roleSource: MemberRoleSource
}

export async function getUsersWithPermissions(
  workspaceId: string
): Promise<WorkspaceMemberWithRole[]> {
  const ws = await getWorkspaceWithOwner(workspaceId)
  if (!ws) return []

  const explicitRows = await db
    .select({
      userId: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      permissionType: permissions.permissionType,
      joinedAt: permissions.createdAt,
      userOrganizationId: member.organizationId,
    })
    .from(permissions)
    .innerJoin(user, eq(permissions.userId, user.id))
    .leftJoin(member, eq(member.userId, user.id))
    .where(and(eq(permissions.entityType, 'workspace'), eq(permissions.entityId, workspaceId)))

  const byUser = new Map<string, WorkspaceMemberWithRole>()

  for (const row of explicitRows) {
    const isOwner = row.userId === ws.ownerId
    byUser.set(row.userId, {
      userId: row.userId,
      email: row.email,
      name: row.name,
      image: row.image ?? null,
      permissionType: row.permissionType,
      isExternal: !isOwner && row.userOrganizationId !== ws.organizationId,
      joinedAt: row.joinedAt.toISOString(),
      roleSource: isOwner ? 'owner' : 'explicit',
    })
  }

  if (ws.organizationId) {
    const orgAdmins = await db
      .select({
        userId: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        joinedAt: member.createdAt,
      })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(
        and(
          eq(member.organizationId, ws.organizationId),
          inArray(member.role, [...ORG_ADMIN_ROLES])
        )
      )

    for (const row of orgAdmins) {
      const isOwner = row.userId === ws.ownerId
      const existing = byUser.get(row.userId)
      if (existing) {
        existing.permissionType = 'admin'
        existing.isExternal = false
        if (existing.roleSource !== 'owner') {
          existing.roleSource = isOwner ? 'owner' : 'org-admin'
        }
      } else {
        byUser.set(row.userId, {
          userId: row.userId,
          email: row.email,
          name: row.name,
          image: row.image ?? null,
          permissionType: 'admin',
          isExternal: false,
          joinedAt: row.joinedAt.toISOString(),
          roleSource: isOwner ? 'owner' : 'org-admin',
        })
      }
    }
  }

  return Array.from(byUser.values()).sort((a, b) => a.email.localeCompare(b.email))
}

/** Lightweight profile data for workspace member display (avatars, owner cells). */
export interface WorkspaceMemberProfile {
  userId: string
  name: string
  image: string | null
}

/**
 * Fetches minimal profile data (id, name, image) for all members of a workspace.
 * Use this instead of getUsersWithPermissions when you only need display info.
 */
export async function getWorkspaceMemberProfiles(
  workspaceId: string
): Promise<WorkspaceMemberProfile[]> {
  const rows = await db
    .select({
      userId: user.id,
      name: user.name,
      image: user.image,
    })
    .from(permissions)
    .innerJoin(user, eq(permissions.userId, user.id))
    .innerJoin(workspace, eq(permissions.entityId, workspace.id))
    .where(
      and(
        eq(permissions.entityType, 'workspace'),
        eq(permissions.entityId, workspaceId),
        isNull(workspace.archivedAt)
      )
    )

  return rows
}

export interface WorkspacePermissionsForViewer {
  users: WorkspaceMemberWithRole[]
  total: number
  viewer: {
    userId: string
    isAdmin: boolean
    permissionType: PermissionType
  }
}

/**
 * Builds the workspace permissions payload for a viewer: the full member list plus
 * the viewer's own resolved permission. Shared by `GET /api/workspaces/[id]/permissions`
 * and the sidebar prefetch so the two never drift.
 *
 * @param workspaceId - The workspace ID to build permissions for
 * @param userId - The viewer's user ID
 * @returns The permissions payload, or `null` if the workspace doesn't exist or the viewer lacks access
 */
export async function getWorkspacePermissionsForViewer(
  workspaceId: string,
  userId: string
): Promise<WorkspacePermissionsForViewer | null> {
  const ws = await getWorkspaceWithOwner(workspaceId)
  if (!ws) return null

  const permission = await getEffectiveWorkspacePermission(userId, ws)
  if (permission === null) return null

  const users = await getUsersWithPermissions(workspaceId)

  return {
    users,
    total: users.length,
    viewer: { userId, isAdmin: permission === 'admin', permissionType: permission },
  }
}

/**
 * Check if a user has admin access to a specific workspace
 *
 * @param userId - The ID of the user to check
 * @param workspaceId - The ID of the workspace to check
 * @returns Promise<boolean> - True if the user has admin access to the workspace, false otherwise
 */
export async function hasWorkspaceAdminAccess(
  userId: string,
  workspaceId: string
): Promise<boolean> {
  return (await checkWorkspaceAccess(workspaceId, userId)).canAdmin
}

/**
 * Check whether a user is an owner or admin of a specific organization.
 *
 * @param userId - The ID of the user to check
 * @param organizationId - The ID of the organization to check
 * @returns Promise<boolean> - True when the user is the organization owner or an admin
 */
export async function isOrganizationAdminOrOwner(
  userId: string,
  organizationId: string
): Promise<boolean> {
  const [row] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
    .limit(1)
  return isOrgAdminRole(row?.role)
}

/**
 * Check whether a user is a member (any role) of a specific organization.
 *
 * @param userId - The ID of the user to check
 * @param organizationId - The ID of the organization to check
 * @returns Promise<boolean> - True when the user has an organization membership row
 */
export async function isOrganizationMember(
  userId: string,
  organizationId: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
    .limit(1)
  return !!row
}

/**
 * Get a list of workspaces that the user has access to
 *
 * @param userId - The ID of the user to check
 * @returns Promise<Array<{
 *   id: string
 *   name: string
 *   ownerId: string
 *   accessType: 'direct' | 'owner'
 * }>> - A list of workspaces that the user has access to
 */
export async function getManageableWorkspaces(userId: string): Promise<
  Array<{
    id: string
    name: string
    ownerId: string
    accessType: 'direct' | 'owner'
  }>
> {
  const ownedWorkspaces = await db
    .select({
      id: workspace.id,
      name: workspace.name,
      ownerId: workspace.ownerId,
    })
    .from(workspace)
    .where(and(eq(workspace.ownerId, userId), isNull(workspace.archivedAt)))

  const adminWorkspaces = await db
    .select({
      id: workspace.id,
      name: workspace.name,
      ownerId: workspace.ownerId,
    })
    .from(workspace)
    .innerJoin(permissions, eq(permissions.entityId, workspace.id))
    .where(
      and(
        isNull(workspace.archivedAt),
        eq(permissions.userId, userId),
        eq(permissions.entityType, 'workspace'),
        eq(permissions.permissionType, 'admin')
      )
    )

  const orgAdminWorkspaces = (await getOrgAdminWorkspaceRows(userId, 'active')).map((ws) => ({
    id: ws.id,
    name: ws.name,
    ownerId: ws.ownerId,
  }))

  const ownedSet = new Set(ownedWorkspaces.map((w) => w.id))
  const seen = new Set(ownedSet)
  const combined: Array<{
    id: string
    name: string
    ownerId: string
    accessType: 'direct' | 'owner'
  }> = ownedWorkspaces.map((ws) => ({ ...ws, accessType: 'owner' as const }))

  for (const ws of [...adminWorkspaces, ...orgAdminWorkspaces]) {
    if (seen.has(ws.id)) continue
    seen.add(ws.id)
    combined.push({ ...ws, accessType: 'direct' as const })
  }

  return combined
}
