import { type ScimUserAttributes, scimGroup, scimGroupMember, scimUser, user } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { normalizeEmail } from '@sim/utils/string'
import { and, asc, count, eq, inArray, type SQL, sql } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { uniqueness } from '@/ee/scim/lib/protocol/errors'
import type { ScimFilterTerm, ScimUserFilterField } from '@/ee/scim/lib/protocol/filter'
import type { UserResourceRow } from '@/ee/scim/lib/protocol/resources'

/**
 * Reads and writes of the provisioned User table.
 *
 * Every predicate is anchored to a connection id. That is the whole tenant
 * boundary for this surface: a request names a resource id and nothing else, so
 * a query that forgot the anchor would let one organization's directory address
 * another's users.
 */

/**
 * A sortable key that never reorders between pages.
 *
 * A provider walks a list with `startIndex`, so rows must keep their positions
 * across separate requests. Two rows created in the same millisecond would tie
 * on a timestamp alone and could swap places between pages, silently hiding one
 * from an import; appending the id breaks the tie permanently.
 */
export function buildOrderKey(createdAt: Date, id: string): string {
  return `${String(createdAt.getTime()).padStart(15, '0')}:${id}`
}

function userFilterCondition(term: ScimFilterTerm<ScimUserFilterField>): SQL | undefined {
  switch (term.field) {
    case 'id':
      return eq(scimUser.id, term.value)
    case 'userName':
      return eq(scimUser.userName, term.value.toLowerCase())
    case 'externalId':
      return eq(scimUser.externalId, term.value)
    case 'primaryEmail':
      return sql`lower(trim(${user.email})) = ${normalizeEmail(term.value)}`
    case 'email':
    case 'workEmail': {
      const address = normalizeEmail(term.value)
      const matchesStoredEmail = sql`exists (
        select 1 from jsonb_array_elements(${scimUser.attributes} -> 'emails') as stored_email(item)
        where ${term.field === 'workEmail' ? sql`lower(stored_email.item ->> 'type') = 'work' and` : sql``}
          (
            (stored_email.item ->> 'primary' = 'true' and lower(trim(${user.email})) = ${address})
            or (
              stored_email.item ->> 'primary' is distinct from 'true'
              and lower(trim(stored_email.item ->> 'value')) <> lower(trim(${user.email}))
              and lower(trim(stored_email.item ->> 'value')) = ${address}
            )
          )
      )`
      return term.field === 'email'
        ? sql`(lower(trim(${user.email})) = ${address} or ${matchesStoredEmail})`
        : matchesStoredEmail
    }
    case 'active':
      return term.value.toLowerCase() === 'true'
        ? sql`(${scimUser.active} = true and ${user.suspendedAt} is null)`
        : sql`(${scimUser.active} = false or ${user.suspendedAt} is not null)`
  }
}

const USER_SELECTION = {
  id: scimUser.id,
  userId: scimUser.userId,
  externalId: scimUser.externalId,
  userName: scimUser.userName,
  active: scimUser.active,
  attributes: scimUser.attributes,
  createdAt: scimUser.createdAt,
  updatedAt: scimUser.updatedAt,
  email: user.email,
  userSuspendedAt: user.suspendedAt,
} as const

export interface ScimUserRecord {
  id: string
  userId: string
  externalId: string | null
  userName: string
  active: boolean
  attributes: ScimUserAttributes
  createdAt: Date
  updatedAt: Date
  email: string
  userSuspendedAt: Date | null
}

/** Group memberships for a set of provisioned users, for the `groups` attribute. */
export async function loadGroupsForScimUsers(
  tx: DbOrTx,
  scimUserIds: string[]
): Promise<Map<string, Array<{ id: string; displayName: string }>>> {
  const byUser = new Map<string, Array<{ id: string; displayName: string }>>()
  if (scimUserIds.length === 0) return byUser

  const rows = await tx
    .select({
      scimUserId: scimGroupMember.scimUserId,
      groupId: scimGroup.id,
      displayName: scimGroup.displayName,
    })
    .from(scimGroupMember)
    .innerJoin(scimGroup, eq(scimGroup.id, scimGroupMember.groupId))
    .where(inArray(scimGroupMember.scimUserId, scimUserIds))
    .orderBy(asc(scimGroup.displayName))

  for (const row of rows) {
    const existing = byUser.get(row.scimUserId)
    const entry = { id: row.groupId, displayName: row.displayName }
    if (existing) existing.push(entry)
    else byUser.set(row.scimUserId, [entry])
  }
  return byUser
}

