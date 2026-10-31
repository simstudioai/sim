import { db } from '@sim/db'
import { member, memberProfile, user } from '@sim/db/schema'
import { and, asc, count, eq, inArray, isNotNull, isNull, or, type SQL, sql } from 'drizzle-orm'
import type { PersonSummary } from '@/lib/api/contracts/people'
import {
  type CursorKey,
  type KeysetPage,
  keysetOrderBy,
  keysetPage,
  resumeKeyset,
  searchFilter,
  textKey,
} from '@/lib/api/list-query'
import { acquireAdvisoryXactLock, withLockTimeout } from '@/lib/db/advisory-locks'
import type { DbOrTx, DbTransaction } from '@/lib/db/types'
import type { PeopleImportMember } from '@/lib/people/import'
import type { MemberProfileFields } from '@/lib/people/validation'

const PAGE_SIZE = 50
const MAX_CHAIN_DEPTH = 25
const PROFILE_LOCK_TIMEOUT_MS = 5_000
/** Eight bound parameters a row keeps a chunk far below Postgres's 65,535-parameter limit. */
const UPSERT_CHUNK_SIZE = 5_000

export interface PersonRecord extends PersonSummary {
  department: string | null
  location: string | null
  startDate: string | null
  manager: PersonSummary | null
  joinedAt: Date
}

/** Suspended accounts are offboarded people: no read lists them and no write matches them. */
const ACTIVE_USER = isNull(user.suspendedAt)
const SORT_NAME = sql<string>`lower(${user.name})`

const summaryColumns = {
  memberId: member.id,
  userId: user.id,
  name: user.name,
  email: user.email,
  image: user.image,
  title: memberProfile.title,
}

const personColumns = {
  ...summaryColumns,
  sortName: SORT_NAME,
  joinedAt: member.createdAt,
  department: memberProfile.department,
  location: memberProfile.location,
  startDate: memberProfile.startDate,
  managerMemberId: memberProfile.managerMemberId,
}

/** Active members of `organizationId` with whatever profile they have. */
function selectPeople(
  executor: DbOrTx,
  organizationId: string,
  ...conditions: (SQL | undefined)[]
) {
  return executor
    .select(personColumns)
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .leftJoin(memberProfile, eq(memberProfile.memberId, member.id))
    .where(and(eq(member.organizationId, organizationId), ACTIVE_USER, ...conditions))
}

type PersonRow = Awaited<ReturnType<typeof selectPeople>>[number]

const PEOPLE_KEYS = [
  textKey<PersonRow>(SORT_NAME, (row) => row.sortName),
  textKey<PersonRow>(member.id, (row) => row.memberId),
]

/** Active members of `organizationId` by membership id, as they appear beside someone else. */
async function summariesById(
  executor: DbOrTx,
  organizationId: string,
  memberIds: readonly string[]
): Promise<Map<string, PersonSummary>> {
  if (!memberIds.length) return new Map()
  const rows = await executor
    .select(summaryColumns)
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .leftJoin(memberProfile, eq(memberProfile.memberId, member.id))
    .where(
      and(
        eq(member.organizationId, organizationId),
        ACTIVE_USER,
        inArray(member.id, [...memberIds])
      )
    )
  return new Map(rows.map((row) => [row.memberId, row]))
}

/** Joins each person to their manager, read once for the whole page. */
async function withManagers(
  executor: DbOrTx,
  organizationId: string,
  rows: readonly PersonRow[]
): Promise<PersonRecord[]> {
  const managerIds = [...new Set(rows.flatMap((row) => row.managerMemberId ?? []))]
  const managers = await summariesById(executor, organizationId, managerIds)
  return rows.map(({ sortName, managerMemberId, ...row }) => ({
    ...row,
    manager: managerMemberId ? (managers.get(managerMemberId) ?? null) : null,
  }))
}

const SEARCHED_COLUMNS = [
  user.name,
  user.email,
  memberProfile.title,
  memberProfile.department,
  memberProfile.location,
]

