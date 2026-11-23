import { db } from '@sim/db'
import {
  foldedEmail,
  member,
  memberProfile,
  peopleDirectoryEntry,
  peopleDirectorySync,
  scimConnection,
  scimUser,
  user,
} from '@sim/db/schema'
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { PEOPLE_IMPORT_MAX_ROWS, type Person, type PersonSummary } from '@/lib/api/contracts/people'
import {
  type CursorKey,
  type KeysetPage,
  keysetOrderBy,
  keysetPage,
  resumeKeyset,
  searchFilter,
  textKey,
} from '@/lib/api/list-query'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { acquireAdvisoryXactLock, withLockTimeout } from '@/lib/db/advisory-locks'
import type { DbOrTx, DbTransaction } from '@/lib/db/types'
import type { PeopleImportMember } from '@/lib/people/import'
import type { MemberProfileFields } from '@/lib/people/validation'

const PAGE_SIZE = 50
const MAX_CHAIN_DEPTH = 25
const PROFILE_LOCK_TIMEOUT_MS = 5_000
/** Eight bound parameters a row keeps a chunk far below Postgres's 65,535-parameter limit. */
const UPSERT_CHUNK_SIZE = 5_000

type PersonRow = Omit<Person, 'joinedAt' | 'departmentKey'> & {
  joinedMs: number | null
  sortName: string
}

export type PersonRecord = Omit<Person, 'joinedAt' | 'departmentKey'> & { joinedAt: Date | null }

const ACTIVE_USER = isNull(user.suspendedAt)
const SUMMARY_FIELDS = sql`p.id AS "memberId", p.user_id AS "userId", p.name, p.email, p.image, p.title`

/** Hide retired SCIM identities immediately while the previous snapshot awaits cleanup. */
function visibleDirectoryEntry(organizationId: string) {
  return sql`(d.source <> 'scim' OR EXISTS (
    SELECT 1 FROM ${scimUser} su JOIN ${user} account ON account.id = su.user_id
    WHERE su.id = d.external_id AND su.active AND account.suspended_at IS NULL
      AND su.connection_id = (SELECT c.id FROM ${peopleDirectorySync} s
        JOIN ${scimConnection} c ON c.id = s.source_target AND c.organization_id = s.organization_id
        WHERE s.organization_id = ${organizationId} AND s.source = 'scim')
  ))`
}

/** Compact identity/manager edges. Names, avatars, and other profile data are joined only when needed. */
function identityRelations(organizationId: string) {
  return sql`
    identities AS (
      SELECT m.id AS member_id, NULL::text AS directory_id, NULL::text AS external_id,
        NULL::text AS manager_external_id, lower(u.name) AS sort_name, ${foldedEmail(sql`u.email`)} AS email,
        u.suspended_at IS NOT NULL AS suspended
      FROM ${member} m CROSS JOIN LATERAL (
        SELECT name, email, suspended_at FROM ${user} WHERE id = m.user_id LIMIT 1
      ) u WHERE m.organization_id = ${organizationId}
      UNION ALL
      SELECT NULL, d.id, d.external_id, d.manager_external_id, lower(d.name), d.email, false
      FROM ${peopleDirectoryEntry} d WHERE d.organization_id = ${organizationId} AND ${visibleDirectoryEntry(organizationId)}
    ),
    matched AS (
      SELECT i.*, count(member_id) OVER address AS member_count, max(member_id) OVER address AS match_id,
        bool_or(suspended) OVER address AS has_suspended, bool_or(directory_id IS NOT NULL) OVER address AS has_entry
      FROM identities i WINDOW address AS (PARTITION BY email)
    ),
    directory AS (
      SELECT directory_id AS id, external_id, manager_external_id, sort_name,
        CASE WHEN member_count = 1 THEN match_id END AS member_id
      FROM matched WHERE directory_id IS NOT NULL AND NOT has_suspended
    ),
    directory_links AS (
      SELECT d.id, d.member_id, d.sort_name, ref.child,
        max(CASE WHEN NOT ref.child THEN coalesce(d.member_id,d.id) END) OVER (PARTITION BY ref.key) AS manager_id
      FROM directory d CROSS JOIN LATERAL (VALUES (d.external_id,false), (d.manager_external_id,true)) ref(key,child)
    ),
    links AS (
      SELECT coalesce(d.member_id,d.id) AS id, d.member_id, d.id AS directory_id, d.manager_id, d.sort_name
      FROM directory_links d WHERE d.child
      UNION ALL
      SELECT a.member_id, a.member_id, NULL, mp.manager_member_id, a.sort_name
      FROM matched a LEFT JOIN ${memberProfile} mp ON mp.member_id = a.member_id
      WHERE a.member_id IS NOT NULL AND NOT a.suspended AND NOT (a.has_entry AND a.member_count = 1)
    )
  `
}

