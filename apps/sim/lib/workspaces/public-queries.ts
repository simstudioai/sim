import { db } from '@sim/db'
import { member, permissions, user, workspace } from '@sim/db/schema'
import { ORG_ADMIN_ROLES, type PermissionType } from '@sim/platform-authz/workspace'
import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm'

export interface PublicWorkspaceDetail {
  id: string
  name: string
  color: string
  logoUrl: string | null
  memberCount: number
  createdAt: Date
  updatedAt: Date
}

interface WorkspaceMemberRow {
  userId: string
  email: string
  name: string
  image: string | null
  role: PermissionType
  isExternal: boolean
  joinedAt: Date
}

interface QueryWorkspaceMembersOptions {
  limit: number
  afterEmail?: string
}

export interface WorkspaceMemberPage {
  members: WorkspaceMemberRow[]
  nextEmail: string | null
}

async function countWorkspaceMembers(
  workspaceId: string,
  organizationId: string | null
): Promise<number> {
  const orgAdminRoles = sql.join(
    ORG_ADMIN_ROLES.map((role) => sql`${role}`),
    sql`, `
  )
  const [row] = await db.execute<{ count: number | string }>(sql`
    SELECT COUNT(*)::integer AS count
    FROM (
      SELECT ${permissions.userId} AS user_id
      FROM ${permissions}
      WHERE ${permissions.entityType} = 'workspace'
        AND ${permissions.entityId} = ${workspaceId}
      UNION
      SELECT ${member.userId} AS user_id
      FROM ${member}
      WHERE ${member.organizationId} = ${organizationId}
        AND ${member.role} IN (${orgAdminRoles})
    ) AS effective_members
  `)

  const count = Number(row?.count)
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`Invalid member count for workspace ${workspaceId}`)
  }
  return count
}

/** Public workspace metadata with all governance and billing identities omitted. */
export async function getPublicWorkspaceDetail(
  workspaceId: string
): Promise<PublicWorkspaceDetail | null> {
  const [row] = await db
    .select({
      id: workspace.id,
      name: workspace.name,
      color: workspace.color,
      logoUrl: workspace.logoUrl,
      organizationId: workspace.organizationId,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    })
    .from(workspace)
    .where(and(eq(workspace.id, workspaceId), isNull(workspace.archivedAt)))
    .limit(1)

  if (!row) return null

  return {
    id: row.id,
    name: row.name,
    color: row.color,
    logoUrl: row.logoUrl,
    memberCount: await countWorkspaceMembers(workspaceId, row.organizationId),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * Returns one email-ordered page of effective workspace members. Explicit
 * grants and inherited organization-admin grants are each bounded in SQL,
 * then merged so a user present in both sources appears once with admin access.
 */
export async function queryPublicWorkspaceMembers(
  workspaceId: string,
  options: QueryWorkspaceMembersOptions
): Promise<WorkspaceMemberPage | null> {
  const [workspaceRow] = await db
    .select({
      ownerId: workspace.ownerId,
      organizationId: workspace.organizationId,
    })
    .from(workspace)
    .where(and(eq(workspace.id, workspaceId), isNull(workspace.archivedAt)))
    .limit(1)

  if (!workspaceRow) return null

  const emailOrder = sql<string>`${user.email} COLLATE "C"`
  const emailCursor = options.afterEmail ? gt(emailOrder, options.afterEmail) : undefined
  const sourceLimit = options.limit + 1
  const hasRelevantOrganizationMembership = workspaceRow.organizationId
    ? sql<boolean>`EXISTS (
        SELECT 1
        FROM ${member}
        WHERE ${member.userId} = ${user.id}
          AND ${member.organizationId} = ${workspaceRow.organizationId}
      )`
    : sql<boolean>`EXISTS (
        SELECT 1
        FROM ${member}
        WHERE ${member.userId} = ${user.id}
      )`

  const explicitPromise = db
    .select({
      userId: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      role: permissions.permissionType,
      joinedAt: permissions.createdAt,
      hasRelevantOrganizationMembership,
    })
    .from(permissions)
    .innerJoin(user, eq(permissions.userId, user.id))
    .where(
      and(
        eq(permissions.entityType, 'workspace'),
        eq(permissions.entityId, workspaceId),
        emailCursor
      )
    )
    .orderBy(asc(emailOrder))
    .limit(sourceLimit)

  const orgAdminPromise = workspaceRow.organizationId
    ? db
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
            eq(member.organizationId, workspaceRow.organizationId),
            inArray(member.role, [...ORG_ADMIN_ROLES]),
            emailCursor
          )
        )
        .orderBy(asc(emailOrder))
        .limit(sourceLimit)
    : Promise.resolve([])

  const [explicitRows, orgAdminRows] = await Promise.all([explicitPromise, orgAdminPromise])
  const byUserId = new Map<string, WorkspaceMemberRow>()

  for (const row of explicitRows) {
    byUserId.set(row.userId, {
      userId: row.userId,
      email: row.email,
      name: row.name,
      image: row.image,
      role: row.role,
      isExternal:
        row.userId !== workspaceRow.ownerId &&
        (workspaceRow.organizationId
          ? !row.hasRelevantOrganizationMembership
          : row.hasRelevantOrganizationMembership),
      joinedAt: row.joinedAt,
    })
  }

  for (const row of orgAdminRows) {
    const existing = byUserId.get(row.userId)
    if (existing) {
      existing.role = 'admin'
      existing.isExternal = false
      continue
    }
    byUserId.set(row.userId, {
      userId: row.userId,
      email: row.email,
      name: row.name,
      image: row.image,
      role: 'admin',
      isExternal: false,
      joinedAt: row.joinedAt,
    })
  }

  const sorted = Array.from(byUserId.values()).sort((left, right) =>
    left.email < right.email ? -1 : left.email > right.email ? 1 : 0
  )
  const hasMore = sorted.length > options.limit
  const members = sorted.slice(0, options.limit)

  return {
    members,
    nextEmail: hasMore ? (members.at(-1)?.email ?? null) : null,
  }
}
