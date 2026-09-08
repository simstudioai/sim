import { scimGroup, scimGroupMember, scimUser } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, asc, count, eq, gt, inArray, type SQL, sql } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import type { ScimFilterTerm, ScimGroupFilterField } from '@/ee/scim/lib/protocol/filter'
import { buildOrderKey } from '@/ee/scim/lib/repository/users'

const logger = createLogger('ScimGroupRepository')

/** Reads and writes of the provisioned Group table, always anchored to a connection. */

/** What a member is called in a Group response: the same display name the User resource shows. */
const memberDisplayName = sql<string>`coalesce(${scimUser.attributes} ->> 'displayName', ${scimUser.userName})`

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

/** Stable, bounded pages for remapping groups that arrived before automatic matching was enabled. */
export async function listScimGroupsForReconcile(
  tx: DbOrTx,
  params: { connectionId: string; afterOrderKey?: string; limit: number }
): Promise<Array<{ id: string; displayName: string; orderKey: string }>> {
  return tx
    .select({ id: scimGroup.id, displayName: scimGroup.displayName, orderKey: scimGroup.orderKey })
    .from(scimGroup)
    .where(
      and(
        eq(scimGroup.connectionId, params.connectionId),
        params.afterOrderKey ? gt(scimGroup.orderKey, params.afterOrderKey) : undefined
      )
    )
    .orderBy(asc(scimGroup.orderKey))
    .limit(params.limit)
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
    .select({ scimUserId: scimGroupMember.scimUserId, displayName: memberDisplayName })
    .from(scimGroupMember)
    .innerJoin(scimUser, eq(scimUser.id, scimGroupMember.scimUserId))
    .where(eq(scimGroupMember.groupId, groupId))
    .orderBy(asc(scimGroupMember.createdAt), asc(scimGroupMember.scimUserId))
  return rows
}

/** Members of many groups in one query, keyed by group, for list responses. */
export async function loadGroupMembersForGroups(
  tx: DbOrTx,
  groupIds: string[]
): Promise<Map<string, ScimGroupMemberRow[]>> {
  const byGroup = new Map<string, ScimGroupMemberRow[]>()
  if (groupIds.length === 0) return byGroup
  const rows = await tx
    .select({
      groupId: scimGroupMember.groupId,
      scimUserId: scimGroupMember.scimUserId,
      displayName: memberDisplayName,
    })
    .from(scimGroupMember)
    .innerJoin(scimUser, eq(scimUser.id, scimGroupMember.scimUserId))
    .where(inArray(scimGroupMember.groupId, groupIds))
    .orderBy(asc(scimGroupMember.createdAt), asc(scimGroupMember.scimUserId))
  for (const row of rows) {
    const list = byGroup.get(row.groupId) ?? []
    list.push({ scimUserId: row.scimUserId, displayName: row.displayName })
    byGroup.set(row.groupId, list)
  }
  return byGroup
}

export async function loadGroupMemberIds(tx: DbOrTx, groupId: string): Promise<string[]> {
  const rows = await tx
    .select({ scimUserId: scimGroupMember.scimUserId })
    .from(scimGroupMember)
    .where(eq(scimGroupMember.groupId, groupId))
  return rows.map((row) => row.scimUserId)
}

/**
 * Keeps only the member ids this connection provisioned.
 *
 * An id from another connection can never be pulled into a group this
 * directory controls. An id this directory itself no longer has — a member it
 * deprovisioned but still lists in the group — is dropped with a warning rather
 * than failing the whole group on every cycle; there is nothing to add.
 */
export async function filterOwnedUsers(
  tx: DbOrTx,
  connectionId: string,
  scimUserIds: string[]
): Promise<string[]> {
  if (scimUserIds.length === 0) return []
  const rows = await tx
    .select({ id: scimUser.id })
    .from(scimUser)
    .where(and(eq(scimUser.connectionId, connectionId), inArray(scimUser.id, scimUserIds)))
  const owned = new Set(rows.map((row) => row.id))
  const unknown = scimUserIds.filter((id) => !owned.has(id))
  if (unknown.length > 0) {
    logger.warn('Ignored Group members that are not users of this directory', {
      connectionId,
      unknown: unknown.length,
    })
  }
  return scimUserIds.filter((id) => owned.has(id))
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

export async function deleteScimGroupRow(tx: DbOrTx, groupId: string): Promise<void> {
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