/**
 * A page of people by name, then membership id, so equal names still page stably. The page and
 * its managers come from one snapshot, so a manager shown always matches the profile listed.
 */
export async function listPeople(
  organizationId: string,
  {
    search,
    department,
    cursorKeys,
  }: { search?: string; department?: string; cursorKeys?: CursorKey[] }
): Promise<KeysetPage<PersonRecord>> {
  const term = search?.trim() || undefined
  return db.transaction(
    async (tx) => {
      const rows = await selectPeople(
        tx,
        organizationId,
        term ? or(...SEARCHED_COLUMNS.map((column) => searchFilter(column, term))) : undefined,
        department ? eq(memberProfile.department, department) : undefined,
        resumeKeyset(PEOPLE_KEYS, cursorKeys, 'asc')
      )
        .orderBy(...keysetOrderBy(PEOPLE_KEYS, 'asc'))
        .limit(PAGE_SIZE + 1)
      const page = keysetPage(PEOPLE_KEYS, rows, PAGE_SIZE)
      return { ...page, data: await withManagers(tx, organizationId, page.data) }
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' }
  )
}

/** The departments active people belong to, largest first. */
export async function listDepartments(
  organizationId: string
): Promise<{ name: string; count: number }[]> {
  return db
    .select({ name: sql<string>`${memberProfile.department}`, count: count() })
    .from(memberProfile)
    .innerJoin(member, eq(member.id, memberProfile.memberId))
    .innerJoin(user, eq(user.id, member.userId))
    .where(
      and(
        eq(member.organizationId, organizationId),
        ACTIVE_USER,
        isNotNull(memberProfile.department)
      )
    )
    .groupBy(memberProfile.department)
    .orderBy(sql`count(*) desc`, asc(memberProfile.department))
}

export async function getPerson(
  executor: DbOrTx,
  organizationId: string,
  memberId: string
): Promise<PersonRecord | null> {
  const rows = await selectPeople(executor, organizationId, eq(member.id, memberId)).limit(1)
  const [person] = await withManagers(executor, organizationId, rows)
  return person ?? null
}

/**
 * The managers above `memberId`, nearest first, up to {@link MAX_CHAIN_DEPTH} of them. The chain
 * ends at a manager who is suspended or outside the organization, and never revisits anyone.
 */
export async function getReportingChain(
  executor: DbOrTx,
  organizationId: string,
  memberId: string
): Promise<PersonSummary[]> {
  const rows = await executor.execute<PersonSummary>(sql`
    WITH RECURSIVE chain(member_id, depth, path) AS (
      SELECT m.id, 1, ARRAY[p.member_id, m.id]
      FROM member_profile p
      JOIN member m ON m.id = p.manager_member_id AND m.organization_id = ${organizationId}
      JOIN "user" u ON u.id = m.user_id AND u.suspended_at IS NULL
      WHERE p.member_id = ${memberId}
      UNION ALL
      SELECT m.id, c.depth + 1, c.path || m.id
      FROM chain c
      JOIN member_profile p ON p.member_id = c.member_id
      JOIN member m ON m.id = p.manager_member_id AND m.organization_id = ${organizationId}
      JOIN "user" u ON u.id = m.user_id AND u.suspended_at IS NULL
      WHERE NOT m.id = ANY(c.path) AND c.depth < ${MAX_CHAIN_DEPTH}
    )
    SELECT m.id AS "memberId", u.id AS "userId", u.name, u.email, u.image, mp.title
    FROM chain c
    JOIN member m ON m.id = c.member_id
    JOIN "user" u ON u.id = m.user_id
    LEFT JOIN member_profile mp ON mp.member_id = m.id
    ORDER BY c.depth
  `)
  return [...rows]
}

/** The active people who report to `memberId`, by name. */
export async function listDirectReports(
  executor: DbOrTx,
  organizationId: string,
  memberId: string
): Promise<PersonSummary[]> {
  return executor
    .select(summaryColumns)
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .innerJoin(memberProfile, eq(memberProfile.memberId, member.id))
    .where(
      and(
        eq(member.organizationId, organizationId),
        ACTIVE_USER,
        eq(memberProfile.managerMemberId, memberId)
      )
    )
    .orderBy(SORT_NAME, asc(member.id))
}

/**
 * Serializes profile writes in one organization for the rest of `tx`, so a reporting loop
 * can't be assembled from two writes that each checked a chain the other was changing.
 */
export async function lockProfiles(tx: DbTransaction, organizationId: string): Promise<void> {
  await withLockTimeout(tx, PROFILE_LOCK_TIMEOUT_MS, () =>
    acquireAdvisoryXactLock(tx, 'member_profiles', `member-profiles:${organizationId}`)
  )
}

/** Which of `memberIds` are active members of `organizationId`. */
export async function findActiveMembers(
  tx: DbTransaction,
  organizationId: string,
  memberIds: readonly string[]
): Promise<Set<string>> {
  return new Set((await summariesById(tx, organizationId, memberIds)).keys())
}

/**
 * Whether `memberId` is `managerMemberId` or among the managers above them: the loop that making
 * `managerMemberId` the manager of `memberId` would close. Walks stored profiles without
 * revisiting anyone, so a loop already in the data can't trap it.
 */
export async function isInReportingChain(
  tx: DbTransaction,
  memberId: string,
  managerMemberId: string
): Promise<boolean> {
  const [row] = await tx.execute<{ found: boolean }>(sql`
    WITH RECURSIVE chain(member_id, path) AS (
      SELECT ${managerMemberId}::text, ARRAY[${managerMemberId}::text]
      UNION ALL
      SELECT p.manager_member_id, c.path || p.manager_member_id
      FROM chain c
      JOIN member_profile p ON p.member_id = c.member_id
      WHERE p.manager_member_id IS NOT NULL AND NOT p.manager_member_id = ANY(c.path)
    )
    SELECT EXISTS (SELECT 1 FROM chain WHERE member_id = ${memberId}) AS found
  `)
  return row?.found === true
}

/**
 * Every member with the email they are matched by, their stored profile, and whether they are
 * active: a suspended member's reporting lines still close loops.
 */
export async function listMemberProfiles(
  executor: DbOrTx,
  organizationId: string
): Promise<PeopleImportMember[]> {
  const rows = await executor
    .select({
      memberId: member.id,
      email: user.email,
      title: memberProfile.title,
      department: memberProfile.department,
      location: memberProfile.location,
      startDate: memberProfile.startDate,
      managerMemberId: memberProfile.managerMemberId,
      hasProfile: sql<boolean>`${memberProfile.memberId} IS NOT NULL`,
      active: sql<boolean>`${user.suspendedAt} IS NULL`,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .leftJoin(memberProfile, eq(memberProfile.memberId, member.id))
    .where(eq(member.organizationId, organizationId))
  return rows.map(({ memberId, email, hasProfile, active, ...profile }) => ({
    memberId,
    email,
    active,
    profile: hasProfile ? profile : null,
  }))
}

/** Writes complete profiles, creating them for members who had none. */
export async function upsertProfiles(
  tx: DbTransaction,
  profiles: readonly (MemberProfileFields & { memberId: string })[],
  updatedBy: string
): Promise<void> {
  const updatedAt = new Date()
  for (let start = 0; start < profiles.length; start += UPSERT_CHUNK_SIZE) {
    await tx
      .insert(memberProfile)
      .values(
        profiles
          .slice(start, start + UPSERT_CHUNK_SIZE)
          .map((profile) => ({ ...profile, updatedBy, updatedAt }))
      )
      .onConflictDoUpdate({
        target: memberProfile.memberId,
        set: {
          title: sql`excluded.title`,
          department: sql`excluded.department`,
          location: sql`excluded.location`,
          startDate: sql`excluded.start_date`,
          managerMemberId: sql`excluded.manager_member_id`,
          updatedBy: sql`excluded.updated_by`,
          updatedAt: sql`excluded.updated_at`,
        },
      })
  }
}
