import { db } from '@sim/db'
import {
  type InvitationStatus,
  invitation,
  member,
  organization,
  user,
  workspace,
} from '@sim/db/schema'
import { and, eq, isNull, or, sql } from 'drizzle-orm'
import {
  type CursorKey,
  encodeKeyset,
  type KeysetKey,
  keysetColumns,
  keysetPage,
  type ListSortOrder,
  listOrderBy,
  resumeKeyset,
  searchFilter,
  textKey,
  timestampKey,
} from '@/lib/api/list-query'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx } from '@/lib/db/types'

export interface OrganizationListOptions<SortBy extends string> {
  sortBy: SortBy
  sortOrder: ListSortOrder
  limit: number
  cursorKeys?: CursorKey[]
  search?: string
}
export type OrganizationSortBy = 'name' | 'createdAt'
export type OrganizationMemberSortBy = 'name' | 'email' | 'joinedAt'
export type OrganizationWorkspaceSortBy = 'name' | 'id'
export type OrganizationInvitationSortBy = 'email' | 'createdAt'

const organizationSelection = {
  id: organization.id,
  name: organization.name,
  slug: organization.slug,
  logo: organization.logo,
  createdAt: organization.createdAt,
}
type OrganizationRow = { id: string; name: string; createdAt: Date }
const organizationSortKeys = {
  name: textKey<OrganizationRow>(organization.name, (row) => row.name),
  createdAt: timestampKey<OrganizationRow>(organization.createdAt, (row) => row.createdAt),
} satisfies Record<OrganizationSortBy, KeysetKey<OrganizationRow>>

function organizationKeys(sortBy: OrganizationSortBy) {
  return [organizationSortKeys[sortBy], textKey<OrganizationRow>(organization.id, (row) => row.id)]
}

export function organizationCursorKeys(row: OrganizationRow, sortBy: OrganizationSortBy) {
  return encodeKeyset(organizationKeys(sortBy), row)
}

export async function listOrganizationRecordsForUser(
  userId: string,
  options: OrganizationListOptions<OrganizationSortBy>
) {
  const keys = organizationKeys(options.sortBy)
  const rows = await db
    .select({ ...organizationSelection, role: member.role })
    .from(organization)
    .innerJoin(member, eq(member.organizationId, organization.id))
    .where(
      and(
        eq(member.userId, userId),
        searchFilter(organization.name, options.search),
        resumeKeyset(keys, options.cursorKeys, options.sortOrder)
      )
    )
    .orderBy(...listOrderBy(keysetColumns(keys), options.sortOrder))
    .limit(options.limit + 1)
  return keysetPage(keys, rows, options.limit)
}

export async function requireOrganizationRecord(organizationId: string) {
  const [row] = await db
    .select({
      ...organizationSelection,
      metadata: organization.metadata,
      updatedAt: organization.updatedAt,
    })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1)
  if (!row) throw new OrchestrationError('not_found', 'Organization not found')
  return row
}

export const organizationMemberSelection = {
  id: member.id,
  userId: member.userId,
  organizationId: member.organizationId,
  role: member.role,
  createdAt: member.createdAt,
  userName: user.name,
  userEmail: user.email,
}
type MemberRow = { userId: string; userName: string; userEmail: string; createdAt: Date }
const memberSortKeys = {
  name: textKey<MemberRow>(user.name, (row) => row.userName),
  email: textKey<MemberRow>(user.email, (row) => row.userEmail),
  joinedAt: timestampKey<MemberRow>(member.createdAt, (row) => row.createdAt),
} satisfies Record<OrganizationMemberSortBy, KeysetKey<MemberRow>>

