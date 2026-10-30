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
 * Exercises Sim links over real HTTP against a running local app (with `SIM_LINKS=true`) and a
 * disposable local PostgreSQL database. SQL seeds two organizations and their members; every Sim
 * link operation and every `sim/<name>` redirect crosses the real app boundary.
 */
const logger = createLogger('SimLinksE2E')

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  assert(value, `${name} must be explicitly provided`)
  return value
}

const baseUrl = new URL(requiredEnvironment('SIM_LINKS_E2E_BASE_URL'))
const databaseUrl = assertDisposableTestDatabaseUrl(
  requiredEnvironment('SIM_LINKS_E2E_DATABASE_URL')
)
const authSecret = requiredEnvironment('SIM_LINKS_E2E_AUTH_SECRET')
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
  orgId: string
  cookie: string
}

interface SimLinkBody {
  name: string
  url: string
  defaultUrl?: string | null
  description?: string | null
  unlisted?: boolean
  restrictEdit?: boolean
}

async function send(path: string, member: Member | null, init: RequestInit = {}) {
  const headers = new Headers({ 'User-Agent': 'Sim-local-sim-links-E2E', Origin: baseUrl.origin })
  if (member) headers.set('Cookie', `better-auth.session_token=${member.cookie}`)
  if (init.body) headers.set('Content-Type', 'application/json')
  const response = await fetch(new URL(path, baseUrl), {
    ...init,
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(120_000),
  })
  requestCount++
  return response
}

