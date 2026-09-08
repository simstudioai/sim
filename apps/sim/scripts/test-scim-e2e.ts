import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId, generateShortId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { makeSignature } from 'better-auth/crypto'
import postgres from 'postgres'

/**
 * Exercises a running local app and a disposable local PostgreSQL database.
 * SQL seeds prerequisites and inspects persistence; SCIM and administration
 * operations cross the real HTTP boundary. See ee/scim/TESTING.md.
 */
const logger = createLogger('ScimE2E')
const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User'
const GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group'
const PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp'
const CUSTOM_SCHEMA = 'urn:ietf:params:scim:schemas:extension:CustomExtensionName:2.0:User'
const PASSWORD_MARKER = 'synthetic-password-that-must-never-be-stored-or-returned'
const ALL_SCOPES = ['users:read', 'users:write', 'groups:read', 'groups:write']

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  assert(value, `${name} must be explicitly provided`)
  return value
}

const baseUrl = new URL(requiredEnvironment('SCIM_E2E_BASE_URL'))
const databaseUrl = new URL(requiredEnvironment('SCIM_E2E_DATABASE_URL'))
const authSecret = requiredEnvironment('SCIM_E2E_AUTH_SECRET')
const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
assert(loopbackHosts.has(baseUrl.hostname), 'The app must use a loopback host')
assert.equal(baseUrl.protocol, 'http:', 'The app must use local HTTP')
assert(!baseUrl.username && !baseUrl.password, 'App URL must not contain credentials')
assert.equal(baseUrl.pathname, '/', 'App URL must be an origin without a path')
assert(loopbackHosts.has(databaseUrl.hostname), 'The database must use a loopback host')
assert(['postgres:', 'postgresql:'].includes(databaseUrl.protocol), 'Expected a PostgreSQL URL')
assert(/(?:test|scim)/i.test(databaseUrl.pathname), 'Use a dedicated test or SCIM database')
assert(authSecret.length >= 32, 'Use a local Better Auth secret of at least 32 characters')

const sql = postgres(databaseUrl.toString(), { max: 2 })
const fixtures: Fixture[] = []
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []
const startedAt = new Date().toISOString()
let requestCount = 0

interface Fixture {
  orgId: string
  ownerId: string
  workspaceId: string
  domain: string
  cookie: string
}

interface RequestOptions {
  method?: string
  token?: string
  fixture?: Fixture
  body?: unknown
  rawBody?: string
  contentType?: string
  expected?: number
}

function record(value: unknown): Record<string, unknown> {
  assert(isRecordLike(value), 'Expected a JSON object')
  return value
}

function string(value: unknown): string {
  assert.equal(typeof value, 'string', 'Expected a string')
  return value as string
}

function resources(body: Record<string, unknown>): Record<string, unknown>[] {
  assert(Array.isArray(body.Resources), 'Expected a SCIM resource list')
  return body.Resources.map(record)
}

async function request(path: string, options: RequestOptions = {}) {
  const headers = new Headers({ 'User-Agent': 'Sim-local-SCIM-protocol-E2E' })
  if (options.token) headers.set('Authorization', `Bearer ${options.token}`)
  if (options.fixture) {
    headers.set('Cookie', `better-auth.session_token=${options.fixture.cookie}`)
    headers.set('Origin', baseUrl.origin)
  }
  if (options.body !== undefined || options.rawBody !== undefined) {
    headers.set('Content-Type', options.contentType ?? 'application/scim+json')
  }
  const response = await fetch(new URL(path, baseUrl), {
    method: options.method ?? 'GET',
    headers,
    body:
      options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
    redirect: 'error',
    signal: AbortSignal.timeout(60_000),
  })
  requestCount++
  const text = await response.text()
  const body = text ? record(JSON.parse(text)) : {}
  assert.equal(
    response.status,
    options.expected ?? 200,
    `${options.method ?? 'GET'} ${path}: ${response.status}; ${body.scimType ?? ''} ${body.detail ?? body.error ?? ''}`
  )
  if (path.startsWith('/api/scim/') && response.status !== 204) {
    assert.match(response.headers.get('content-type') ?? '', /application\/scim\+json/)
  }
  if (response.status === 204) assert.equal(text, '', '204 responses must have no body')
  return { body, headers: response.headers }
}

function admin(fixture: Fixture, suffix = '', options: RequestOptions = {}) {
  return request(`/api/organizations/${fixture.orgId}/scim${suffix}`, {
    ...options,
    fixture: options.fixture ?? fixture,
    contentType: 'application/json',
  })
}

function scim(token: string, suffix: string, options: RequestOptions = {}) {
  return request(`/api/scim/v2${suffix}`, { ...options, token })
}