export async function listOrganizationMemberRecords(
  organizationId: string,
  options: OrganizationListOptions<OrganizationMemberSortBy>
) {
  const keys = [
    memberSortKeys[options.sortBy],
    textKey<MemberRow>(member.userId, (row) => row.userId),
  ]
  const rows = await db
    .select(organizationMemberSelection)
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(
      and(
        eq(member.organizationId, organizationId),
        options.search === undefined
          ? undefined
          : or(searchFilter(user.name, options.search), searchFilter(user.email, options.search)),
        resumeKeyset(keys, options.cursorKeys, options.sortOrder)
      )
    )
    .orderBy(...listOrderBy(keysetColumns(keys), options.sortOrder))
    .limit(options.limit + 1)
  return keysetPage(keys, rows, options.limit)
}

export async function findOrganizationMemberRecord(
  organizationId: string,
  userId: string,
  executor: DbOrTx = db
) {
  const [row] = await executor
    .select(organizationMemberSelection)
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
    .limit(1)
  return row ?? null
}

export async function listOrganizationWorkspaceRecords(
  organizationId: string,
  options: OrganizationListOptions<OrganizationWorkspaceSortBy>
) {
  type WorkspaceRow = { id: string; name: string }
  const idKey = textKey<WorkspaceRow>(workspace.id, (row) => row.id)
  const keys =
    options.sortBy === 'id'
      ? [idKey]
      : [textKey<WorkspaceRow>(workspace.name, (row) => row.name), idKey]
  const rows = await db
    .select({ id: workspace.id, name: workspace.name })
    .from(workspace)
    .where(
      and(
        eq(workspace.organizationId, organizationId),
        isNull(workspace.archivedAt),
        searchFilter(workspace.name, options.search),
        resumeKeyset(keys, options.cursorKeys, options.sortOrder)
      )
    )
    .orderBy(...listOrderBy(keysetColumns(keys), options.sortOrder))
    .limit(options.limit + 1)
  return keysetPage(keys, rows, options.limit)
}

/** Expiration is projected without mutating invitations during a read. */
const invitationStatus = sql<InvitationStatus>`case when ${invitation.status} = 'pending' and ${invitation.expiresAt} <= now() then 'expired' else ${invitation.status}::text end`
const invitationSelection = {
  id: invitation.id,
  organizationId: invitation.organizationId,
  email: invitation.email,
  role: invitation.role,
  kind: invitation.kind,
  membershipIntent: invitation.membershipIntent,
  status: invitationStatus,
  createdAt: invitation.createdAt,
  expiresAt: invitation.expiresAt,
}
type InvitationRow = { id: string; email: string; createdAt: Date }
const invitationSortKeys = {
  email: textKey<InvitationRow>(invitation.email, (row) => row.email),
  createdAt: timestampKey<InvitationRow>(invitation.createdAt, (row) => row.createdAt),
} satisfies Record<OrganizationInvitationSortBy, KeysetKey<InvitationRow>>

export async function listOrganizationInvitationRecords(
  organizationId: string,
  options: OrganizationListOptions<OrganizationInvitationSortBy> & { status?: InvitationStatus }
) {
  const keys = [
    invitationSortKeys[options.sortBy],
    textKey<InvitationRow>(invitation.id, (row) => row.id),
  ]
  const rows = await db
    .select(invitationSelection)
    .from(invitation)
    .where(
      and(
        eq(invitation.organizationId, organizationId),
        searchFilter(invitation.email, options.search),
        options.status ? eq(invitationStatus, options.status) : undefined,
        resumeKeyset(keys, options.cursorKeys, options.sortOrder)
      )
    )
    .orderBy(...listOrderBy(keysetColumns(keys), options.sortOrder))
    .limit(options.limit + 1)
  return keysetPage(keys, rows, options.limit)
}

export async function requireOrganizationInvitationRecord(
  organizationId: string,
  invitationId: string
) {
  const [row] = await db
    .select(invitationSelection)
    .from(invitation)
    .where(and(eq(invitation.organizationId, organizationId), eq(invitation.id, invitationId)))
    .limit(1)
  if (!row) throw new OrchestrationError('not_found', 'Invitation not found')
  return row
}