async function api(
  member: Member,
  path: string,
  { method = 'GET', body, expected = 200 }: { method?: string; body?: unknown; expected?: number }
): Promise<Record<string, unknown>> {
  const response = await send(`/api/organizations/${member.orgId}/sim-links${path}`, member, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  assert.equal(response.status, expected, `${method} ${path}: ${response.status} ${text}`)
  const parsed: unknown = text ? JSON.parse(text) : {}
  assert(isRecordLike(parsed), 'Expected a JSON object')
  return parsed
}

function fields(body: SimLinkBody): Required<SimLinkBody> {
  return {
    defaultUrl: null,
    description: null,
    unlisted: false,
    restrictEdit: false,
    ...body,
  }
}

async function create(member: Member, body: SimLinkBody): Promise<string> {
  const { link } = await api(member, '', { method: 'POST', body: fields(body) })
  assert(isRecordLike(link) && typeof link.id === 'string', 'Expected the created link')
  return link.id
}

async function listedNames(member: Member, search?: string): Promise<string[]> {
  const query = search ? `?search=${encodeURIComponent(search)}` : ''
  const { links } = await api(member, query, {})
  assert(Array.isArray(links), 'Expected a link list')
  return links.map((link) => (isRecordLike(link) ? String(link.name) : ''))
}

/** Where `sim/<path>` sends `member`: the redirect target, or the page text when it renders one. */
async function open(member: Member | null, path: string) {
  const response = await send(`/sim/${path}`, member)
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location')
    assert(location, `sim/${path} redirected without a location`)
    return { location: new URL(location, baseUrl).toString(), text: '' }
  }
  assert.equal(response.status, 200, `sim/${path}: ${response.status}`)
  return { location: null, text: await response.text() }
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
    values (${orgId}, 'Sim links E2E', ${`sim-links-e2e-${generateShortId().toLowerCase()}`}, now())`
  return orgId
}

async function seedMember(orgId: string, role: 'owner' | 'admin' | 'member'): Promise<Member> {
  const userId = generateId()
  userIds.push(userId)
  const email = `${role}-${userId}@sim-links-e2e.test`
  const token = generateShortId()
  await sql.begin(async (tx) => {
    await tx`insert into "user" (id, name, email, normalized_email, email_verified, created_at, updated_at)
      values (${userId}, ${`Sim links ${role}`}, ${email}, ${email}, true, now(), now())`
    await tx`insert into user_stats (id, user_id) values (${generateId()}, ${userId})`
    await tx`insert into member (id, user_id, organization_id, role)
      values (${generateId()}, ${userId}, ${orgId}, ${role})`
    await tx`insert into session (id, token, user_id, active_organization_id, expires_at, created_at, updated_at)
      values (${generateId()}, ${token}, ${userId}, ${orgId}, now() + interval '1 day', now(), now())`
  })
  return {
    userId,
    orgId,
    cookie: encodeURIComponent(`${token}.${await makeSignature(token, authSecret)}`),
  }
}

async function auditActions(orgId: string): Promise<string[]> {
  const rows = await sql<{ action: string }[]>`select action from audit_log
    where metadata->>'organizationId' = ${orgId} and resource_type = 'sim_link'`
  return rows.map((row) => row.action)
}

async function run() {
  const orgId = await seedOrganization()
  const owner = await seedMember(orgId, 'owner')
  const member = await seedMember(orgId, 'member')
  const outsider = await seedMember(await seedOrganization(), 'owner')

  await check('signed-out visitors sign in and come back to the link', async () => {
    const { location } = await open(null, 'handbook')
    assert(location, 'Expected a redirect to sign in')
    const target = new URL(location)
    assert.equal(target.pathname, '/login')
    assert.equal(target.searchParams.get('callbackUrl'), '/sim/handbook')
  })

  const handbook = await create(owner, {
    name: 'Team-Handbook',
    url: 'https://handbook.example.com/start',
    description: 'Where everything lives',
  })

  await check('a link redirects every member, ignoring case and punctuation', async () => {
    for (const path of ['Team-Handbook', 'teamhandbook', 'TEAM_handbook']) {
      assert.equal((await open(member, path)).location, 'https://handbook.example.com/start')
    }
    assert.equal(
      (await open(member, 'team-handbook/policies/pto')).location,
      'https://handbook.example.com/start/policies/pto'
    )
  })

  await check('a variable link fills its values and keeps its origin', async () => {
    await create(owner, {
      name: 'jira',
      url: 'https://jira.example.com/browse/PROD-{*}',
      defaultUrl: 'https://jira.example.com',
    })
    assert.equal(
      (await open(member, 'jira/123')).location,
      'https://jira.example.com/browse/PROD-123'
    )
    assert.equal((await open(member, 'jira')).location, 'https://jira.example.com/')
    const hostile = new URL((await open(member, 'jira/%2F%2Fevil.example.org')).location ?? '')
    assert.equal(hostile.origin, 'https://jira.example.com')
    await create(owner, { name: 'gh', url: 'https://github.com/{*}/issues/{*}' })
    assert.match((await open(member, 'gh/sim')).text, /needs 2 values/)
  })

  await check('destinations must be http(s) with a fixed origin', async () => {
    for (const url of [
      'javascript:alert(1)',
      'https://{*}.example.com',
      'https://{*}@corp.example.com/',
      'example.com',
    ]) {
      await api(owner, '', { method: 'POST', body: fields({ name: 'bad', url }), expected: 400 })
    }
    await api(owner, '', {
      method: 'POST',
      body: fields({
        name: 'bad',
        url: 'https://example.com',
        defaultUrl: 'https://x.example.com',
      }),
      expected: 400,
    })
  })

  await check('names differing only in case or punctuation conflict', async () => {
    const { error } = await api(member, '', {
      method: 'POST',
      body: fields({ name: 'team.handbook', url: 'https://other.example.com' }),
      expected: 409,
    })
    assert.match(String(error), /sim\/Team-Handbook already exists/)
  })

  await check('unlisted links are hidden from other members but still resolve', async () => {
    await create(owner, { name: 'secret-plan', url: 'https://plan.example.com', unlisted: true })
    assert((await listedNames(owner)).includes('secret-plan'))
    assert(!(await listedNames(member)).includes('secret-plan'))
    assert.equal((await open(member, 'secret-plan')).location, 'https://plan.example.com/')
  })

  await check('search matches names regardless of punctuation and the sim/ prefix', async () => {
    assert.deepEqual(await listedNames(member, 'sim/teamhand'), ['Team-Handbook'])
    assert.deepEqual(await listedNames(member, 'everything lives'), ['Team-Handbook'])
  })

  await check('restricted links refuse edits from other members', async () => {
    const restricted = await create(owner, {
      name: 'payroll',
      url: 'https://payroll.example.com',
      restrictEdit: true,
    })
    const body = fields({ name: 'payroll', url: 'https://evil.example.com', restrictEdit: true })
    await api(member, `/${restricted}`, { method: 'PUT', body, expected: 403 })
    await api(member, `/${restricted}`, { method: 'DELETE', expected: 403 })
    assert.equal((await open(member, 'payroll')).location, 'https://payroll.example.com/')
  })

  await check('members edit open links but cannot change who finds or edits them', async () => {
    const edited = fields({
      name: 'Team-Handbook',
      url: 'https://handbook.example.com/v2',
      description: 'Moved',
    })
    await api(member, `/${handbook}`, { method: 'PUT', body: edited })
    assert.equal((await open(owner, 'team-handbook')).location, 'https://handbook.example.com/v2')
    await api(member, `/${handbook}`, {
      method: 'PUT',
      body: { ...edited, restrictEdit: true },
      expected: 403,
    })
    await api(member, `/${handbook}`, {
      method: 'PUT',
      body: { ...edited, unlisted: true },
      expected: 403,
    })
  })

  await check('another organization neither sees nor resolves these links', async () => {
    const { text } = await open(outsider, 'team-handbook')
    assert.match(text, /doesn.*t exist yet/)
    assert.match(text, /links\?create=team-handbook/)
    await api({ ...outsider, orgId }, '', { expected: 404 })
  })

  await check('deleting a link stops it resolving and every change is audited', async () => {
    await api(owner, `/${handbook}`, { method: 'DELETE' })
    assert.match((await open(member, 'team-handbook')).text, /doesn.*t exist yet/)
    let actions: string[] = []
    for (let attempt = 0; attempt < 20; attempt++) {
      actions = await auditActions(orgId)
      if (actions.includes('sim_link.deleted')) break
      await sleep(250)
    }
    for (const action of ['sim_link.created', 'sim_link.updated', 'sim_link.deleted']) {
      assert(actions.includes(action), `Expected an ${action} audit entry, got ${actions}`)
    }
  })
}

async function cleanup() {
  if (organizationIds.length) {
    await sql`delete from audit_log where metadata->>'organizationId' in ${sql(organizationIds)}`
    await sql`delete from organization where id in ${sql(organizationIds)}`
  }
  if (userIds.length) await sql`delete from "user" where id in ${sql(userIds)}`
}

try {
  await run()
} catch (error) {
  logger.error('Sim links E2E failed', { error: getErrorMessage(error) })
  process.exitCode = 1
} finally {
  try {
    await cleanup()
  } catch (error) {
    logger.error('Sim links E2E fixture cleanup failed', { error: getErrorMessage(error) })
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
  if (process.env.SIM_LINKS_E2E_REPORT_PATH) {
    await writeFile(process.env.SIM_LINKS_E2E_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
  }
  logger.info(
    `Sim links E2E ${report.status}: ${checks.filter((item) => item.status === 'passed').length}/${checks.length} checks, ${requestCount} HTTP requests`
  )
}
