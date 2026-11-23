import { db } from '@sim/db'
import {
  peopleDirectoryEntry as entry,
  member,
  organization,
  peopleDirectorySync as sync,
  user,
} from '@sim/db/schema'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { jsonResponse } from '@sim/testing/helpers/http'
import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { generateId } from '@sim/utils/id'
import { and, count, eq, like } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import * as flags from '@/lib/core/config/feature-flags'
import { configurePeopleSync } from '@/lib/people/application/directory-sync'
import { getChartBranch } from '@/lib/people/repository'
import { runDirectorySync } from '@/lib/people/sync/runner'
import {
  configureDirectorySync,
  disconnectDirectorySync,
  getDirectorySync,
  requestDirectorySync,
} from '@/lib/people/sync/service'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)
vi.hoisted(() => vi.stubEnv('PEOPLE', 'true'))

const fetchPage = inputValidationMockFns.mockSecureFetchWithValidation
const organizationId = generateId()
const ownerId = generateId()
const principal = createSessionPrincipal({ userId: ownerId })
const config = { source: 'okta', domain: 'resume.okta.com', token: 'test-token-original' } as const

beforeAll(async () => {
  await db.transaction(async (tx) => {
    await tx.insert(organization).values({
      id: organizationId,
      name: 'Resumable directory',
      slug: organizationId,
      createdAt: new Date(),
    })
    await tx.insert(user).values({
      id: ownerId,
      name: 'Owner',
      email: `${ownerId}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await tx
      .insert(member)
      .values({ id: generateId(), userId: ownerId, organizationId, role: 'owner' })
  })
})
afterEach(async () => {
  fetchPage.mockReset()
  await disconnectDirectorySync(organizationId)
  vi.restoreAllMocks()
})
afterAll(async () => {
  await db.delete(organization).where(eq(organization.id, organizationId))
  await db.delete(user).where(eq(user.id, ownerId))
  vi.unstubAllEnvs()
})

function person(id: string, title = 'Engineer', managerId?: string) {
  return {
    id,
    status: 'ACTIVE',
    profile: { email: `${id}@example.test`, firstName: id, title, managerId },
  }
}

async function publishBaseline() {
  fetchPage.mockResolvedValueOnce(jsonResponse([person('director', 'Founder')]))
  await configureDirectorySync(organizationId, config, ownerId)
  const [director] = await db
    .select({ id: entry.id })
    .from(entry)
    .where(and(eq(entry.organizationId, organizationId), eq(entry.externalId, 'director')))
  return director.id
}

it('resumes a throttled directory beyond 10,000 accounts and publishes the complete tree once', async () => {
  const directorId = await publishBaseline()
  const size = 10241
  const slice = 200
  const throttleAt = 600
  const requested: number[] = []
  let throttled = false
  fetchPage.mockImplementation(async (url, options) => {
    expect(options.headers.Authorization).toBe(`SSWS ${config.token}`)
    const page = new URL(url)
    expect(page.origin).toBe('https://resume.okta.com')
    const offset = Number(page.searchParams.get('after') ?? 0)
    requested.push(offset)
    if (offset === throttleAt && !throttled) {
      throttled = true
      return jsonResponse(
        { message: config.token },
        { status: 429, headers: { 'Retry-After': '120' } }
      )
    }
    const limit = Math.min(slice, Number(page.searchParams.get('limit') || slice), size - offset)
    const records = Array.from({ length: limit }, (_, index) => {
      const n = offset + index
      return n === size - 1
        ? person('director', 'Director')
        : person(`employee-${n}`, 'Engineer', 'director')
    })
    if (offset + limit === size) return jsonResponse(records)
    page.searchParams.set('after', String(offset + limit))
    return jsonResponse(records, { headers: { Link: `<${page.href}>; rel="next"` } })
  })

  const started = Date.now()
  let status = await requestDirectorySync(organizationId)
  expect(status.state).toBe('failed')
  expect(status.retryBlocked).toBe(true)
  expect(status.progress).toEqual({ phase: 'users', usersRead: throttleAt })
  expect(Date.parse(status.retryAt ?? '')).toBeGreaterThanOrEqual(started + 119000)
  expect(JSON.stringify(status)).not.toContain(config.token)
  const beforeRetry = [...requested]
  await requestDirectorySync(organizationId)
  expect(await runDirectorySync(organizationId, 'cron')).toBe(false)
  expect(requested).toEqual(beforeRetry)

  const verifyBaseline = async () => {
    const [{ total }] = await db
      .select({ total: count() })
      .from(entry)
      .where(eq(entry.organizationId, organizationId))
    expect(total).toBe(1)
    const branch = await db.transaction((tx) =>
      getChartBranch(tx, organizationId, { memberId: directorId }, 1, 4)
    )
    expect(branch?.person.title).toBe('Founder')
    expect(branch?.totalReports).toBe(0)
  }
  await verifyBaseline()
  await db
    .update(sync)
    .set({ nextSyncAt: new Date(0) })
    .where(eq(sync.organizationId, organizationId))
  const resumesAt = requested.length
  status = await requestDirectorySync(organizationId)
  expect(requested[resumesAt]).toBe(throttleAt)
  expect(status.progress?.usersRead).toBeGreaterThan(throttleAt)
  let continuationTicks = 0
  while (status.progress && continuationTicks < 100) {
    await verifyBaseline()
    await runDirectorySync(organizationId, 'cron')
    const updated = await getDirectorySync(organizationId)
    if (!updated) throw new Error('Directory connection disappeared')
    status = updated
    continuationTicks++
  }
  expect(status).toMatchObject({
    state: 'scheduled',
    progress: null,
    lastError: null,
    retryAt: null,
  })
  expect(status.lastSuccessAt).toBeTruthy()
  expect(requested.filter((offset) => offset === 0)).toHaveLength(1)
  const branch = await db.transaction((tx) =>
    getChartBranch(tx, organizationId, { memberId: directorId }, 1, 4)
  )
  expect(branch?.person.title).toBe('Director')
  expect(branch?.totalReports).toBe(size - 1)
}, 90_000)

it('blocks provider access for an organization whose People rollout is disabled, including due work', async () => {
  await publishBaseline()
  const before = fetchPage.mock.calls.length
  const recent = await getDirectorySync(organizationId)
  vi.spyOn(flags, 'isFeatureEnabled').mockResolvedValue(false)
  await expect(
    configurePeopleSync.execute({ principal, input: { organizationId, config } })
  ).rejects.toMatchObject({ code: 'forbidden' })
  await db
    .update(sync)
    .set({ nextSyncAt: new Date(0) })
    .where(eq(sync.organizationId, organizationId))
  await runDirectorySync(organizationId, 'cron')
  expect(fetchPage.mock.calls.length).toBe(before)
  expect((await getDirectorySync(organizationId))?.lastSuccessAt).toBe(recent?.lastSuccessAt)
  const [{ total }] = await db
    .select({ total: count() })
    .from(entry)
    .where(eq(entry.organizationId, organizationId))
  expect(total).toBe(1)
})

it('never publishes a late page into a reconnected directory and keeps saved credentials out of status', async () => {
  await publishBaseline()
  const fetched = createDeferred<void>()
  const delayed = createDeferred<ReturnType<typeof jsonResponse>>()
  const replacement = 'test-token-reconnected'
  fetchPage.mockImplementation(async (_url, options) => {
    if (options.headers.Authorization === `SSWS ${replacement}`)
      return jsonResponse([person('new-director')])
    expect(options.headers.Authorization).toBe(`SSWS ${config.token}`)
    fetched.resolve()
    return delayed.promise
  })
  const old = requestDirectorySync(organizationId)
  await fetched.promise
  await disconnectDirectorySync(organizationId)
  try {
    const current = await configureDirectorySync(
      organizationId,
      { ...config, token: replacement },
      ownerId
    )
    expect(current.state).toBe('scheduled')
    expect(JSON.stringify(current)).not.toContain(replacement)
    const [stored] = await db
      .select({ credential: sync.encryptedCredential })
      .from(sync)
      .where(eq(sync.organizationId, organizationId))
    expect(stored.credential).toBeTruthy()
    expect(stored.credential).not.toContain(replacement)
  } finally {
    delayed.resolve(jsonResponse([person('stale-director')]))
    await old
  }
  const ids = await db
    .select({ id: entry.externalId })
    .from(entry)
    .where(eq(entry.organizationId, organizationId))
  expect(ids).toEqual([{ id: 'new-director' }])
})

it('abandons a week-old generation before using its saved provider cursor', async () => {
  await publishBaseline()
  const offsets: (string | null)[] = []
  const endpoint = `https://${config.domain}/api/v1/users`
  let restarted = false
  fetchPage.mockImplementation(async (url) => {
    const after = new URL(url).searchParams.get('after')
    offsets.push(after)
    if (restarted) {
      if (after) throw new Error('Expired cursor was replayed')
      return jsonResponse([person('fresh-account')])
    }
    return after
      ? jsonResponse({}, { status: 429, headers: { 'Retry-After': '60' } })
      : jsonResponse([person('abandoned-account')], {
          headers: { Link: `<${endpoint}?after=stale>; rel="next"` },
        })
  })
  const paused = await requestDirectorySync(organizationId)
  expect(paused.progress?.usersRead).toBe(1)
  await db
    .update(sync)
    .set({ runStartedAt: new Date(Date.now() - 8 * 86_400_000), nextSyncAt: new Date(0) })
    .where(eq(sync.organizationId, organizationId))
  restarted = true
  expect((await requestDirectorySync(organizationId)).state).toBe('scheduled')
  expect(offsets).toEqual([null, 'stale', null])
  const entries = await db
    .select({ id: entry.externalId })
    .from(entry)
    .where(eq(entry.organizationId, organizationId))
  expect(entries).toEqual([{ id: 'fresh-account' }])
})

it('rotates credentials without bypassing a provider cooldown or publishing the abandoned run', async () => {
  const director = await publishBaseline()
  const rotatedToken = 'test-rotated-credential'
  const next = `https://${config.domain}/api/v1/users?after=old-credential`
  fetchPage
    .mockResolvedValueOnce(
      jsonResponse([person('superseded')], { headers: { Link: `<${next}>; rel="next"` } })
    )
    .mockResolvedValueOnce(jsonResponse({}, { status: 429, headers: { 'Retry-After': '120' } }))
  const paused = await requestDirectorySync(organizationId)
  expect(paused.progress?.usersRead).toBe(1)
  const before = fetchPage.mock.calls.length
  const rotated = await configureDirectorySync(
    organizationId,
    { ...config, token: rotatedToken },
    ownerId
  )
  expect(rotated.retryAt).toBe(paused.retryAt)
  expect(fetchPage.mock.calls.length).toBe(before)
  const previous = await db.transaction((tx) =>
    getChartBranch(tx, organizationId, { memberId: director }, 1, 4)
  )
  expect(previous?.person.title).toBe('Founder')
  fetchPage.mockImplementationOnce(async (url, opts) => {
    expect(opts.headers.Authorization).toBe(`SSWS ${rotatedToken}`)
    expect(new URL(url).searchParams.has('after')).toBe(false)
    return jsonResponse([person('director', 'President')])
  })
  await db
    .update(sync)
    .set({ nextSyncAt: new Date(0) })
    .where(eq(sync.organizationId, organizationId))
  const result = await requestDirectorySync(organizationId)
  expect(result.state).toBe('scheduled')
  const rows = await db
    .select({ id: entry.id, title: entry.title })
    .from(entry)
    .where(eq(entry.organizationId, organizationId))
  expect(rows).toEqual([{ id: director, title: 'President' }])
})

it('resumes a large Entra hierarchy past a user deleted mid-read without replaying successful batch siblings or creating accounts', async () => {
  const total = 10007
  const tenantId = generateId()
  const graphConfig = {
    source: 'entra',
    tenantId,
    clientId: generateId(),
    clientSecret: 'test-only-graph-secret',
  } as const
  const graph = 'https://graph.microsoft.com/v1.0'
  const employee = (index: number) => `employee-${String(index).padStart(5, '0')}`
  const lead = 'z-director'
  const domain = `entra-${organizationId}.example.test`
  const graphUser = (id: string, title: string) => ({
    id,
    mail: `${id}@${domain}`,
    displayName: id,
    jobTitle: title,
    accountEnabled: true,
  })
  let baseline = true
  let throttled = false
  let tokenCount = 0
  const calls = new Map<string, number>()
  const userOffsets: number[] = []
  fetchPage.mockImplementation(async (url, options) => {
    if (url === `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`) {
      expect(new URLSearchParams(options.body).get('client_secret')).toBe(graphConfig.clientSecret)
      tokenCount++
      return jsonResponse({ access_token: `test-access-${tokenCount}`, token_type: 'Bearer' })
    }
    expect(options.headers.Authorization).toBe(`Bearer test-access-${tokenCount}`)
    const endpoint = new URL(url)
    if (endpoint.pathname === '/v1.0/users') {
      if (baseline) return jsonResponse({ value: [graphUser(lead, 'Founder')] })
      const offset = Number(endpoint.searchParams.get('$skiptoken') || 0)
      const pageSize = Math.min(Number(endpoint.searchParams.get('$top') || 100), total - offset)
      userOffsets.push(offset)
      const value = Array.from({ length: pageSize }, (_, i) =>
        offset + i === total - 1
          ? graphUser(lead, 'Director')
          : graphUser(employee(offset + i), 'Engineer')
      )
      endpoint.searchParams.set('$skiptoken', String(offset + pageSize))
      return jsonResponse({
        value,
        ...(offset + pageSize < total ? { '@odata.nextLink': endpoint.href } : {}),
      })
    }
    expect(endpoint.pathname).toBe('/v1.0/$batch')
    const batch = JSON.parse(String(options.body)) as { requests: { id: string; url: string }[] }
    expect(batch.requests.length).toBeLessThanOrEqual(20)
    const responses = batch.requests.map((request) => {
      const target = new URL(request.url, 'https://graph.microsoft.com')
      const managerId = target.pathname.split('/')[2]
      if (baseline) return { id: request.id, status: 200, body: { value: [] } }
      calls.set(managerId, (calls.get(managerId) ?? 0) + 1)
      if (managerId === employee(1) && !throttled) {
        throttled = true
        return {
          id: request.id,
          status: 429,
          headers: { 'Retry-After': '120' },
          body: { error: graphConfig.clientSecret },
        }
      }
      if (managerId === employee(2))
        return {
          id: request.id,
          status: 404,
          body: { error: { code: 'Request_ResourceNotFound' } },
        }
      if (managerId !== lead) return { id: request.id, status: 200, body: { value: [] } }
      const offset = Number(target.searchParams.get('$skiptoken') || 0)
      const length = Math.min(1000, total - 1 - offset)
      const value = Array.from({ length }, (_, i) => ({ id: employee(offset + i) }))
      const next = `${graph}/users/${lead}/directReports?$skiptoken=${offset + length}`
      return {
        id: request.id,
        status: 200,
        body: { value, ...(offset + length < total - 1 ? { '@odata.nextLink': next } : {}) },
      }
    })
    return jsonResponse({ responses: responses.reverse() })
  })
  const initial = await configureDirectorySync(organizationId, graphConfig, ownerId)
  expect(initial.state).toBe('scheduled')
  const [director] = await db
    .select({ id: entry.id })
    .from(entry)
    .where(eq(entry.organizationId, organizationId))
  const verifyPriorChart = async () => {
    const branch = await db.transaction((tx) =>
      getChartBranch(tx, organizationId, { memberId: director.id }, 1, 4)
    )
    expect(branch?.person.title).toBe('Founder')
    expect(branch?.totalReports).toBe(0)
  }
  baseline = false
  let status = await requestDirectorySync(organizationId)
  for (let n = 0; status.state !== 'failed' && n < 16; n++) {
    await verifyPriorChart()
    await runDirectorySync(organizationId, 'cron')
    status = (await getDirectorySync(organizationId)) ?? status
  }
  expect(status).toMatchObject({
    state: 'failed',
    progress: { phase: 'relationships', usersRead: total },
    lastSuccessAt: initial.lastSuccessAt,
  })
  expect(status.retryAt).toBeTruthy()
  expect(JSON.stringify(status)).not.toContain(graphConfig.clientSecret)
  expect(calls.get(employee(0))).toBe(1)
  await verifyPriorChart()
  await db
    .update(sync)
    .set({ nextSyncAt: new Date(0) })
    .where(eq(sync.organizationId, organizationId))
  for (let n = 0; status.progress && n < 32; n++) {
    await verifyPriorChart()
    await runDirectorySync(organizationId, 'cron')
    status = (await getDirectorySync(organizationId)) ?? status
  }
  expect(status).toMatchObject({ state: 'scheduled', progress: null, lastError: null })
  expect(calls.get(employee(0))).toBe(1)
  expect(calls.get(employee(1))).toBe(2)
  expect(userOffsets.filter((offset) => offset === 0)).toHaveLength(1)
  const branch = await db.transaction((tx) =>
    getChartBranch(tx, organizationId, { memberId: director.id }, Math.ceil((total - 1) / 4), 4)
  )
  expect(branch?.person.title).toBe('Director')
  expect(branch?.totalReports).toBe(total - 1)
  expect(branch?.reports.at(-1)?.email).toBe(`${employee(total - 2)}@${domain}`)
  const [{ members }] = await db
    .select({ members: count() })
    .from(member)
    .where(eq(member.organizationId, organizationId))
  expect(members).toBe(1)
  const [{ accounts }] = await db
    .select({ accounts: count() })
    .from(user)
    .where(like(user.email, `%@${domain}`))
  expect(accounts).toBe(0)
}, 180_000)
