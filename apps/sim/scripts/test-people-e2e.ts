import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { assertDisposableTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId, generateShortId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { makeSignature } from 'better-auth/crypto'
import postgres from 'postgres'

/**
 * Exercises the People page's API over real HTTP against a running local app (with
 * `PEOPLE=true`) and a disposable local PostgreSQL database. SQL seeds organizations and their
 * members; every import, edit, and read crosses the real app boundary, and membership changes
 * are made in SQL to prove the database keeps profiles and reporting lines consistent.
 */
const logger = createLogger('PeopleE2E')

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  assert(value, `${name} must be explicitly provided`)
  return value
}

const baseUrl = new URL(requiredEnvironment('PEOPLE_E2E_BASE_URL'))
const databaseUrl = assertDisposableTestDatabaseUrl(requiredEnvironment('PEOPLE_E2E_DATABASE_URL'))
const authSecret = requiredEnvironment('PEOPLE_E2E_AUTH_SECRET')
const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
assert(loopbackHosts.has(baseUrl.hostname), 'The app must use a loopback host')
assert.equal(baseUrl.protocol, 'http:', 'The app must use local HTTP')
assert.equal(baseUrl.pathname, '/', 'App URL must be an origin without a path')
assert(!baseUrl.username && !baseUrl.password, 'App URL must not contain credentials')
assert(authSecret.length >= 32, 'Use a local auth secret of at least 32 characters')

const sql = postgres(databaseUrl.toString(), { max: 2 })
const organizationIds: string[] = []
const userIds: string[] = []
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []
const startedAt = new Date().toISOString()
let requestCount = 0

interface Member {
  userId: string
  memberId: string
  orgId: string
  email: string
  cookie: string
}

async function api(
  member: Member,
  path: string,
  { method = 'GET', body, expected = 200 }: { method?: string; body?: unknown; expected?: number }
): Promise<Record<string, unknown>> {
  const headers = new Headers({ 'User-Agent': 'Sim-local-people-E2E', Origin: baseUrl.origin })
  headers.set('Cookie', `better-auth.session_token=${member.cookie}`)
  if (body !== undefined) headers.set('Content-Type', 'application/json')
  const response = await fetch(
    new URL(`/api/organizations/${member.orgId}/people${path}`, baseUrl),
    {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
      signal: AbortSignal.timeout(120_000),
    }
  )
  requestCount++
  const text = await response.text()
  assert.equal(response.status, expected, `${method} ${path}: ${response.status} ${text}`)
  const parsed: unknown = text ? JSON.parse(text) : {}
  assert(isRecordLike(parsed), 'Expected a JSON object')
  return parsed
}

function importRows(member: Member, csv: string, apply: boolean, expected = 200) {
  const [headerLine, ...lines] = csv.trim().split('\n')
  const headers = headerLine.split(',')
  const rows = lines.map((line) => line.split(','))
  return api(member, '/import', { method: 'POST', body: { headers, rows, apply }, expected })
}

async function person(member: Member, memberId: string) {
  const result = await api(member, `/${memberId}`, {})
  assert(isRecordLike(result.person), 'Expected a person')
  return result as {
    person: Record<string, unknown> & { manager: { memberId: string } | null }
    chain: { memberId: string }[]
    reports: { memberId: string }[]
  }
}

async function profileRow(memberId: string) {
  const [row] = await sql<
    { title: string | null; department: string | null; manager_member_id: string | null }[]
  >`select title, department, manager_member_id from member_profile where member_id = ${memberId}`
  return row ?? null
}

async function check(name: string, run: () => Promise<void>) {
  const started = performance.now()
  try {
    await run()
    checks.push({ name, status: 'passed', durationMs: Math.round(performance.now() - started) })
    logger.info(`PASS ${name}`)
  } catch (error) {
    checks.push({
      name,
      status: 'failed',
      durationMs: Math.round(performance.now() - started),
      error: getErrorMessage(error),
    })
    throw error
  }
}

async function seedOrganization(): Promise<string> {
  const orgId = generateId()
  organizationIds.push(orgId)
  await sql`insert into organization (id, name, slug, created_at)
    values (${orgId}, 'People E2E', ${`people-e2e-${generateShortId().toLowerCase()}`}, now())`
  return orgId
}