/** A leader has visible reports and no visible manager, including when their stored manager is suspended. */
const ROOT_LINKS = sql`
  root_links AS (
    SELECT id, member_id, directory_id, manager_id, sort_name FROM (
      SELECT l.*, ref.self, bool_or(ref.self) OVER node AS present, bool_or(NOT ref.self) OVER node AS has_reports
      FROM links l CROSS JOIN LATERAL (VALUES (l.id,true), (l.manager_id,false)) ref(key,self)
      WINDOW node AS (PARTITION BY ref.key)
    ) nodes GROUP BY id, member_id, directory_id, manager_id, sort_name
    HAVING bool_or(self AND has_reports) AND NOT bool_or(NOT self AND present)
  ),
`

function profileRelations(source = sql`links`) {
  return sql`
    people AS (
      SELECT l.*, m.user_id, d.source, coalesce(d.name,u.name) AS name, coalesce(d.email,u.email) AS email,
        u.image, CASE WHEN d.id IS NULL THEN mp.title ELSE d.title END AS title,
        CASE WHEN d.id IS NULL THEN mp.department ELSE d.department END AS department,
        CASE WHEN d.source = 'scim' THEN coalesce(d.location, mp.location)
          WHEN d.id IS NULL THEN mp.location ELSE d.location END AS location,
        mp.start_date, m.created_at AS joined_at
      FROM ${source} l
      LEFT JOIN LATERAL (SELECT user_id, created_at FROM ${member} WHERE id = l.member_id LIMIT 1) m ON true
      LEFT JOIN LATERAL (SELECT name, email, image FROM ${user} WHERE id = m.user_id LIMIT 1) u ON true
      LEFT JOIN ${peopleDirectoryEntry} d ON d.id = l.directory_id
      LEFT JOIN ${memberProfile} mp ON mp.member_id = l.member_id
    ),
    summaries AS (SELECT ${SUMMARY_FIELDS} FROM people p)
  `
}

const PERSON_FIELDS = sql`${SUMMARY_FIELDS}, lower(p.name) AS "sortName",
  p.department, p.location, p.start_date::text AS "startDate", p.source AS "directorySource",
  p.manager_id AS "managerMemberId", to_jsonb(manager) AS manager,
  (extract(epoch from p.joined_at) * 1000)::float8 AS "joinedMs"`

const PEOPLE_KEYS = [
  textKey<PersonRow>(sql`lower(p.name)`, (row) => row.sortName),
  textKey<PersonRow>(sql`p.id`, (row) => row.memberId),
]

function toPerson({ joinedMs, sortName, ...row }: PersonRow): PersonRecord {
  return { ...row, joinedAt: joinedMs === null ? null : new Date(joinedMs) }
}

