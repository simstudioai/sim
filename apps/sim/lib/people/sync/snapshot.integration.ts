import { db } from '@sim/db'
import {
  member,
  organization,
  peopleDirectoryEntry,
  scimConnection,
  scimUser,
  user,
} from '@sim/db/schema'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { jsonResponse } from '@sim/testing/helpers/http'
import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { generateId } from '@sim/utils/id'
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { getChartBranch, getPerson } from '@/lib/people/repository'
import { DirectoryRetryError } from '@/lib/people/sync/provider-request'
import { runDirectorySync } from '@/lib/people/sync/runner'
import { markScimPeopleChanged } from '@/lib/people/sync/scim-changes'
import {
  configureDirectorySync,
  disconnectDirectorySync,
  getDirectorySync,
  requestDirectorySync,
} from '@/lib/people/sync/service'
import { openDirectoryReader } from '@/lib/people/sync/snapshot'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

vi.hoisted(() => {
  vi.stubEnv('PEOPLE', 'true')
  vi.stubEnv('SCIM_ENABLED', 'true')
})

const fetchPage = inputValidationMockFns.mockSecureFetchWithValidation
const tenantId = generateId()
const clientId = generateId()
const organizationId = generateId()
const config = {
  source: 'entra',
  tenantId,
  clientId,
  clientSecret: 'test-only-client-secret',
} as const

