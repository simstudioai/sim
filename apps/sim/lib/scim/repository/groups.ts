import { scimGroup, scimGroupMember, scimUser } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, asc, count, eq, inArray, type SQL } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { invalidValue } from '@/lib/scim/protocol/errors'
import type { ScimFilterTerm, ScimGroupFilterField } from '@/lib/scim/protocol/filter'
import { buildOrderKey } from '@/lib/scim/repository/users'

/** Reads and writes of the provisioned Group table, always anchored to a connection. */

export interface ScimGroupRecord {
  id: string
  externalId: string | null
  displayName: string
  createdAt: Date
  updatedAt: Date
}

const GROUP_SELECTION = {
  id: scimGroup.id,
  externalId: scimGroup.externalId,
  displayName: scimGroup.displayName,
  createdAt: scimGroup.createdAt,
  updatedAt: scimGroup.updatedAt,
} as const

function groupFilterCondition(term: ScimFilterTerm<ScimGroupFilterField>): SQL | undefined {
  switch (term.field) {
    case 'id':
      return eq(scimGroup.id, term.value)
    case 'displayName':
      return eq(scimGroup.displayNameKey, term.value.toLowerCase())
    case 'externalId':
      return eq(scimGroup.externalId, term.value)
  }
}

export async function findScimGroupById(
  tx: DbOrTx,
  connectionId: string,
  groupId: string
): Promise<ScimGroupRecord | null> {
  const [row] = await tx
    .select(GROUP_SELECTION)
    .from(scimGroup)
    .where(and(eq(scimGroup.connectionId, connectionId), eq(scimGroup.id, groupId)))
    .limit(1)
  return row ?? null
}

export async function pageScimGroups(
  tx: DbOrTx,
  params: {
    connectionId: string
    filters: ScimFilterTerm<ScimGroupFilterField>[]
    offset: number
    limit: number
  }
): Promise<{ records: ScimGroupRecord[]; totalResults: number }> {
  const conditions = [
    eq(scimGroup.connectionId, params.connectionId),
    ...params.filters
      .map(groupFilterCondition)
      .filter((value): value is SQL => value !== undefined),
  ]

  const [totalRow] = await tx
    .select({ value: count() })
    .from(scimGroup)
    .where(and(...conditions))

  const records =
    params.limit === 0
      ? []
      : await tx
          .select(GROUP_SELECTION)
          .from(scimGroup)
          .where(and(...conditions))
          .orderBy(asc(scimGroup.orderKey))
          .limit(params.limit)
          .offset(params.offset)

  return { records, totalResults: totalRow?.value ?? 0 }
}

export interface ScimGroupMemberRow {
  scimUserId: string
  displayName: string
}

/** Members of one group, ordered so a response is stable between reads. */
export async function loadGroupMembers(tx: DbOrTx, groupId: string): Promise<ScimGroupMemberRow[]> {
  const rows = await tx
    .select({ scimUserId: scimGroupMember.scimUserId, displayName: scimUser.userName })
    .from(scimGroupMember)
    .innerJoin(scimUser, eq(scimUser.id, scimGroupMember.scimUserId))
    .where(eq(scimGroupMember.groupId, groupId))
    .orderBy(asc(scimGroupMember.createdAt), asc(scimGroupMember.scimUserId))
  return rows
}

export async function loadGroupMemberIds(tx: DbOrTx, groupId: string): Promise<string[]> {
  const rows = await tx
    .select({ scimUserId: scimGroupMember.scimUserId })
    .from(scimGroupMember)
    .where(eq(scimGroupMember.groupId, groupId))
  return rows.map((row) => row.scimUserId)
}

/**
 * Refuses member ids that belong to another connection or do not exist.
 *
 * Without it a directory could name any resource id and pull an unrelated
 * organization's user into a group it controls.
 */
export async function assertConnectionOwnsUsers(
  tx: DbOrTx,
  connectionId: string,
  scimUserIds: string[]
): Promise<void> {
  if (scimUserIds.length === 0) return
  const rows = await tx
    .select({ id: scimUser.id })
    .from(scimUser)
    .where(and(eq(scimUser.connectionId, connectionId), inArray(scimUser.id, scimUserIds)))
  if (rows.length !== scimUserIds.length) {
    throw invalidValue('One or more Group members are not users of this directory')
  }
}

export async function insertScimGroup(
  tx: DbOrTx,
  params: { connectionId: string; displayName: string; externalId?: string | undefined }
): Promise<ScimGroupRecord> {
  const id = generateId()
  const createdAt = new Date()
  await tx.insert(scimGroup).values({
    id,
    connectionId: params.connectionId,
    externalId: params.externalId ?? null,
    displayName: params.displayName,
    displayNameKey: params.displayName.toLowerCase(),
    orderKey: buildOrderKey(createdAt, id),
    createdAt,
    updatedAt: createdAt,
  })
  return {
    id,
    externalId: params.externalId ?? null,
    displayName: params.displayName,
    createdAt,
    updatedAt: createdAt,
  }
}

export async function updateScimGroup(
  tx: DbOrTx,
  params: { groupId: string; displayName?: string; externalId?: string | null }
): Promise<void> {
  await tx
    .update(scimGroup)
    .set({
      ...(params.displayName !== undefined
        ? { displayName: params.displayName, displayNameKey: params.displayName.toLowerCase() }
        : {}),
      ...(params.externalId !== undefined ? { externalId: params.externalId } : {}),
      updatedAt: new Date(),
    })
    .where(eq(scimGroup.id, params.groupId))
}

export async function touchScimGroup(tx: DbOrTx, groupId: string): Promise<void> {
  await tx.update(scimGroup).set({ updatedAt: new Date() }).where(eq(scimGroup.id, groupId))
}

export async function deleteScimGroup(tx: DbOrTx, groupId: string): Promise<void> {
  await tx.delete(scimGroup).where(eq(scimGroup.id, groupId))
}

/** Adds a member, tolerating a repeat. Returns whether the row was new. */
export async function addGroupMember(
  tx: DbOrTx,
  params: { groupId: string; scimUserId: string }
): Promise<boolean> {
  const inserted = await tx
    .insert(scimGroupMember)
    .values({
      id: generateId(),
      groupId: params.groupId,
      scimUserId: params.scimUserId,
      createdAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: scimGroupMember.id })
  return inserted.length > 0
}

/** Removes a member, tolerating one who is not in the group. */
export async function removeGroupMember(
  tx: DbOrTx,
  params: { groupId: string; scimUserId: string }
): Promise<boolean> {
  const deleted = await tx
    .delete(scimGroupMember)
    .where(
      and(
        eq(scimGroupMember.groupId, params.groupId),
        eq(scimGroupMember.scimUserId, params.scimUserId)
      )
    )
    .returning({ id: scimGroupMember.id })
  return deleted.length > 0
}

export async function countGroupMembers(tx: DbOrTx, groupId: string): Promise<number> {
  const [row] = await tx
    .select({ value: count() })
    .from(scimGroupMember)
    .where(eq(scimGroupMember.groupId, groupId))
  return row?.value ?? 0
}