export async function listPeople(
  organizationId: string,
  {
    search,
    department,
    departmentKey,
    scope,
    cursorKeys,
  }: {
    search?: string
    department?: string
    departmentKey?: string
    scope?: 'roots' | 'members'
    cursorKeys?: CursorKey[]
  }
): Promise<KeysetPage<PersonRecord> & { selectedDepartment: string | null }> {
  if (departmentKey && department)
    throw new OrchestrationError('validation', 'Choose a department by name or by key.')
  if (cursorKeys?.length === 1 && typeof cursorKeys[0] === 'string') {
    const [anchor] = await db.execute<{ name: string }>(sql`
      WITH ${identityRelations(organizationId)} SELECT sort_name AS name FROM links WHERE id=${cursorKeys[0]}
    `)
    if (!anchor)
      throw new OrchestrationError(
        'validation',
        'This page changed. Restart pagination without a cursor.'
      )
    cursorKeys = [anchor.name, cursorKeys[0]]
  }
  const departmentFilter = departmentKey
    ? eq(sql`encode(sha256(convert_to(p.department,'UTF8')),'hex')`, departmentKey)
    : department
      ? eq(sql`p.department`, department)
      : undefined
  const term = search?.trim() || undefined
  const where = and(
    term
      ? or(
          ...[sql`p.name`, sql`p.email`, sql`p.title`, sql`p.department`, sql`p.location`].map(
            (column) => searchFilter(column, term)
          )
        )
      : undefined,
    departmentFilter,
    scope === 'members' ? sql`p.user_id IS NOT NULL` : undefined,
    resumeKeyset(PEOPLE_KEYS, cursorKeys, 'asc')
  )
  const roots = scope === 'roots'
  const rows = await db.execute<PersonRow>(sql`
    WITH ${identityRelations(organizationId)}, ${roots ? ROOT_LINKS : sql``}
      ${profileRelations(roots ? sql`root_links` : sql`links`)},
    page AS MATERIALIZED (
      SELECT p.* FROM people p ${where ? sql`WHERE ${where}` : sql``}
      ORDER BY ${sql.join(keysetOrderBy(PEOPLE_KEYS, 'asc'), sql`, `)} LIMIT ${PAGE_SIZE + 1}
    )
    SELECT ${PERSON_FIELDS}
    FROM page p LEFT JOIN summaries manager ON manager."memberId" = p.manager_id
    ORDER BY ${sql.join(keysetOrderBy(PEOPLE_KEYS, 'asc'), sql`, `)}
  `)
  const page = keysetPage(PEOPLE_KEYS, rows, PAGE_SIZE)
  let selectedDepartment = department ?? rows[0]?.department ?? null
  if (departmentKey && !rows.length && !cursorKeys) {
    const [selected] = await db.execute<{ name: string }>(sql`
      WITH ${identityRelations(organizationId)}, ${profileRelations()}
      SELECT p.department AS name FROM people p WHERE ${departmentFilter} LIMIT 1
    `)
    selectedDepartment = selected?.name ?? null
  }
  const keys = page.nextCursorKeys
  // Oversized names resume from the same member in the scoped directory without sending the name in a URL.
  const nextCursorKeys = keys && Buffer.byteLength(JSON.stringify(keys)) > 512 ? [keys[1]] : keys
  return {
    data: page.data.map(toPerson),
    nextCursorKeys,
    selectedDepartment: department || departmentKey ? selectedDepartment : null,
  }
}

type Department = { name: string; count: number }

export async function listDepartments(
  organizationId: string,
  { search, offset = 0 }: { search?: string; offset?: number }
) {
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw new OrchestrationError('validation', 'Invalid department page offset.')
  const term = search?.trim()
  const rows = await db.execute<Department>(sql`
    WITH ${identityRelations(organizationId)}, ${profileRelations()}
    SELECT p.department AS name, count(*)::int AS count FROM people p
    WHERE p.department IS NOT NULL ${term ? sql`AND ${searchFilter(sql`p.department`, term)}` : sql``}
    GROUP BY p.department ORDER BY count DESC, p.department LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}
  `)
  return {
    data: rows.slice(0, PAGE_SIZE),
    nextOffset: rows.length > PAGE_SIZE ? offset + PAGE_SIZE : null,
  }
}

export async function getPerson(
  executor: DbOrTx,
  organizationId: string,
  memberId: string
): Promise<PersonRecord | null> {
  const [row] = await executor.execute<PersonRow>(sql`
    WITH ${identityRelations(organizationId)}, ${profileRelations()}
    SELECT ${PERSON_FIELDS}
    FROM people p LEFT JOIN summaries manager ON manager."memberId" = p.manager_id
    WHERE p.id = ${memberId} OR p.directory_id = ${memberId} LIMIT 1
  `)
  return row ? toPerson(row) : null
}