async function seedMember(
  orgId: string,
  role: 'owner' | 'admin' | 'member',
  label: string
): Promise<Member> {
  const userId = generateId()
  const memberId = generateId()
  userIds.push(userId)
  const email = `${label}-${userId.slice(0, 8)}@people-e2e.test`
  const token = generateShortId()
  await sql.begin(async (tx) => {
    await tx`insert into "user" (id, name, email, normalized_email, email_verified, created_at, updated_at)
      values (${userId}, ${label}, ${email}, ${email}, true, now(), now())`
    await tx`insert into user_stats (id, user_id) values (${generateId()}, ${userId})`
    await tx`insert into member (id, user_id, organization_id, role)
      values (${memberId}, ${userId}, ${orgId}, ${role})`
    await tx`insert into session (id, token, user_id, active_organization_id, expires_at, created_at, updated_at)
      values (${generateId()}, ${token}, ${userId}, ${orgId}, now() + interval '1 day', now(), now())`
  })
  return {
    userId,
    memberId,
    orgId,
    email,
    cookie: encodeURIComponent(`${token}.${await makeSignature(token, authSecret)}`),
  }
}

async function run() {
  const orgId = await seedOrganization()
  const owner = await seedMember(orgId, 'owner', 'Grace')
  const ada = await seedMember(orgId, 'member', 'Ada')
  const linus = await seedMember(orgId, 'member', 'Linus')
  const outsider = await seedMember(await seedOrganization(), 'owner', 'Outsider')

  await check('members see everyone in their organization, and no one else does', async () => {
    const { people } = await api(ada, '', {})
    assert(Array.isArray(people) && people.length === 3, `Expected 3 people, got ${people}`)
    assert.deepEqual((await api(ada, '/departments', {})).departments, [])
    await api({ ...outsider, orgId }, '', { expected: 404 })
    await api({ ...outsider, orgId }, `/${ada.memberId}`, { expected: 404 })
    await api(outsider, `/${ada.memberId}`, { expected: 404 })
  })

  await check('only administrators import or edit people data', async () => {
    await importRows(ada, `email,title\n${ada.email},Engineer`, false, 403)
    await api(ada, `/${ada.memberId}`, {
      method: 'PUT',
      body: {
        title: 'x',
        department: null,
        location: null,
        startDate: null,
        managerMemberId: null,
      },
      expected: 403,
    })
  })

  const csv = [
    'Work Email,Job Title,Dept,City,Country,Hire Date,Manager Email',
    `${ada.email.toUpperCase()},Engineer,Platform,Berlin,Germany,3/4/2021,${owner.email}`,
    `${linus.email},Kernel Lead,Platform,,Finland,2019-07-01,${ada.email}`,
    `${owner.email},CEO,Leadership,Austin,United States,2018-01-15,`,
    `stranger@people-e2e.test,Ghost,Nowhere,,,,`,
    `${ada.email},Duplicate,Platform,,,,`,
    `${outsider.email},Spy,Leadership,,,,`,
    `not-an-email,X,Y,,,,`,
    `${linus.email.toUpperCase()},Again,,,,,`,
  ].join('\n')

  await check('a preview reports every change and issue and writes nothing', async () => {
    const preview = await importRows(owner, csv, false)
    assert.equal(preview.applied, false)
    assert.equal(preview.updated, 3)
    assert.equal(preview.skipped, 5)
    assert.equal(preview.warnings, 0)
    assert.deepEqual(
      (preview.issues as { row: number; message: string }[]).map((issue) => [
        issue.row,
        issue.message,
      ]),
      [
        [5, 'Not a member of this organization'],
        [6, 'Already listed in row 2'],
        [7, 'Not a member of this organization'],
        [8, 'Enter a valid email address'],
        [9, 'Already listed in row 3'],
      ]
    )
    assert.equal(await profileRow(ada.memberId), null)
  })

  await check(
    'applying writes profiles, resolves managers by email, and is idempotent',
    async () => {
      const applied = await importRows(owner, csv, true)
      assert.equal(applied.updated, 3)
      const adaProfile = await person(owner, ada.memberId)
      assert.equal(adaProfile.person.title, 'Engineer')
      assert.equal(adaProfile.person.location, 'Berlin, Germany')
      assert.equal(adaProfile.person.startDate, '2021-03-04')
      assert.equal(adaProfile.person.manager?.memberId, owner.memberId)
      assert.equal(await profileRow(outsider.memberId), null)
      const again = await importRows(owner, csv, true)
      assert.equal(again.updated, 0)
      assert.equal(again.unchanged, 3)
    }
  )

  await check('profiles show the reporting chain above and the reports below', async () => {
    const linusProfile = await person(ada, linus.memberId)
    assert.deepEqual(
      linusProfile.chain.map((entry) => entry.memberId),
      [ada.memberId, owner.memberId]
    )
    const ownerProfile = await person(ada, owner.memberId)
    assert.deepEqual(
      ownerProfile.reports.map((entry) => entry.memberId),
      [ada.memberId]
    )
  })

  await check('search and department filters narrow the list', async () => {
    const { departments } = await api(ada, '/departments', {})
    assert.deepEqual(departments, [
      { name: 'Platform', count: 2 },
      { name: 'Leadership', count: 1 },
    ])
    const platform = await api(ada, '?department=Platform', {})
    assert.equal((platform.people as unknown[]).length, 2)
    const kernel = await api(ada, '?search=kernel', {})
    assert.equal((kernel.people as unknown[]).length, 1)
    await api(ada, '?cursor=not-a-cursor', { expected: 400 })
  })

  await check('reporting loops and foreign managers are refused', async () => {
    const body = { title: 'CEO', department: 'Leadership', location: null, startDate: null }
    for (const [managerMemberId, message] of [
      [linus.memberId, 'That manager reports to this person'],
      [owner.memberId, "A person can't be their own manager"],
      [outsider.memberId, 'The manager must be a member of this organization'],
    ]) {
      const refused = await api(owner, `/${owner.memberId}`, {
        method: 'PUT',
        body: { ...body, managerMemberId },
        expected: 400,
      })
      assert.equal(refused.error, message)
    }
    const loop = await importRows(owner, `email,manager_email\n${owner.email},${linus.email}`, true)
    assert.equal(loop.updated, 0)
    assert.equal(loop.warnings, 1)
    assert.equal((await profileRow(owner.memberId))?.manager_member_id, null)
  })

  await check('an edit replaces the profile and blank values clear it', async () => {
    await api(owner, `/${linus.memberId}`, {
      method: 'PUT',
      body: {
        title: '  Principal Engineer ',
        department: '',
        location: null,
        startDate: '2019-07-01',
        managerMemberId: owner.memberId,
      },
    })
    const row = await profileRow(linus.memberId)
    assert.equal(row?.title, 'Principal Engineer')
    assert.equal(row?.department, null)
    assert.equal(row?.manager_member_id, owner.memberId)
  })

  await check(
    'leaving the organization removes the profile and clears reporting lines',
    async () => {
      await sql`delete from member where id = ${owner.memberId}`
      assert.equal(await profileRow(owner.memberId), null)
      assert.equal((await profileRow(ada.memberId))?.manager_member_id, null)
      assert.equal((await profileRow(linus.memberId))?.manager_member_id, null)
    }
  )

  await check('imports and edits are audited', async () => {
    const expected = { 'org_people.imported': 3, 'org_member.profile_updated': 1 }
    let counts: Record<string, number> = {}
    for (let attempt = 0; attempt < 20; attempt++) {
      const rows = await sql<
        { action: string; count: number }[]
      >`select action, count(*)::int as count
        from audit_log where resource_id = ${orgId} and action in ${sql(Object.keys(expected))}
        group by action`
      counts = Object.fromEntries(rows.map((row) => [row.action, row.count]))
      if (Object.entries(expected).every(([action, count]) => counts[action] === count)) break
      await sleep(250)
    }
    assert.deepEqual(counts, expected, 'Previews are not audited; each apply and edit is')
  })
}

async function cleanup() {
  if (organizationIds.length) {
    await sql`delete from audit_log where resource_id in ${sql(organizationIds)}`
    await sql`delete from organization where id in ${sql(organizationIds)}`
  }
  if (userIds.length) await sql`delete from "user" where id in ${sql(userIds)}`
}

try {
  await run()
} catch (error) {
  logger.error('People E2E failed', { error: getErrorMessage(error) })
  process.exitCode = 1
} finally {
  try {
    await cleanup()
  } catch (error) {
    logger.error('People E2E fixture cleanup failed', { error: getErrorMessage(error) })
    process.exitCode = 1
  }
  await sql.end()
  const report = {
    startedAt,
    completedAt: new Date().toISOString(),
    status: process.exitCode ? 'failed' : 'passed',
    transport: 'Real HTTP against a local Next.js app and PostgreSQL',
    requestCount,
    checks,
  }
  if (process.env.PEOPLE_E2E_REPORT_PATH) {
    await writeFile(process.env.PEOPLE_E2E_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
  }
  logger.info(
    `People E2E ${report.status}: ${checks.filter((item) => item.status === 'passed').length}/${checks.length} checks, ${requestCount} HTTP requests`
  )
}