function patch(token: string, suffix: string, operations: unknown[], expected = 200) {
  return scim(token, suffix, {
    method: 'PATCH',
    body: { schemas: [PATCH_SCHEMA], Operations: operations },
    expected,
  })
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

async function seedFixture(): Promise<Fixture> {
  const suffix = generateId().replaceAll('-', '')
  const fixture = {
    orgId: generateId(),
    ownerId: generateId(),
    workspaceId: generateId(),
    domain: `scim-e2e-${suffix}.test`,
    cookie: '',
  }
  fixtures.push(fixture)
  const email = `owner@${fixture.domain}`
  const sessionToken = generateShortId()
  await sql.begin(async (tx) => {
    await tx`insert into "user" (id, name, email, normalized_email, email_verified, created_at, updated_at)
      values (${fixture.ownerId}, 'SCIM E2E Owner', ${email}, ${email}, true, now(), now())`
    await tx`insert into user_stats (id, user_id) values (${generateId()}, ${fixture.ownerId})`
    await tx`insert into organization (id, name, slug, created_at)
      values (${fixture.orgId}, 'SCIM E2E', ${`scim-e2e-${suffix}`}, now())`
    await tx`insert into member (id, user_id, organization_id, role)
      values (${generateId()}, ${fixture.ownerId}, ${fixture.orgId}, 'owner')`
    await tx`insert into workspace (id, name, owner_id, billed_account_user_id, organization_id)
      values (${fixture.workspaceId}, 'SCIM E2E Workspace', ${fixture.ownerId}, ${fixture.ownerId}, ${fixture.orgId})`
    await tx`insert into permissions (id, user_id, entity_type, entity_id, permission_type)
      values (${generateId()}, ${fixture.ownerId}, 'workspace', ${fixture.workspaceId}, 'admin')`
    await tx`insert into subscription (id, plan, reference_id, status, seats, metadata, period_start, period_end)
      values (${generateId()}, 'enterprise', ${fixture.orgId}, 'active', 50,
        ${tx.json({ plan: 'enterprise', referenceId: fixture.orgId, seats: 50, monthlyPrice: 100 })},
        now(), now() + interval '1 month')`
    await tx`insert into session (id, token, user_id, active_organization_id, expires_at, created_at, updated_at)
      values (${generateId()}, ${sessionToken}, ${fixture.ownerId}, ${fixture.orgId}, now() + interval '1 day', now(), now())`
    await tx`insert into sso_domain (id, organization_id, domain, status, verification_token, verified_at, created_by)
      values (${generateId()}, ${fixture.orgId}, ${fixture.domain}, 'verified', ${generateShortId()}, now(), ${fixture.ownerId})`
  })
  fixture.cookie = encodeURIComponent(
    `${sessionToken}.${await makeSignature(sessionToken, authSecret)}`
  )
  return fixture
}

async function configure(fixture: Fixture) {
  const { body } = await admin(fixture, '', {
    method: 'PUT',
    body: { status: 'active', settings: { lockManualMembership: false } },
  })
  assert.equal(record(body.connection).status, 'active')
  const issued = await admin(fixture, '/credentials', { method: 'POST', body: {}, expected: 201 })
  return { secret: string(issued.body.secret), id: string(record(issued.body.credential).id) }
}

async function findUsers(token: string, filter: string) {
  return resources((await scim(token, `/Users?${new URLSearchParams({ filter })}`)).body)
}

async function permission(userId: string, workspaceId: string) {
  const rows = await sql`select permission_type from permissions
    where user_id = ${userId} and entity_type = 'workspace' and entity_id = ${workspaceId}`
  return rows[0]?.permission_type
}

async function cleanup() {
  for (const fixture of [...fixtures].reverse()) {
    await sql.begin(async (tx) => {
      const users = await tx`select id from "user" where email like ${`%@${fixture.domain}`}`
      const userIds = users.map((row) => string(row.id))
      await tx`delete from permissions where entity_type = 'workspace' and entity_id = ${fixture.workspaceId}`
      if (userIds.length) {
        await tx`delete from workspace where owner_id in ${tx(userIds)} or billed_account_user_id in ${tx(userIds)}`
      }
      await tx`delete from subscription where reference_id = ${fixture.orgId}`
      await tx`delete from rate_limit_bucket where key in (
        select 'route:scim:connection:' || id from scim_connection where organization_id = ${fixture.orgId}
      )`
      await tx`delete from organization where id = ${fixture.orgId}`
      if (userIds.length) await tx`delete from "user" where id in ${tx(userIds)}`
    })
  }
}

async function run() {
  const primary = await seedFixture()
  const other = await seedFixture()
  let token = ''
  let credentialId = ''
  let otherToken = ''
  let aliceId = ''
  let aliceUserId = ''
  let bobId = ''
  let groupId = ''
  const aliceEmail = `alice@${primary.domain}`
  const bobEmail = `bob@${primary.domain}`
  const secondaryEmail = `secondary@${primary.domain}`
  const secondaryWorkEmail = `secondary-work@${primary.domain}`

  await check(
    'Discovery advertises SCIM 2.0 resources, schemas, and supported capabilities',
    async () => {
      const config = (await request('/api/scim/v2/ServiceProviderConfig')).body
      assert.equal(record(config.patch).supported, true)
      assert.equal(record(config.bulk).supported, false)
      assert.equal(record(config.filter).supported, true)
      const types = resources((await request('/api/scim/v2/ResourceTypes')).body)
      assert.deepEqual(types.map((type) => type.name).sort(), ['Group', 'User'])
      const schemas = resources((await request('/api/scim/v2/Schemas')).body)
      assert(schemas.some((schema) => schema.id === USER_SCHEMA))
      assert(schemas.some((schema) => schema.id === GROUP_SCHEMA))
    }
  )

  await check(
    'Real session-authenticated administration creates scoped, hashed credentials',
    async () => {
      assert.equal((await admin(primary)).body.connection, null)
      const issued = await configure(primary)
      token = issued.secret
      credentialId = issued.id
      otherToken = (await configure(other)).secret
      const rows =
        await sql`select token_hash, scopes from scim_credential where id = ${credentialId}`
      assert.equal(rows[0]?.token_hash, createHash('sha256').update(token).digest('base64url'))
      assert.deepEqual(rows[0]?.scopes, ALL_SCOPES)
      const listed = (await admin(primary)).body
      assert(
        !JSON.stringify(listed).includes(token),
        'List responses must not reveal bearer secrets'
      )
      await admin(primary, '', { fixture: other, expected: 403 })
    }
  )

  await check(
    'Protocol authentication, malformed JSON, and content-type errors are SCIM responses',
    async () => {
      const missing = await request('/api/scim/v2/Users', { expected: 401 })
      assert.match(missing.headers.get('www-authenticate') ?? '', /Bearer/)
      await scim('synthetic-invalid-token', '/Users', { expected: 401 })
      const malformed = await scim(token, '/Users', { method: 'POST', rawBody: '{', expected: 400 })
      assert.equal(malformed.body.scimType, 'invalidSyntax')
      await scim(token, '/Users', {
        method: 'POST',
        rawBody: '{}',
        contentType: 'text/plain',
        expected: 415,
      })
    }
  )

  await check(
    'User creation supports Okta-shaped profiles and never persists or returns passwords',
    async () => {
      const alice = await scim(token, '/Users', {
        method: 'POST',
        expected: 201,
        body: {
          schemas: [USER_SCHEMA, CUSTOM_SCHEMA],
          userName: aliceEmail,
          externalId: 'alice-directory-id',
          active: true,
          name: { givenName: 'Alice', familyName: 'Example' },
          password: PASSWORD_MARKER,
          emails: [
            { value: aliceEmail, type: 'work', primary: true },
            { value: secondaryEmail, type: 'home', primary: false },
            { value: secondaryWorkEmail, type: 'work', primary: false },
          ],
          [CUSTOM_SCHEMA]: { tag: 'initial', sibling: 'retained' },
        },
      })
      aliceId = string(alice.body.id)
      assert(alice.headers.get('location')?.endsWith(`/Users/${aliceId}`))
      assert.equal(alice.body.active, true)
      assert(!JSON.stringify(alice.body).includes(PASSWORD_MARKER))
      const persisted = await sql`select user_id, attributes from scim_user where id = ${aliceId}`
      aliceUserId = string(persisted[0]?.user_id)
      assert(!JSON.stringify(persisted[0]?.attributes).includes(PASSWORD_MARKER))
      const bob = await scim(token, '/Users', {
        method: 'POST',
        expected: 201,
        body: {
          schemas: [USER_SCHEMA],
          userName: bobEmail,
          externalId: 'bob-directory-id',
          active: true,
        },
      })
      bobId = string(bob.body.id)
      const duplicate = await scim(token, '/Users', {
        method: 'POST',
        expected: 409,
        body: { schemas: [USER_SCHEMA], userName: aliceEmail },
      })
      assert.equal(duplicate.body.scimType, 'uniqueness')
    }
  )

  await check('Verified-domain and tenant boundaries reject foreign resources', async () => {
    const rejected = await scim(token, '/Users', {
      method: 'POST',
      expected: 400,
      body: { schemas: [USER_SCHEMA], userName: 'unverified@scim-unverified.test' },
    })
    assert.equal(rejected.body.scimType, 'invalidValue')
    await scim(otherToken, `/Users/${aliceId}`, { expected: 404 })
    await patch(
      otherToken,
      `/Users/${aliceId}`,
      [{ op: 'replace', path: 'active', value: false }],
      404
    )
    assert.equal((await scim(otherToken, '/Users')).body.totalResults, 0)
    assert.equal(
      (await scim(token, `/Users/${primary.ownerId}`, { expected: 404 })).body.status,
      '404'
    )
  })

  await check(
    'Stable pagination, zero-count discovery, case-insensitive filters, and invalid filters',
    async () => {
      const first = (await scim(token, '/Users?count=1&startIndex=1')).body
      const second = (await scim(token, '/Users?count=1&startIndex=2')).body
      assert.equal(first.totalResults, 2)
      assert.equal(first.itemsPerPage, 1)
      assert.notEqual(resources(first)[0]?.id, resources(second)[0]?.id)
      const empty = (await scim(token, '/Users?count=0')).body
      assert.equal(empty.totalResults, 2)
      assert.deepEqual(resources(empty), [])
      assert.equal(
        (await findUsers(token, `userName eq "${aliceEmail.toUpperCase()}"`))[0]?.id,
        aliceId
      )
      assert.equal((await findUsers(token, 'externalId eq "alice-directory-id"'))[0]?.id, aliceId)
      const invalid = await scim(
        token,
        `/Users?${new URLSearchParams({ filter: 'active eq "invalid"' })}`,
        { expected: 400 }
      )
      assert.equal(invalid.body.scimType, 'invalidFilter')
    }
  )

  await check(
    'Secondary, primary, and work email filters follow the represented email values',
    async () => {
      assert.equal((await findUsers(token, `emails.value eq "${secondaryEmail}"`))[0]?.id, aliceId)
      assert.equal(
        (await findUsers(token, `emails[type eq "work"].value eq "${aliceEmail}"`))[0]?.id,
        aliceId
      )
      assert.equal(
        (await findUsers(token, `emails[type eq "work"].value eq "${secondaryEmail}"`)).length,
        0
      )
      assert.equal(
        (await findUsers(token, `emails[type eq "work"].value eq "${secondaryWorkEmail}"`))[0]?.id,
        aliceId
      )
      assert.equal(
        (await findUsers(token, `emails[primary eq true].value eq "${secondaryEmail}"`)).length,
        0
      )
      const drifted = `renamed@${primary.domain}`
      await sql`update "user" set email = ${drifted}, normalized_email = ${drifted} where id = ${aliceUserId}`
      assert.equal((await findUsers(token, `emails.value eq "${drifted}"`))[0]?.id, aliceId)
      assert.equal((await findUsers(token, `emails.value eq "${aliceEmail}"`)).length, 0)
      assert.equal(
        (await findUsers(token, `emails[type eq "work"].value eq "${drifted}"`))[0]?.id,
        aliceId
      )
      await sql`update "user" set email = ${aliceEmail}, normalized_email = ${aliceEmail} where id = ${aliceUserId}`
    }
  )

  await check(
    'Entra-shaped PATCH accepts name objects, custom extension paths, and write-only passwords',
    async () => {
      const result = await patch(token, `/Users/${aliceId}`, [
        { op: 'Replace', path: 'name', value: { givenName: 'Alicia' } },
        { op: 'Replace', path: `${CUSTOM_SCHEMA}:tag`, value: 'updated' },
        { op: 'Replace', path: `${USER_SCHEMA.toUpperCase()}:PASSWORD`, value: PASSWORD_MARKER },
        { op: 'Add', value: { Password: PASSWORD_MARKER } },
      ])
      assert.equal(record(result.body.name).givenName, 'Alicia')
      assert.equal(record(result.body.name).familyName, 'Example')
      assert.equal(record(result.body[CUSTOM_SCHEMA]).tag, 'updated')
      assert.equal(record(result.body[CUSTOM_SCHEMA]).sibling, 'retained')
      const rows = await sql`select attributes from scim_user where id = ${aliceId}`
      assert(!JSON.stringify(rows[0]?.attributes).includes(PASSWORD_MARKER))
      assert(!JSON.stringify(result.body).includes(PASSWORD_MARKER))
      const atomic = await patch(
        token,
        `/Users/${aliceId}`,
        [
          { op: 'replace', path: 'name.givenName', value: 'Must roll back' },
          { op: 'remove', path: 'userName' },
        ],
        400
      )
      assert(atomic.body.scimType)
      assert.equal(record((await scim(token, `/Users/${aliceId}`)).body.name).givenName, 'Alicia')
    }
  )

  await check(
    'Attribute projection survives response validation for partial complex and schema-qualified paths',
    async () => {
      const selected = (
        await scim(token, `/Users/${aliceId}?attributes=name.givenName,emails.value`)
      ).body
      assert.deepEqual(selected.name, { givenName: 'Alicia' })
      assert(!('userName' in selected))
      assert(Array.isArray(selected.emails))
      assert(selected.emails.every((email) => Object.keys(record(email)).length === 1))
      const qualified = (
        await scim(
          token,
          `/Users/${aliceId}?${new URLSearchParams({ attributes: `${USER_SCHEMA}:name.familyName,${CUSTOM_SCHEMA}:tag` })}`
        )
      ).body
      assert.deepEqual(qualified.name, { familyName: 'Example' })
      assert.deepEqual(qualified[CUSTOM_SCHEMA], { tag: 'updated' })
      const excluded = (await scim(token, `/Users/${aliceId}?excludedAttributes=name.familyName`))
        .body
      assert.equal(record(excluded.name).givenName, 'Alicia')
      assert(!('familyName' in record(excluded.name)))
      const nonexistent = new URLSearchParams({
        attributes: `userName.foo,name.givenName.foo,emails.value.foo,${CUSTOM_SCHEMA}:tag.foo`,
      })
      const scalarDescendants = (await scim(token, `/Users/${aliceId}?${nonexistent}`)).body
      assert.deepEqual(Object.keys(scalarDescendants).sort(), ['id', 'meta', 'schemas'])
      const projectedList = resources((await scim(token, `/Users?${nonexistent}`)).body)
      assert.equal(projectedList.length, 2)
      for (const resource of projectedList) {
        assert.deepEqual(Object.keys(resource).sort(), ['id', 'meta', 'schemas'])
      }
    }
  )

  await check(
    'User PUT projects display names and repairs account drift without repeated writes',
    async () => {
      const profile = {
        schemas: [USER_SCHEMA],
        userName: bobEmail,
        externalId: 'bob-directory-id',
        active: true,
        name: { formatted: 'Bob Example', givenName: 'Robert', familyName: 'Example' },
        displayName: 'Robert Example',
      }
      const first = (await scim(token, `/Users/${bobId}`, { method: 'PUT', body: profile })).body
      const [account] = await sql`select u.id, u.name, u.updated_at, u.email_verified
        from "user" u join scim_user su on su.user_id = u.id where su.id = ${bobId}`
      assert.equal(account.name, 'Robert Example')
      assert.equal(record(first.name).formatted, 'Bob Example')
      const second = (await scim(token, `/Users/${bobId}`, { method: 'PUT', body: profile })).body
      assert.equal(record(first.name).givenName, 'Robert')
      assert.equal(record(first.meta).version, record(second.meta).version)
      assert.equal(record(first.meta).lastModified, record(second.meta).lastModified)
      assert.equal(
        (await sql`select updated_at from "user" where id = ${account.id}`)[0].updated_at.getTime(),
        account.updated_at.getTime()
      )

      await sql`update "user" set name = 'Old account name' where id = ${account.id}`
      const repaired = (await scim(token, `/Users/${bobId}`, { method: 'PUT', body: profile })).body
      const [restored] =
        await sql`select id, name, updated_at, email_verified from "user" where id = ${account.id}`
      assert.equal(restored.name, 'Robert Example')
      assert.equal(restored.email_verified, account.email_verified)
      assert.equal(repaired.id, bobId)
      const repeated = (await scim(token, `/Users/${bobId}`, { method: 'PUT', body: profile })).body
      assert.equal(record(repaired.meta).version, record(repeated.meta).version)
      assert.equal(
        (await sql`select updated_at from "user" where id = ${account.id}`)[0].updated_at.getTime(),
        restored.updated_at.getTime()
      )

      await patch(token, `/Users/${bobId}`, [{ op: 'remove', path: 'displayName' }])
      const fallback = (
        await patch(token, `/Users/${bobId}`, [
          { op: 'replace', path: 'name.givenName', value: 'Bobby' },
        ])
      ).body
      assert(!('displayName' in fallback))
      assert.equal(
        (await sql`select name from "user" where id = ${account.id}`)[0].name,
        'Bobby Example'
      )
    }
  )

  await check(
    'Group CRUD supports Entra member PATCH, duplicates, foreign IDs, and membership-only PUT versions',
    async () => {
      const created = (
        await scim(token, '/Groups', {
          method: 'POST',
          expected: 201,
          body: {
            schemas: [GROUP_SCHEMA],
            displayName: 'SCIM E2E Engineering',
            externalId: 'engineering-id',
            members: [{ value: aliceId }],
          },
        })
      ).body
      groupId = string(created.id)
      await scim(otherToken, `/Groups/${groupId}`, { expected: 404 })
      await patch(
        token,
        `/Groups/${groupId}`,
        [{ op: 'Add', path: 'members', value: [{ value: aliceId }, { value: primary.ownerId }] }],
        204
      )
      const initial = (await scim(token, `/Groups/${groupId}`)).body
      assert.equal((initial.members as unknown[]).length, 1)
      const replaced = (
        await scim(token, `/Groups/${groupId}`, {
          method: 'PUT',
          body: {
            schemas: [GROUP_SCHEMA],
            displayName: initial.displayName,
            externalId: 'engineering-id',
            members: [{ value: aliceId }, { value: bobId }],
          },
        })
      ).body
      assert.notEqual(record(initial.meta).lastModified, record(replaced.meta).lastModified)
      assert.equal(
        (replaced.members as unknown[]).map(record).find((member) => member.value === bobId)
          ?.display,
        'Bobby Example'
      )
      const listedGroup = resources((await scim(token, '/Groups')).body).find(
        (group) => group.id === groupId
      )
      assert(listedGroup)
      assert.equal(
        (listedGroup.members as unknown[]).map(record).find((member) => member.value === bobId)
          ?.display,
        'Bobby Example'
      )
      const stable = (
        await scim(token, `/Groups/${groupId}`, {
          method: 'PUT',
          body: {
            schemas: [GROUP_SCHEMA],
            displayName: initial.displayName,
            externalId: 'engineering-id',
            members: [{ value: aliceId }, { value: bobId }],
          },
        })
      ).body
      assert.equal(record(stable.meta).lastModified, record(replaced.meta).lastModified)
      await patch(
        token,
        `/Groups/${groupId}`,
        [{ op: 'Remove', path: 'members', value: [{ value: bobId }] }],
        204
      )
      const partial = (await scim(token, `/Groups/${groupId}?attributes=members.value`)).body
      assert.deepEqual(partial.members, [{ value: aliceId }])
      const scalarDescendants = (
        await scim(token, `/Groups/${groupId}?attributes=displayName.foo,members.value.foo`)
      ).body
      assert.deepEqual(Object.keys(scalarDescendants).sort(), ['id', 'meta', 'schemas'])
      const userGroups = (await scim(token, `/Users/${aliceId}?attributes=groups.value`)).body
      assert.deepEqual(userGroups.groups, [{ value: groupId }])
      const list = (
        await scim(
          token,
          `/Groups?${new URLSearchParams({ filter: 'displayName eq "SCIM E2E Engineering"' })}`
        )
      ).body
      assert.equal(resources(list)[0]?.id, groupId)
    }
  )

  await check(
    'Workspace, organization-role, and permission-group mappings project and withdraw access',
    async () => {
      await sql`insert into permissions (id, user_id, entity_type, entity_id, permission_type)
      values (${generateId()}, ${aliceUserId}, 'workspace', ${primary.workspaceId}, 'read')`
      await admin(primary, '/mappings', {
        method: 'POST',
        expected: 404,
        body: {
          groupId,
          targetKind: 'workspace',
          workspaceId: other.workspaceId,
          permissionType: 'write',
        },
      })
      const workspaceMapping = record(
        (
          await admin(primary, '/mappings', {
            method: 'POST',
            expected: 201,
            body: {
              groupId,
              targetKind: 'workspace',
              workspaceId: primary.workspaceId,
              permissionType: 'write',
            },
          })
        ).body.mapping
      )
      assert.equal(await permission(aliceUserId, primary.workspaceId), 'write')
      const roleMapping = record(
        (
          await admin(primary, '/mappings', {
            method: 'POST',
            expected: 201,
            body: { groupId, targetKind: 'org_role', role: 'admin' },
          })
        ).body.mapping
      )
      assert.equal(
        (await sql`select role from member where user_id = ${aliceUserId}`)[0]?.role,
        'admin'
      )
      const permissionGroupId = generateId()
      await sql`insert into permission_group (id, organization_id, name, created_by)
      values (${permissionGroupId}, ${primary.orgId}, 'SCIM E2E Restrictions', ${primary.ownerId})`
      await sql`insert into permission_group_workspace (id, permission_group_id, workspace_id, organization_id)
      values (${generateId()}, ${permissionGroupId}, ${primary.workspaceId}, ${primary.orgId})`
      const groupMapping = record(
        (
          await admin(primary, '/mappings', {
            method: 'POST',
            expected: 201,
            body: { groupId, targetKind: 'permission_group', permissionGroupId },
          })
        ).body.mapping
      )
      assert.equal(
        (await sql`select membership_mode from permission_group where id = ${permissionGroupId}`)[0]
          ?.membership_mode,
        'explicit'
      )
      assert.equal(
        (
          await sql`select user_id from permission_group_member where permission_group_id = ${permissionGroupId}`
        )[0]?.user_id,
        aliceUserId
      )
      await patch(
        token,
        `/Groups/${groupId}`,
        [{ op: 'remove', path: `members[value eq "${aliceId}"]` }],
        204
      )
      assert.equal(await permission(aliceUserId, primary.workspaceId), 'read')
      assert.equal(
        (await sql`select role from member where user_id = ${aliceUserId}`)[0]?.role,
        'member'
      )
      assert.equal(
        (
          await sql`select id from permission_group_member where permission_group_id = ${permissionGroupId}`
        ).length,
        0
      )
      await patch(
        token,
        `/Groups/${groupId}`,
        [{ op: 'add', path: 'members', value: [{ value: aliceId }] }],
        204
      )
      assert.equal(await permission(aliceUserId, primary.workspaceId), 'write')
      await sql`update permissions set permission_type = 'read'
        where user_id = ${aliceUserId} and entity_type = 'workspace' and entity_id = ${primary.workspaceId}`
      const reconciled = (await admin(primary, '/reconcile', { method: 'POST' })).body
      assert.equal(reconciled.reconciledUsers, 2)
      assert.equal(await permission(aliceUserId, primary.workspaceId), 'write')
      for (const mapping of [workspaceMapping, roleMapping, groupMapping]) {
        await admin(primary, `/mappings/${string(mapping.id)}`, { method: 'DELETE' })
      }
      assert.equal(await permission(aliceUserId, primary.workspaceId), 'read')
      assert.equal(
        (await sql`select membership_mode from permission_group where id = ${permissionGroupId}`)[0]
          ?.membership_mode,
        'explicit'
      )
    }
  )

  await check(
    'Managed membership locks block invitations and permission edits while allowing unmanaged members',
    async () => {
      const manualUserId = generateId()
      const manualEmail = `manual@${primary.domain}`
      await sql`insert into "user" (id, name, email, normalized_email, email_verified, created_at, updated_at)
        values (${manualUserId}, 'Manual E2E member', ${manualEmail}, ${manualEmail}, true, now(), now())`
      await sql`insert into user_stats (id, user_id) values (${generateId()}, ${manualUserId})`
      await sql`insert into member (id, user_id, organization_id, role)
        values (${generateId()}, ${manualUserId}, ${primary.orgId}, 'member')`
      await admin(primary, '', {
        method: 'PUT',
        body: { settings: { lockManualMembership: true } },
      })
      try {
        const invitationBody = {
          workspaceIds: [primary.workspaceId],
          permission: 'read',
          membership: 'member',
        }
        const managedInvite = (
          await request('/api/workspaces/invitations/batch', {
            fixture: primary,
            method: 'POST',
            contentType: 'application/json',
            body: { ...invitationBody, emails: [aliceEmail] },
          })
        ).body
        assert.equal(managedInvite.success, false)
        assert(Array.isArray(managedInvite.failed))
        assert.match(string(record(managedInvite.failed[0]).error), /identity provider/)
        assert(!JSON.stringify(managedInvite).includes('select '))
        await request(`/api/workspaces/${primary.workspaceId}/permissions`, {
          fixture: primary,
          method: 'PATCH',
          expected: 403,
          contentType: 'application/json',
          body: { updates: [{ userId: aliceUserId, permissions: 'write' }] },
        })
        assert.equal(await permission(aliceUserId, primary.workspaceId), 'read')
        const manualInvite = (
          await request('/api/workspaces/invitations/batch', {
            fixture: primary,
            method: 'POST',
            contentType: 'application/json',
            body: { ...invitationBody, emails: [manualEmail] },
          })
        ).body
        assert.equal(manualInvite.success, true)
        assert.deepEqual(manualInvite.added, [manualEmail])
        await request(`/api/workspaces/${primary.workspaceId}/permissions`, {
          fixture: primary,
          method: 'PATCH',
          contentType: 'application/json',
          body: { updates: [{ userId: manualUserId, permissions: 'write' }] },
        })
        assert.equal(await permission(manualUserId, primary.workspaceId), 'write')
      } finally {
        await admin(primary, '', {
          method: 'PUT',
          body: { settings: { lockManualMembership: false } },
        })
      }
    }
  )

  await check(
    'Deactivation revokes sessions, retains memberships, and reactivation preserves manual suspensions',
    async () => {
      await sql`insert into session (id, token, user_id, expires_at, created_at, updated_at)
      values (${generateId()}, ${generateShortId()}, ${aliceUserId}, now() + interval '1 day', now(), now())`
      const inactive = (
        await patch(token, `/Users/${aliceId}`, [{ op: 'Replace', path: 'active', value: 'False' }])
      ).body
      assert.equal(inactive.active, false)
      assert.equal((await sql`select id from session where user_id = ${aliceUserId}`).length, 0)
      assert.equal(
        (await sql`select suspension_source from "user" where id = ${aliceUserId}`)[0]
          ?.suspension_source,
        'scim'
      )
      assert.equal((await sql`select id from member where user_id = ${aliceUserId}`).length, 1)
      assert.equal(await permission(aliceUserId, primary.workspaceId), 'read')
      assert.equal(
        (
          await patch(token, `/Users/${aliceId}`, [
            { op: 'Replace', path: 'active', value: 'True' },
          ])
        ).body.active,
        true
      )
      await sql`update "user" set suspended_at = now(), suspension_source = 'manual' where id = ${aliceUserId}`
      await patch(token, `/Users/${aliceId}`, [{ op: 'replace', path: 'active', value: false }])
      assert.equal(
        (await patch(token, `/Users/${aliceId}`, [{ op: 'replace', path: 'active', value: true }]))
          .body.active,
        false
      )
      assert.equal(
        (await sql`select suspension_source from "user" where id = ${aliceUserId}`)[0]
          ?.suspension_source,
        'manual'
      )
      assert((await findUsers(token, 'active eq false')).some((item) => item.id === aliceId))
      assert(!(await findUsers(token, 'active eq true')).some((item) => item.id === aliceId))
      await sql`update "user" set suspended_at = null, suspension_source = null where id = ${aliceUserId}`
    }
  )

  await check(
    'Directory operations cannot deactivate or delete an organization owner',
    async () => {
      await scim(token, '/Users', {
        method: 'POST',
        expected: 409,
        body: { schemas: [USER_SCHEMA], userName: `owner@${primary.domain}`, active: false },
      })
      const owner = (
        await scim(token, '/Users', {
          method: 'POST',
          expected: 201,
          body: { schemas: [USER_SCHEMA], userName: `owner@${primary.domain}`, active: true },
        })
      ).body
      const ownerId = string(owner.id)
      await patch(
        token,
        `/Users/${ownerId}`,
        [{ op: 'replace', path: 'active', value: false }],
        409
      )
      await scim(token, `/Users/${ownerId}`, { method: 'DELETE', expected: 409 })
      assert.equal((await scim(token, `/Users/${ownerId}`)).body.active, true)
    }
  )

  await check(
    'Group deletion and user tombstones remove access and relink the same account on rehire',
    async () => {
      await scim(token, `/Groups/${groupId}`, { method: 'DELETE', expected: 204 })
      await scim(token, `/Groups/${groupId}`, { expected: 404 })
      const bobUserId = string(
        (await sql`select user_id from scim_user where id = ${bobId}`)[0]?.user_id
      )
      await scim(token, `/Users/${bobId}`, { method: 'DELETE', expected: 204 })
      await scim(token, `/Users/${bobId}`, { expected: 404 })
      await scim(token, `/Users/${bobId}`, { method: 'DELETE', expected: 404 })
      assert.equal((await sql`select id from member where user_id = ${bobUserId}`).length, 0)
      assert.equal((await sql`select id from "user" where id = ${bobUserId}`).length, 1)
      const rehired = (
        await scim(token, '/Users', {
          method: 'POST',
          expected: 201,
          body: {
            schemas: [USER_SCHEMA],
            userName: bobEmail,
            externalId: 'bob-directory-id',
            active: true,
          },
        })
      ).body
      assert.notEqual(rehired.id, bobId)
      assert.equal(
        (await sql`select user_id from scim_user where id = ${string(rehired.id)}`)[0]?.user_id,
        bobUserId
      )
    }
  )

  await check(
    'Bearer scopes, shared connection rate limits, rotation, revocation, expiry, and disable apply immediately',
    async () => {
      await sql`update scim_credential set scopes = ${sql.json(['users:read'])} where id = ${credentialId}`
      await scim(token, '/Users')
      await patch(token, `/Users/${aliceId}`, [{ op: 'replace', path: 'active', value: true }], 403)
      await scim(token, '/Groups', { expected: 403 })
      await sql`update scim_credential set scopes = ${sql.json(ALL_SCOPES)} where id = ${credentialId}`
      const rotated = (
        await admin(primary, '/credentials', {
          method: 'POST',
          body: { expiresInDays: 1 },
          expected: 201,
        })
      ).body
      const newToken = string(rotated.secret)
      const newCredentialId = string(record(rotated.credential).id)
      await admin(primary, '/credentials', { method: 'POST', body: {}, expected: 409 })
      await scim(token, '/Users')
      await scim(newToken, '/Users')
      const connectionId = string(
        (await sql`select id from scim_connection where organization_id = ${primary.orgId}`)[0]?.id
      )
      const bucketKey = `route:scim:connection:${connectionId}`
      const exhausted = await sql`update rate_limit_bucket set tokens = 0, last_refill_at = now()
        where key = ${bucketKey} returning key`
      assert.equal(exhausted.length, 1, 'Run the local app with PostgreSQL rate-limit storage')
      try {
        const limited = await scim(token, '/Users', { expected: 429 })
        assert(Number(limited.headers.get('retry-after')) >= 1)
        assert(limited.headers.has('x-ratelimit-reset'))
        await scim(newToken, '/Users', { expected: 429 })
        await scim(otherToken, '/Users')
      } finally {
        await sql`delete from rate_limit_bucket where key = ${bucketKey}`
      }
      await admin(primary, `/credentials/${credentialId}`, { method: 'DELETE' })
      await scim(token, '/Users', { expected: 401 })
      await scim(newToken, '/Users')
      await admin(primary, '', { method: 'PUT', body: { status: 'disabled' } })
      await scim(newToken, '/Users', { expected: 401 })
      await admin(primary, '', { method: 'PUT', body: { status: 'active' } })
      await scim(newToken, '/Users')
      await sql`update scim_credential set expires_at = now() - interval '1 minute' where id = ${newCredentialId}`
      await scim(newToken, '/Users', { expected: 401 })
      const activity = (await admin(primary, '/activity?limit=200')).body.entries
      assert(Array.isArray(activity))
      assert(activity.some((entry) => record(entry).status === 201))
      assert(activity.some((entry) => record(entry).status === 403))
      assert(!JSON.stringify(activity).includes(PASSWORD_MARKER))
    }
  )
}

try {
  await run()
} catch (error) {
  logger.error('SCIM E2E failed', { error: getErrorMessage(error) })
  process.exitCode = 1
} finally {
  try {
    await cleanup()
    logger.info('Removed isolated SCIM E2E fixtures')
  } catch (error) {
    logger.error('SCIM E2E fixture cleanup failed', { error: getErrorMessage(error) })
    process.exitCode = 1
  }
  await sql.end()
  const report = {
    startedAt,
    completedAt: new Date().toISOString(),
    status: process.exitCode ? 'failed' : 'passed',
    transport: 'Real HTTP against a local Next.js app and PostgreSQL; provider payload emulation',
    requestCount,
    checks,
  }
  if (process.env.SCIM_E2E_REPORT_PATH) {
    await writeFile(process.env.SCIM_E2E_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
  }
  logger.info(
    `SCIM E2E ${report.status}: ${checks.filter((item) => item.status === 'passed').length}/${checks.length} checks, ${requestCount} HTTP requests`
  )
}