const actorId = generateId()
const fixtureUsers = [actorId]
beforeAll(async () => {
  await db.insert(organization).values({
    id: organizationId,
    name: 'Directory sync',
    slug: organizationId,
    createdAt: new Date(),
  })
  await db.insert(user).values({
    id: actorId,
    name: 'Owner',
    email: `${actorId}@example.test`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  await db
    .insert(member)
    .values({ id: generateId(), organizationId, userId: actorId, role: 'owner' })
})
afterEach(async () => {
  fetchPage.mockReset()
  await disconnectDirectorySync(organizationId)
})
afterAll(async () => {
  await db.delete(organization).where(eq(organization.id, organizationId))
  await db.delete(user).where(inArray(user.id, fixtureUsers))
  vi.unstubAllEnvs()
})

const publishedDirectory = () =>
  db
    .select()
    .from(peopleDirectoryEntry)
    .where(eq(peopleDirectoryEntry.organizationId, organizationId))
    .orderBy(peopleDirectoryEntry.id)

it('builds app-only reporting lines from all direct-report pages, including reversed batch responses', async () => {
  const manager = generateId()
  const worker = generateId()
  const later = generateId()
  let calledToken = false
  fetchPage.mockImplementation(async (url, options) => {
    if (url === `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`) {
      const form = new URLSearchParams(String(options?.body))
      expect(form.get('scope')).toBe('https://graph.microsoft.com/.default')
      expect(form.get('grant_type')).toBe('client_credentials')
      expect(form.get('client_secret')).toBe(config.clientSecret)
      expect(form.get('client_id')).toBe(clientId)
      calledToken = true
      return jsonResponse({ access_token: 'app-access-token', token_type: 'Bearer' })
    }
    expect(calledToken).toBe(true)
    expect(options?.headers?.Authorization).toBe('Bearer app-access-token')
    const target = new URL(url)
    expect(target.origin).toBe('https://graph.microsoft.com')
    if (target.pathname.endsWith('/users')) {
      expect(target.searchParams.has('$expand')).toBe(false)
      return jsonResponse({
        value: [
          { id: manager, displayName: 'Director', accountEnabled: true, mail: 'boss@example.test' },
          {
            id: worker,
            displayName: 'First report',
            accountEnabled: true,
            userPrincipalName: 'worker@example.test',
          },
          {
            id: later,
            displayName: 'Later report',
            accountEnabled: true,
            mail: 'later@example.test',
          },
          { id: generateId(), displayName: 'Inactive', accountEnabled: false },
        ],
      })
    }
    const batch = JSON.parse(String(options?.body)) as { requests: { url: string; id: string }[] }
    const responses = batch.requests.map((request) => {
      const endpoint = new URL(`https://graph.microsoft.com/v1.0${request.url}`)
      expect(endpoint.pathname).toMatch(/\/directReports$/)
      if (endpoint.pathname.includes(manager) && endpoint.searchParams.has('$skiptoken')) {
        return { id: request.id, status: 200, body: { value: [{ id: later }] } }
      }
      if (endpoint.pathname.includes(manager))
        return {
          id: request.id,
          status: 200,
          body: {
            value: [{ id: worker }],
            '@odata.nextLink': `https://graph.microsoft.com/v1.0/users/${manager}/directReports?$skiptoken=next`,
          },
        }
      return { id: request.id, status: 200, body: { value: [] } }
    })
    return jsonResponse({ responses: responses.reverse() })
  })
  const result = await configureDirectorySync(organizationId, config, actorId)
  expect(result.state).toBe('scheduled')
  const people = await publishedDirectory()
  expect(people).toHaveLength(3)
  const lead = people.find((person) => person.externalId === manager)
  if (!lead) throw new Error('Missing directory-only manager')
  const branch = await db.transaction((tx) =>
    getChartBranch(tx, organizationId, { memberId: lead.id }, 1, 4)
  )
  expect(branch?.person).toMatchObject({ name: 'Director', userId: null })
  expect(branch?.reports.map((report) => report.name)).toEqual(['First report', 'Later report'])
  const person = people.find((person) => person.externalId === worker)
  if (!person) throw new Error('Missing directory-only report')
  expect(await getPerson(db, organizationId, person.id)).toMatchObject({
    name: 'First report',
    email: 'worker@example.test',
    userId: null,
    manager: { memberId: lead.id },
  })

  fetchPage
    .mockReset()
    .mockResolvedValueOnce(jsonResponse({ error_description: config.clientSecret }, 401))
  const failed = await requestDirectorySync(organizationId)
  expect(failed).toMatchObject({ state: 'failed', lastSuccessAt: result.lastSuccessAt })
  expect(failed.lastError).not.toContain(config.clientSecret)
  expect(await publishedDirectory()).toEqual(people)
})

it.each([
  ['partial', /HTTP 206/],
  ['missing', /incomplete/i],
  ['foreign continuation', /pagination/i],
] as const)(
  'rejects a %s directReports page before it can be checkpointed',
  async (failure, expectedError) => {
    const manager = generateId()
    fetchPage
      .mockResolvedValueOnce(
        jsonResponse({ access_token: 'app-access-token', token_type: 'Bearer' })
      )
      .mockImplementationOnce(async (_url, options) => {
        const [request] = (JSON.parse(String(options?.body)) as { requests: { id: string }[] })
          .requests
        return jsonResponse({
          responses:
            failure === 'missing'
              ? []
              : [
                  {
                    id: request.id,
                    status: failure === 'partial' ? 206 : 200,
                    body:
                      failure !== 'foreign continuation'
                        ? { value: [] }
                        : {
                            value: [],
                            '@odata.nextLink':
                              'https://other.example/v1.0/users/boss/directReports',
                          },
                  },
                ],
        })
      })
    const reader = await openDirectoryReader(config)
    if (!reader.reports) throw new Error('Missing Graph reporting-source reader')
    await expect(reader.reports([{ managerId: manager, cursor: null }])).rejects.toThrow(
      expectedError
    )
    expect(fetchPage).toHaveBeenCalledTimes(2)
  }
)

it('lets successful Graph siblings checkpoint while a throttled manager retries its own cursor', async () => {
  const lead = 'DirectoryManagerCase'
  const second = generateId()
  const worker = generateId()
  const next = `https://graph.microsoft.com/v1.0/Users/${lead}/directreports?$skiptoken=next`
  fetchPage
    .mockResolvedValueOnce(jsonResponse({ access_token: 'access', token_type: 'Bearer' }))
    .mockResolvedValueOnce(
      jsonResponse({
        responses: [
          { id: '2', status: 429, headers: { 'ReTrY-AfTeR': '7200' }, body: {} },
          { id: '1', status: 200, body: { value: [{ id: worker }], '@odata.nextLink': next } },
        ],
      })
    )
  const reader = await openDirectoryReader(config)
  if (!reader.reports) throw new Error('Missing Graph reporting-source reader')
  const items = [
    { managerId: lead, cursor: null },
    { managerId: second, cursor: null },
  ]
  expect(await reader.reports(items)).toEqual([
    { managerId: lead, reportIds: [worker], next },
    { managerId: second, retryAfterMs: 7_200_000 },
  ])
  await expect(reader.reports([{ managerId: second, cursor: next }])).rejects.toThrow(/pagination/)
  await expect(reader.reports([{ managerId: lead.toLowerCase(), cursor: next }])).rejects.toThrow(
    /pagination/
  )
  expect(fetchPage).toHaveBeenCalledTimes(2)
})

it('resumes an Okta users checkpoint in a new reader and rejects a foreign stored cursor without egress', async () => {
  const okta = { source: 'okta', domain: 'fixture.okta.com', token: 'test-token' } as const
  const next = 'https://fixture.okta.com/api/v1/users?after=cursor'
  fetchPage.mockResolvedValueOnce(
    jsonResponse([{ id: 'first', status: 'ACTIVE', profile: { email: 'first@example.test' } }], {
      headers: { Link: `<${next}>; rel="next"` },
    })
  )
  const reader = await openDirectoryReader(okta)
  const first = await reader.users(null)
  expect(first.next).toBe(next)
  fetchPage.mockImplementationOnce(async (url) => {
    expect(url).toBe(next)
    return jsonResponse([{ id: 'last', status: 'ACTIVE', profile: { email: 'last@example.test' } }])
  })
  const resumed = await openDirectoryReader(okta)
  expect(await resumed.users(first.next)).toMatchObject({
    people: [{ externalId: 'last' }],
    next: null,
  })
  await expect(resumed.users('https://other.okta.com/api/v1/users?after=x')).rejects.toThrow(
    /pagination/
  )
  expect(fetchPage).toHaveBeenCalledTimes(2)
})

it('preserves provider retry windows for token exchange and Okta user polls, including reset epochs', async () => {
  fetchPage.mockResolvedValueOnce(
    jsonResponse({}, { status: 503, headers: { 'Retry-After': '3600' } })
  )
  await expect(openDirectoryReader(config)).rejects.toMatchObject({
    name: 'DirectoryRetryError',
    retryAfterMs: 3_600_000,
  })
  const resetsAt = Math.ceil(Date.now() / 1000) + 90
  fetchPage.mockResolvedValueOnce(
    jsonResponse({}, { status: 429, headers: { 'X-Rate-Limit-Reset': String(resetsAt) } })
  )
  const reader = await openDirectoryReader({
    source: 'okta',
    domain: 'fixture.okta.com',
    token: 'test-token',
  })
  const started = Date.now()
  const failure = await reader.users(null).catch((error: unknown) => error)
  if (!(failure instanceof DirectoryRetryError)) throw new Error('Missing Okta reset delay')
  expect(failure.retryAfterMs).toBeGreaterThanOrEqual(resetsAt * 1000 - Date.now())
  expect(failure.retryAfterMs).toBeLessThanOrEqual(resetsAt * 1000 - started)
  fetchPage.mockRejectedValueOnce(
    Object.assign(new Error('transient upstream'), { code: 'ECONNRESET' })
  )
  await expect(reader.users(null)).rejects.toBeInstanceOf(DirectoryRetryError)
})

it('keeps Okta identity through an email change and removes accounts when the complete active directory empties', async () => {
  const okta = { source: 'okta', domain: 'fixture.okta.com', token: 'test-api-token' } as const
  const externalId = '00u-test-only'
  const profile = (email: string, firstName: string) =>
    jsonResponse([
      {
        id: externalId,
        status: 'ACTIVE',
        profile: { login: email, firstName, lastName: 'Chen', title: 'Team lead' },
      },
    ])
  fetchPage.mockResolvedValueOnce(profile('first@example.test', 'Maya'))
  expect((await configureDirectorySync(organizationId, okta, actorId)).state).toBe('scheduled')
  const [first] = await publishedDirectory()
  expect(await getPerson(db, organizationId, first.id)).toMatchObject({
    name: 'Maya Chen',
    userId: null,
    title: 'Team lead',
  })
  fetchPage.mockResolvedValueOnce(profile('new@example.test', 'Maria'))
  await requestDirectorySync(organizationId)
  expect(await getPerson(db, organizationId, first.id)).toMatchObject({
    name: 'Maria Chen',
    email: 'new@example.test',
  })
  fetchPage.mockResolvedValueOnce(profile('', 'Missing email'))
  expect((await requestDirectorySync(organizationId)).state).toBe('failed')
  expect(await getPerson(db, organizationId, first.id)).toMatchObject({ name: 'Maria Chen' })
  fetchPage.mockResolvedValueOnce(jsonResponse([]))
  expect((await requestDirectorySync(organizationId)).state).toBe('scheduled')
  expect(await publishedDirectory()).toEqual([])
})

it('ignores a completed provider read after its source has been disconnected', async () => {
  const fetching = createDeferred<void>()
  const response = createDeferred<ReturnType<typeof jsonResponse>>()
  fetchPage.mockImplementationOnce(() => {
    fetching.resolve()
    return response.promise
  })
  const run = configureDirectorySync(
    organizationId,
    { source: 'okta', domain: 'fixture.okta.com', token: 'test-api-token' },
    actorId
  )
  await fetching.promise
  await disconnectDirectorySync(organizationId)
  response.resolve(
    jsonResponse([{ id: 'late-user', status: 'ACTIVE', profile: { email: 'late@example.test' } }])
  )
  await expect(run).rejects.toMatchObject({ code: 'not_found' })
  expect(await publishedDirectory()).toEqual([])
})

it('projects SCIM resource IDs and preferred names even when the linked account has no local membership', async () => {
  const connectionId = generateId()
  const users = ['manager', 'worker', 'deprovisioned', 'suspended'].map((label) => ({
    label,
    id: generateId(),
    userId: generateId(),
    email: `${label}-${connectionId}@example.test`,
  }))
  const [manager, worker] = users
  fixtureUsers.push(...users.map((person) => person.userId))
  await db.insert(scimConnection).values({ id: connectionId, organizationId })
  await db.insert(user).values(
    users.map((person) => ({
      id: person.userId,
      email: person.email,
      name: 'Sim account name',
      emailVerified: true,
      suspendedAt: person.label === 'suspended' ? new Date() : null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
  )
  await db.insert(scimUser).values(
    users.map((person) => ({
      id: person.id,
      connectionId,
      userId: person.userId,
      externalId: `upstream-${person.id}`,
      userName: person.email,
      active: person.label !== 'deprovisioned',
      orderKey: person.id,
      attributes: {
        userName: person.email,
        active: person.label !== 'deprovisioned',
        emails: [{ value: person.email, primary: true }],
        name: { formatted: person.label === 'worker' ? 'SCIM formatted report' : 'Older name' },
        displayName: person.label === 'manager' ? 'Director' : 'Legacy synthesized name',
        ...(person.label === 'manager' ? { displayNameSource: 'provider' as const } : {}),
        ...(person.label === 'manager'
          ? { extra: { addresses: [{ type: 'home', formatted: 'Private address' }] } }
          : {}),
        ...(person.label === 'worker'
          ? {
              enterprise: { manager: { value: manager.id }, department: 'Platform' },
              extra: {
                Title: 'Engineer',
                addresses: [{ type: 'work', locality: 'Berlin', country: 'Germany' }],
              },
            }
          : {}),
      },
    }))
  )
  const result = await configureDirectorySync(organizationId, { source: 'scim' }, actorId)
  expect(result.state).toBe('scheduled')
  const entries = await publishedDirectory()
  expect(entries).toHaveLength(2)
  const lead = entries.find((person) => person.externalId === manager.id)
  const report = entries.find((person) => person.externalId === worker.id)
  if (!report || !lead) throw new Error('Missing active directory entries')
  expect(lead.location).toBeNull()
  expect(report).toMatchObject({
    managerExternalId: manager.id,
    name: 'SCIM formatted report',
    title: 'Engineer',
    department: 'Platform',
    location: 'Berlin, Germany',
  })
  expect(await getPerson(db, organizationId, report.id)).toMatchObject({
    userId: null,
    manager: { name: 'Director', memberId: lead.id },
  })

  const suspended = users.find((person) => person.label === 'suspended')
  if (!suspended) throw new Error('Missing offboarded account')
  await db
    .update(user)
    .set({ suspendedAt: null, email: worker.email.toUpperCase() })
    .where(eq(user.id, suspended.userId))
  const ambiguous = await requestDirectorySync(organizationId)
  expect(ambiguous).toMatchObject({ state: 'failed', lastSuccessAt: result.lastSuccessAt })
  expect(ambiguous.lastError).toMatch(/unique/i)
  expect(await getPerson(db, organizationId, report.id)).toMatchObject({
    name: 'SCIM formatted report',
    manager: { memberId: lead.id },
  })

  const locked = createDeferred<void>()
  const release = createDeferred<void>()
  const publisher = db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT 1 FROM people_directory_sync WHERE organization_id=${organizationId} FOR UPDATE`
    )
    await tx.execute(sql`SELECT 1 FROM people_directory_entry WHERE id=${report.id} FOR UPDATE`)
    locked.resolve()
    await release.promise
  })
  try {
    await locked.promise
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout='500ms'`)
      await tx.delete(scimUser).where(eq(scimUser.id, worker.id))
      await markScimPeopleChanged(tx, organizationId)
    })
    expect(await getPerson(db, organizationId, report.id)).toBeNull()
  } finally {
    release.resolve()
    await publisher
  }
  const due = await getDirectorySync(organizationId)
  expect(due).toMatchObject({ state: 'failed', lastError: ambiguous.lastError })
  expect(new Date(due?.nextSyncAt ?? '').getTime()).toBeLessThanOrEqual(Date.now())
  expect(await runDirectorySync(organizationId, 'cron')).toBe(true)
  expect(await getDirectorySync(organizationId)).toMatchObject({ state: 'scheduled' })
  expect((await publishedDirectory()).some((entry) => entry.id === report.id)).toBe(false)
})