/** Resolves an account or directory ID once, then pages and traverses only that canonical person's neighborhood. */
export async function getChartBranch(
  tx: DbTransaction,
  organizationId: string,
  focus: { memberId: string } | { userId: string },
  requestedPage: number,
  size: number
) {
  type BranchRow = {
    person: PersonRow
    chain: PersonSummary[]
    reports: (PersonSummary & { department: string | null; reportCount: number })[]
    totalReports: number
    page: number
  }
  const predicate =
    'memberId' in focus
      ? sql`l.member_id = ${focus.memberId} OR l.directory_id = ${focus.memberId}`
      : sql`l.member_id = (SELECT m.id FROM ${member} m WHERE m.organization_id = ${organizationId} AND m.user_id = ${focus.userId} LIMIT 1)`
  const [row] = await tx.execute<BranchRow>(sql`
    WITH RECURSIVE ${identityRelations(organizationId)},
    focus AS (SELECT l.* FROM links l WHERE ${predicate} LIMIT 1),
    native_ancestors(id, depth) AS (
      SELECT member_id, 0 FROM focus WHERE member_id IS NOT NULL
      UNION ALL
      SELECT p.manager_member_id, n.depth + 1 FROM native_ancestors n JOIN ${memberProfile} p ON p.member_id = n.id
      JOIN ${member} m ON m.id = p.manager_member_id AND m.organization_id = ${organizationId}
      WHERE n.depth < ${MAX_CHAIN_DEPTH}
    ),
    source_ancestors(id, parent, depth) AS (
      SELECT d.id, d.manager_external_id, 0 FROM directory d
      WHERE d.id = (SELECT directory_id FROM focus) OR d.member_id IN (SELECT id FROM native_ancestors)
      UNION ALL
      SELECT d.id, d.manager_external_id, a.depth + 1 FROM source_ancestors a
      CROSS JOIN LATERAL (
        SELECT d.id, d.manager_external_id FROM ${peopleDirectoryEntry} d
        WHERE d.organization_id = ${organizationId} AND d.external_id = a.parent AND ${visibleDirectoryEntry(organizationId)} LIMIT 1
      ) d WHERE a.depth < ${MAX_CHAIN_DEPTH}
    ),
    ancestor_links AS MATERIALIZED (
      SELECT l.id, l.manager_id FROM links l
      WHERE l.member_id IN (SELECT id FROM native_ancestors) OR l.directory_id IN (SELECT id FROM source_ancestors)
    ),
    chain(id, depth, path) AS (
      SELECT f.manager_id, 1, ARRAY[f.id, f.manager_id] FROM focus f
      WHERE f.manager_id IS NOT NULL AND f.manager_id <> f.id
      UNION ALL
      SELECT l.manager_id, c.depth + 1, c.path || l.manager_id FROM chain c JOIN ancestor_links l ON l.id = c.id
      WHERE l.manager_id IS NOT NULL AND NOT l.manager_id = ANY(c.path) AND c.depth < ${MAX_CHAIN_DEPTH}
    ),
    direct AS (SELECT l.id, l.sort_name FROM links l JOIN focus f ON f.id = l.manager_id),
    pagination AS (
      SELECT count(*)::int AS total,
        least(${requestedPage}::int, greatest(1, ceil(count(*)::numeric / ${size})::int)) AS page
      FROM direct
    ),
    report_page AS (
      SELECT r.id FROM direct r ORDER BY r.sort_name, r.id LIMIT ${size} OFFSET (SELECT (page - 1) * ${size} FROM pagination)
    ),
    selected AS (SELECT id FROM focus UNION SELECT id FROM chain UNION SELECT id FROM report_page),
    selected_links AS MATERIALIZED (SELECT l.* FROM links l JOIN selected s ON s.id = l.id LIMIT ${1 + size + MAX_CHAIN_DEPTH}),
    ${profileRelations(sql`selected_links`)},
    person AS (
      SELECT ${PERSON_FIELDS} FROM people p JOIN focus f ON f.id = p.id
      LEFT JOIN summaries manager ON manager."memberId" = p.manager_id
    ),
    counts AS (
      SELECT r.id, count(l.id)::int AS total FROM report_page r LEFT JOIN links l ON l.manager_id = r.id GROUP BY r.id
    ),
    reports AS (
      SELECT ${SUMMARY_FIELDS}, p.department, c.total AS "reportCount" FROM people p JOIN counts c ON c.id = p.id
    )
    SELECT to_jsonb(person) AS person, pg.page, pg.total AS "totalReports",
      coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY c.depth) FROM chain c JOIN summaries s ON s."memberId" = c.id), '[]') AS chain,
      coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY lower(r.name), r."memberId") FROM reports r), '[]') AS reports
    FROM person CROSS JOIN pagination pg
  `)
  return row ? { ...row, person: toPerson(row.person) } : null
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
  if (!memberIds.length) return new Set()
  const rows = await tx
    .select({ id: member.id })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(
      and(
        eq(member.organizationId, organizationId),
        ACTIVE_USER,
        inArray(member.id, [...memberIds])
      )
    )
  return new Set(rows.map((row) => row.id))
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

/** One input row can name both a member and a manager. Ancestor-only links have a separate budget. */
const MAX_IMPORT_LOOKUP_ROWS = 2 * PEOPLE_IMPORT_MAX_ROWS

/**
 * Reads only the active members an import can match. The separate manager graph includes suspended
 * intermediates, but their email and profile fields never enter matching. UNION visits an ancestor
 * once even if several proposed managers share a chain or a legacy reporting line is cyclic.
 */
export async function listMemberProfiles(
  executor: DbOrTx,
  organizationId: string,
  emails: readonly string[],
  managerEmails: readonly string[]
) {
  const requested = [...new Set([...emails, ...managerEmails])]
  const managerAddresses = new Set(managerEmails)
  const query = executor
    .select({
      memberId: member.id,
      email: foldedEmail(user.email),
      title: memberProfile.title,
      department: memberProfile.department,
      location: memberProfile.location,
      startDate: memberProfile.startDate,
      managerMemberId: memberProfile.managerMemberId,
      hasProfile: sql<boolean>`${memberProfile.memberId} IS NOT NULL`,
      directoryManaged: sql<boolean>`EXISTS (SELECT 1 FROM ${peopleDirectoryEntry} d
        WHERE d.organization_id = ${organizationId} AND d.email = ${foldedEmail(user.email)} AND ${visibleDirectoryEntry(organizationId)}
          AND NOT EXISTS (
            SELECT 1 FROM ${member} other_member JOIN ${user} other_user ON other_user.id = other_member.user_id
            WHERE other_member.organization_id = ${organizationId} AND other_member.id <> ${member.id}
              AND ${foldedEmail(sql`other_user.email`)} = d.email
          ))`,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .leftJoin(memberProfile, eq(memberProfile.memberId, member.id))
    .where(
      and(
        eq(member.organizationId, organizationId),
        ACTIVE_USER,
        inArray(foldedEmail(user.email), requested)
      )
    )
    .limit(MAX_IMPORT_LOOKUP_ROWS + 1)
  const rows = requested.length ? await query : []
  if (rows.length > MAX_IMPORT_LOOKUP_ROWS) {
    throw new OrchestrationError(
      'validation',
      'Too many matching member profiles. Split the import into smaller batches.'
    )
  }

  const members: PeopleImportMember[] = rows.map(
    ({ memberId, email, hasProfile, directoryManaged, ...profile }) => ({
      memberId,
      email,
      directoryManaged,
      profile: hasProfile ? profile : null,
    })
  )
  const parentByAddress = new Map<string, string | null>()
  for (const row of rows) {
    if (managerAddresses.has(row.email)) {
      parentByAddress.set(row.email, parentByAddress.has(row.email) ? null : row.managerMemberId)
    }
  }
  const parents = [...new Set(parentByAddress.values())].filter((id) => id !== null)
  const managerLinks = parents.length
    ? await executor.execute<{ memberId: string; managerMemberId: string | null }>(sql`
        WITH RECURSIVE lineage(member_id, manager_member_id) AS (
          SELECT m.id, p.manager_member_id FROM ${member} m
          LEFT JOIN ${memberProfile} p ON p.member_id = m.id
          WHERE m.organization_id = ${organizationId} AND ${inArray(sql`m.id`, parents)}
          UNION
          SELECT m.id, p.manager_member_id FROM lineage l
          JOIN ${member} m ON m.id = l.manager_member_id AND m.organization_id = ${organizationId}
          LEFT JOIN ${memberProfile} p ON p.member_id = m.id
        )
        SELECT member_id AS "memberId", manager_member_id AS "managerMemberId"
        FROM lineage LIMIT ${MAX_IMPORT_LOOKUP_ROWS + 1}
      `)
    : []
  if (managerLinks.length > MAX_IMPORT_LOOKUP_ROWS) {
    throw new OrchestrationError(
      'validation',
      'The managers in this import span too many reporting lines. Import smaller batches of managers or update reporting lines separately.'
    )
  }
  return { members, managerLinks }
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