export function toUserResourceRow(
  record: ScimUserRecord,
  groups: Array<{ id: string; displayName: string }>
): UserResourceRow {
  return {
    id: record.id,
    externalId: record.externalId,
    userName: record.userName,
    /**
     * A suspension applied outside the directory — by an administrator during an
     * investigation — is reported as inactive. Answering `true` would tell the
     * directory the person can sign in when they cannot.
     */
    active: record.active && record.userSuspendedAt === null,
    attributes: record.attributes,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    email: record.email,
    groups,
  }
}

export async function findScimUserById(
  tx: DbOrTx,
  connectionId: string,
  scimUserId: string
): Promise<ScimUserRecord | null> {
  const [row] = await tx
    .select(USER_SELECTION)
    .from(scimUser)
    .innerJoin(user, eq(user.id, scimUser.userId))
    .where(and(eq(scimUser.connectionId, connectionId), eq(scimUser.id, scimUserId)))
    .limit(1)
  return row ?? null
}

export async function findScimUserByUserId(
  tx: DbOrTx,
  connectionId: string,
  userId: string
): Promise<ScimUserRecord | null> {
  const [row] = await tx
    .select(USER_SELECTION)
    .from(scimUser)
    .innerJoin(user, eq(user.id, scimUser.userId))
    .where(and(eq(scimUser.connectionId, connectionId), eq(scimUser.userId, userId)))
    .limit(1)
  return row ?? null
}

export interface ScimUserPage {
  records: ScimUserRecord[]
  totalResults: number
}

export async function pageScimUsers(
  tx: DbOrTx,
  params: {
    connectionId: string
    filters: ScimFilterTerm<ScimUserFilterField>[]
    offset: number
    limit: number
  }
): Promise<ScimUserPage> {
  const conditions = [
    eq(scimUser.connectionId, params.connectionId),
    ...params.filters.map(userFilterCondition).filter((value): value is SQL => value !== undefined),
  ]

  const [totalRow] = await tx
    .select({ value: count() })
    .from(scimUser)
    .innerJoin(user, eq(user.id, scimUser.userId))
    .where(and(...conditions))

  /**
   * A page of zero is a real request: Microsoft Entra's connection test asks for
   * the total without any resources. Skipping the row query keeps that cheap.
   */
  const records =
    params.limit === 0
      ? []
      : await tx
          .select(USER_SELECTION)
          .from(scimUser)
          .innerJoin(user, eq(user.id, scimUser.userId))
          .where(and(...conditions))
          .orderBy(asc(scimUser.orderKey))
          .limit(params.limit)
          .offset(params.offset)

  return { records, totalResults: totalRow?.value ?? 0 }
}

/** Refuses a `userName` another resource on this connection already holds. */
export async function assertUserNameAvailable(
  tx: DbOrTx,
  connectionId: string,
  userName: string,
  exceptScimUserId?: string
): Promise<void> {
  const [clash] = await tx
    .select({ id: scimUser.id })
    .from(scimUser)
    .where(and(eq(scimUser.connectionId, connectionId), eq(scimUser.userName, userName)))
    .limit(1)
  if (clash && clash.id !== exceptScimUserId) {
    throw uniqueness(`A user with userName ${userName} already exists in this directory`)
  }
}

export async function insertScimUser(
  tx: DbOrTx,
  params: {
    connectionId: string
    userId: string
    attributes: ScimUserAttributes
    active: boolean
  }
): Promise<{ id: string }> {
  const id = generateId()
  const createdAt = new Date()
  await tx.insert(scimUser).values({
    id,
    connectionId: params.connectionId,
    userId: params.userId,
    externalId: params.attributes.externalId ?? null,
    userName: params.attributes.userName,
    active: params.active,
    attributes: params.attributes,
    orderKey: buildOrderKey(createdAt, id),
    createdAt,
    updatedAt: createdAt,
  })
  return { id }
}

export async function updateScimUser(
  tx: DbOrTx,
  params: { scimUserId: string; attributes: ScimUserAttributes; active: boolean }
): Promise<void> {
  await tx
    .update(scimUser)
    .set({
      externalId: params.attributes.externalId ?? null,
      userName: params.attributes.userName,
      active: params.active,
      attributes: params.attributes,
      updatedAt: new Date(),
    })
    .where(eq(scimUser.id, params.scimUserId))
}

/** All provisioned users on a connection, in pages, for the reconcile job. */
export async function listScimUserIds(
  tx: DbOrTx,
  params: { connectionId: string; afterOrderKey?: string; limit: number }
): Promise<Array<{ id: string; orderKey: string }>> {
  return tx
    .select({ id: scimUser.id, orderKey: scimUser.orderKey })
    .from(scimUser)
    .where(
      and(
        eq(scimUser.connectionId, params.connectionId),
        ...(params.afterOrderKey ? [sql`${scimUser.orderKey} > ${params.afterOrderKey}`] : [])
      )
    )
    .orderBy(asc(scimUser.orderKey))
    .limit(params.limit)
}
