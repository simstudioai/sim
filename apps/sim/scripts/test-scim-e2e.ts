import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
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
    await tx`insert into project (id, name, owner_id, organization_id)
      values (${fixture.workspaceId}, 'SCIM E2E Project', ${fixture.ownerId}, ${fixture.orgId})`
    await tx`insert into workspace (id, project_id, name, owner_id, billed_account_user_id, organization_id)
      values (${fixture.workspaceId}, ${fixture.workspaceId}, 'SCIM E2E Workspace', ${fixture.ownerId}, ${fixture.ownerId}, ${fixture.orgId})`
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
      if (userIds.length) await tx`delete from project where owner_id in ${tx(userIds)}`
      await tx`delete from project where organization_id = ${fixture.orgId}`
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
    'Hosted SCIM rejects administration and bearer access after Enterprise entitlement ends',
    async () => {
      await admin(primary)
      await scim(token, '/Users')
      await sql`update subscription set status = 'canceled' where reference_id = ${primary.orgId}`
      try {
        const denied = await admin(primary, '', { expected: 403 })
        assert.match(string(denied.body.error), /active enterprise subscription/)
        await request(`/api/organizations/${primary.orgId}/people/import`, {
          method: 'POST',
          fixture: primary,
          contentType: 'application/json',
          body: { source: 'directory', apply: false },
          expected: 403,
        })
        await scim(token, '/Users', { expected: 401 })
      } finally {
        await sql`update subscription set status = 'active' where reference_id = ${primary.orgId}`
      }
      await admin(primary)
      await scim(token, '/Users')
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

  await check(
    'People previews then imports mapped profiles and same-directory reporting lines',
    async () => {
      const enterprise = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'
      const people = `/api/organizations/${primary.orgId}/people`
      const pull = (apply: boolean, previewDigest?: string, expected = 200) =>
        request(`${people}/import`, {
          method: 'POST',
          fixture: primary,
          contentType: 'application/json',
          body: { source: 'directory', apply, previewDigest },
          expected,
        })
      await patch(token, `/Users/${aliceId}`, [
        { op: 'replace', path: 'title', value: 'Engineer' },
        { op: 'replace', path: `${enterprise}:department`, value: 'Engineering' },
        { op: 'replace', path: `${enterprise}:manager.value`, value: bobId },
      ])
      const before = await pull(false)
      assert.equal(before.body.updated, 1)
      const alice =
        await sql`select id from member where organization_id = ${primary.orgId} and user_id = ${aliceUserId}`
      const focusPath = `${people}/chart?memberId=${string(alice[0]?.id)}`
      assert.deepEqual((await request(focusPath, { fixture: primary })).body.chain, [])
      const digest = string(before.body.previewDigest)
      await patch(token, `/Users/${aliceId}`, [{ op: 'replace', path: 'title', value: 'Director' }])
      await pull(true, digest, 409)
      assert.equal(record((await request(focusPath, { fixture: primary })).body.person).title, null)
      await patch(token, `/Users/${aliceId}`, [{ op: 'replace', path: 'title', value: 'Engineer' }])
      const screenshotDir = process.env.PEOPLE_E2E_SCREENSHOT_DIR
      if (screenshotDir) {
        const { chromium, expect: browserExpect } = await import('@playwright/test')
        const expect = browserExpect.configure({ timeout: 60_000 })
        const browser = await chromium.launch()
        try {
          const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
          page.setDefaultTimeout(60_000)
          await page
            .context()
            .addCookies([
              { name: 'better-auth.session_token', value: primary.cookie, url: baseUrl.origin },
            ])
          await page.goto(new URL(`/o/${primary.orgId}/people`, baseUrl).href, {
            waitUntil: 'domcontentloaded',
            timeout: 180_000,
          })
          await page.getByRole('button', { name: 'Import people', exact: true }).click()
          const picker = page.getByRole('dialog', { name: 'Import people data' })
          await picker.getByRole('button', { name: 'SCIM provisioning' }).click()
          await page
            .getByRole('dialog', { name: 'Import from SCIM provisioning' })
            .getByRole('button', { name: 'Preview import' })
            .click()
          const modal = page.getByRole('dialog', { name: 'Review import' })
          await expect(modal.getByText(/1 profile will be updated/)).toBeVisible()
          await mkdir(screenshotDir, { recursive: true })
          await page.screenshot({ path: join(screenshotDir, 'provisioned-import.png') })
          await modal.getByRole('button', { name: 'Import', exact: true }).click()
          await expect(modal).toHaveCount(0)
        } finally {
          await browser.close()
        }
      } else {
        assert.equal((await pull(true, digest)).body.updated, 1)
      }
      const focus = (await request(focusPath, { fixture: primary })).body
      assert.equal(record(focus.person).title, 'Engineer')
      assert.equal(record(focus.person).department, 'Engineering')
      assert.equal(record(record(focus.person).manager).email, bobEmail)
      assert.equal((await pull(true, digest)).body.updated, 0)
      const foreign = await scim(otherToken, '/Users', {
        method: 'POST',
        expected: 201,
        body: { schemas: [USER_SCHEMA], userName: `manager@${other.domain}`, active: true },
      })
      await patch(token, `/Users/${aliceId}`, [
        { op: 'replace', path: `${enterprise}:manager.value`, value: string(foreign.body.id) },
        { op: 'remove', path: `${enterprise}:department` },
      ])
      const nextPreview = await pull(false)
      const unresolved = await pull(true, string(nextPreview.body.previewDigest))
      assert.equal(unresolved.body.warnings, 1)
      const retained = record((await request(focusPath, { fixture: primary })).body.person)
      assert.equal(record(retained.manager).email, bobEmail)
      assert.equal(retained.department, 'Engineering')
      await scim(otherToken, `/Users/${string(foreign.body.id)}`, {
        method: 'DELETE',
        expected: 204,
      })
    }
  )

  await check(
    'SCIM changes refresh the chart through the cron, retain the last good tree on failure, and recover',
    async () => {
      const syncPath = `/api/organizations/${primary.orgId}/people/sync`
      const cronPath = '/api/cron/people-directory-sync'
      const connection = (options: RequestOptions = {}) =>
        request(syncPath, { fixture: primary, contentType: 'application/json', ...options })
      const tick = () => request(cronPath, { token: requiredEnvironment('CRON_SECRET') })
      const chart = async () => {
        const result = await request(
          `/api/organizations/${primary.orgId}/people/chart?memberId=${aliceMemberId}`,
          { fixture: primary }
        )
        return record(result.body.person)
      }
      const enterprise = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'
      const [membership] =
        await sql`select id from member where user_id = ${aliceUserId} and organization_id = ${primary.orgId}`
      const aliceMemberId = string(membership.id)
      await request(cronPath, { expected: 401 })
      await request(syncPath, { expected: 401 })
      assert.equal((await connection()).body.sync, null)
      await patch(token, `/Users/${aliceId}`, [
        { op: 'replace', path: `${enterprise}:manager.value`, value: bobId },
      ])
      const initial = record(
        (await connection({ method: 'PUT', body: { source: 'scim' } })).body.sync
      )
      assert.equal(initial.state, 'scheduled')
      assert(initial.lastSuccessAt)
      assert.equal(record((await chart()).manager).email, bobEmail)
      await patch(token, `/Users/${aliceId}`, [
        { op: 'replace', path: 'title', value: 'Principal Engineer' },
        { op: 'remove', path: `${enterprise}:manager` },
      ])
      assert.equal(record((await connection()).body.sync).state, 'queued')
      await tick()
      assert.equal((await chart()).manager, null)
      assert.equal((await chart()).title, 'Principal Engineer')
      const success = record((await connection()).body.sync).lastSuccessAt

      await patch(token, `/Users/${aliceId}`, [
        { op: 'replace', path: `${enterprise}:manager.value`, value: bobId },
      ])
      await patch(token, `/Users/${bobId}`, [
        { op: 'replace', path: `${enterprise}:manager.value`, value: aliceId },
      ])
      await tick()
      const failed = record((await connection()).body.sync)
      assert.equal(failed.state, 'failed')
      assert.equal(failed.lastSuccessAt, success)
      assert.equal(failed.retryAt, failed.nextSyncAt)
      assert.equal(failed.retryBlocked, false)
      assert.match(string(failed.lastError), /reporting loop/i)
      assert(failed.lastFailedAt)
      assert.equal((await chart()).manager, null)
      await patch(token, `/Users/${bobId}`, [{ op: 'remove', path: `${enterprise}:manager` }])
      const screenshotDir = process.env.PEOPLE_E2E_SCREENSHOT_DIR
      if (screenshotDir) {
        const { chromium, expect: browserExpect } = await import('@playwright/test')
        const expect = browserExpect.configure({ timeout: 60_000 })
        const browser = await chromium.launch()
        try {
          const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
          page.setDefaultTimeout(60_000)
          await page
            .context()
            .addCookies([
              { name: 'better-auth.session_token', value: primary.cookie, url: baseUrl.origin },
            ])
          await page.goto(
            new URL(`/o/${primary.orgId}/people?focus=${aliceMemberId}`, baseUrl).href
          )
          const statusUrl = new URL(syncPath, baseUrl).href
          await page.route(statusUrl, (route) =>
            route.fulfill({ status: 503, json: { error: 'Unavailable' } })
          )
          await page.getByRole('button', { name: 'Directory sync', exact: true }).click()
          const modal = page.getByRole('dialog', { name: 'Directory sync', exact: true })
          await modal.getByRole('button', { name: 'Retry connection' }).waitFor()
          await page.unroute(statusUrl)
          await expect(modal.getByText('Sync failed', { exact: true })).toBeVisible({
            timeout: 60_000,
          })
          await expect(modal.getByText(/reporting loop/)).toBeVisible()
          await page.screenshot({ path: join(screenshotDir, 'sync-failure.png') })
          await modal.getByRole('button', { name: 'Retry sync' }).click()
          await expect(modal.getByText('Connected', { exact: true })).toBeVisible()
          await expect(modal.getByText('Last successful sync')).toBeVisible()
          await page.setViewportSize({ width: 390, height: 844 })
          await page.screenshot({ path: join(screenshotDir, 'sync-recovered-mobile.png') })
          const dialogBox = await modal.boundingBox()
          assert(dialogBox && dialogBox.x >= 0 && dialogBox.x + dialogBox.width <= 391)
          assert.equal(record((await chart()).manager).email, bobEmail)
          await expect(page.getByText('Principal Engineer', { exact: true })).toBeAttached()
          await patch(token, `/Users/${aliceId}`, [
            { op: 'replace', path: 'title', value: 'Staff Platform Engineer' },
          ])
          await tick()
          await expect(page.getByText('Staff Platform Engineer', { exact: true })).toBeAttached({
            timeout: 60_000,
          })
          await modal.getByRole('button', { name: 'Disconnect', exact: true }).click()
          await page
            .getByRole('dialog', { name: 'Disconnect directory' })
            .getByRole('button', { name: 'Disconnect', exact: true })
            .click()
          await expect(
            modal.getByRole('button', { name: 'Connect SCIM provisioning' })
          ).toBeVisible()
          await modal.getByRole('button', { name: 'Connect SCIM provisioning' }).click()
          await page
            .getByRole('dialog', { name: 'Connect SCIM provisioning' })
            .getByRole('button', { name: 'Connect and sync' })
            .click()
          await expect(modal.getByText('Connected', { exact: true })).toBeVisible()
        } finally {
          await browser.close()
        }
      } else {
        const recovered = record(
          (await request(`${syncPath}/run`, { method: 'POST', fixture: primary })).body.sync
        )
        assert.equal(recovered.state, 'scheduled')
        assert.equal(recovered.lastError, null)
        assert.equal(recovered.lastFailedAt, failed.lastFailedAt)
      }
      assert.equal(record((await chart()).manager).email, bobEmail)
      await connection({ method: 'DELETE' })
      assert.equal((await connection()).body.sync, null)
      assert.equal((await chart()).title, 'Engineer')
    }
  )

  await check(
    'a SCIM directory beyond 10,000 users publishes its full chart over HTTP',
    async () => {
      const fixture = await seedFixture()
      await configure(fixture)
      const [source] =
        await sql`select id from scim_connection where organization_id = ${fixture.orgId}`
      const prefix = `${generateId()}-scim-`
      const size = 10_004
      const longPrefix = `Team 49 ${'界'.repeat(2039)}`
      const longA = `${longPrefix}A`
      const longB = `${longPrefix}B`
      const legacy = `Team 60 ${'x'.repeat(220)}`
      const longName = `Person 00050 ${'界'.repeat(450)}`
      const managerEmail = `person${size}@${fixture.domain}`
      const directoryPath = `/api/organizations/${fixture.orgId}/people`
      try {
        await sql.begin(async (tx) => {
          await tx`insert into "user" (id, name, email, email_verified, created_at, updated_at)
          select ${prefix}::text || n, case when n=50 then ${longName} else 'Person ' || lpad(n::text, 5, '0') end, 'person' || n || '@' || ${fixture.domain}::text, true, now(), now()
          from generate_series(1, ${size}::integer) n`
          await tx`insert into scim_user (id, connection_id, user_id, user_name, active, attributes, order_key)
          select 'scim-' || ${prefix}::text || n, ${source.id}, ${prefix}::text || n, email, true,
            jsonb_build_object('active', true, 'userName', email, 'name', jsonb_build_object('formatted', name),
              'emails', jsonb_build_array(jsonb_build_object('value', email, 'primary', true)),
              'enterprise', jsonb_build_object('department', case n % 71 when 49 then ${longA} when 50 then ${longB}
                when 60 then ${legacy} else 'Team ' || lpad((n % 71)::text,2,'0') end) ||
                case when n = ${size} then '{}'::jsonb else jsonb_build_object('manager',
                  jsonb_build_object('value', 'scim-' || ${prefix}::text || ${size}::text)) end),
            lpad(n::text, 5, '0')
          from generate_series(1, ${size}::integer) n join "user" on id = ${prefix}::text || n`
        })
        const result = await request(`${directoryPath}/sync`, {
          method: 'PUT',
          fixture,
          contentType: 'application/json',
          body: { source: 'scim' },
        })
        assert.equal(record(result.body.sync).state, 'scheduled')
        const first = (await request(`${directoryPath}/departments`, { fixture })).body
        assert(Array.isArray(first.departments) && first.departments.length === 50)
        assert.equal(record(first.departments.at(-1)).name, longB)
        assert(
          string(first.nextCursor).length < 512,
          'A department page cursor must fit in a short URL'
        )
        const second = (
          await request(
            `${directoryPath}/departments?cursor=${encodeURIComponent(string(first.nextCursor))}`,
            { fixture }
          )
        ).body
        assert(Array.isArray(second.departments) && second.nextCursor === null)
        const teams = [...first.departments, ...second.departments].map(record)
        assert.equal(new Set(teams.map((team) => team.name)).size, 71)
        assert.equal(
          teams.reduce((sum, team) => sum + Number(team.count), 0),
          size
        )
        for (const label of [longA, longB]) {
          const key = string(teams.find((team) => team.name === label)?.departmentKey)
          assert(key.length <= 64)
          const path = `${directoryPath}?departmentKey=${encodeURIComponent(key)}`
          const selected = (await request(path, { fixture })).body
          assert.equal(selected.selectedDepartment, label)
          assert(Array.isArray(selected.people) && selected.people.length === 50)
          assert(selected.people.every((person) => record(person).department === label))
          const person = record(selected.people[0])
          const profile = record(
            (await request(`${directoryPath}/${person.memberId}`, { fixture })).body.person
          )
          assert.equal(
            profile.departmentKey,
            key,
            'Profile and facet must link to the same department'
          )
          const empty = (await request(`${path}&search=does-not-exist`, { fixture })).body
          assert.deepEqual(empty.people, [])
          assert.equal(empty.selectedDepartment, label)
          await request(
            `${path}&cursor=${encodeURIComponent(string(selected.nextCursor))}&search=changed`,
            { fixture, expected: 400 }
          )
        }
        const legacyList = (
          await request(`${directoryPath}?department=${encodeURIComponent(legacy)}`, { fixture })
        ).body
        assert(Array.isArray(legacyList.people) && legacyList.people.length === 50)
        assert(legacyList.people.every((person) => record(person).department === legacy))
        const byName = (await request(`${directoryPath}?search=person`, { fixture })).body
        assert(Array.isArray(byName.people) && record(byName.people.at(-1)).name === longName)
        assert(
          string(byName.nextCursor).length < 512,
          'A long name must not inflate a people cursor'
        )
        const nextNames = (
          await request(
            `${directoryPath}?search=person&cursor=${encodeURIComponent(string(byName.nextCursor))}`,
            { fixture }
          )
        ).body
        assert(
          Array.isArray(nextNames.people) &&
            record(nextNames.people[0]).email === `person51@${fixture.domain}`
        )
        const filtered = (
          await request(`${directoryPath}/departments?search=Team%2070`, { fixture })
        ).body
        assert(Array.isArray(filtered.departments) && filtered.departments.length === 1)
        const listed = await request(
          `${directoryPath}?search=${encodeURIComponent(managerEmail)}`,
          { fixture }
        )
        assert(Array.isArray(listed.body.people) && listed.body.people.length === 1)
        const managerId = string(record(listed.body.people[0]).memberId)
        const page = await request(
          `${directoryPath}/chart?memberId=${encodeURIComponent(managerId)}&size=4&page=2501`,
          { fixture }
        )
        assert.equal(page.body.totalReports, size - 1)
        assert.equal(page.body.page, 2501)
        assert(Array.isArray(page.body.reports) && page.body.reports.length === 3)
        assert.equal(record(page.body.reports[2]).email, `person10003@${fixture.domain}`)

        await sql`update scim_user set attributes=jsonb_set(attributes, '{enterprise,department}', to_jsonb(repeat('x',2049)))
          where connection_id=${source.id} and user_id=${`${prefix}${size}`}`
        const rejected = record(
          (await request(`${directoryPath}/sync/run`, { method: 'POST', fixture })).body.sync
        )
        assert.equal(rejected.state, 'failed')
        assert.match(string(rejected.lastError), /department exceeds 2048 characters/i)
        const retained = record(
          (await request(`${directoryPath}/${managerId}`, { fixture })).body.person
        )
        assert.equal(retained.department, `Team ${String(size % 71).padStart(2, '0')}`)
      } finally {
        await sql`delete from people_directory_sync where organization_id = ${fixture.orgId}`
        await sql`delete from "user" where id like ${`${prefix}%`}`
      }
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
    'Address changes and directory removal retire OAuth grants instead of restoring them after suspension',
    async () => {
      const carolEmail = `carol@${primary.domain}`
      const created = await scim(token, '/Users', {
        method: 'POST',
        expected: 201,
        body: {
          schemas: [USER_SCHEMA],
          userName: carolEmail,
          active: true,
          name: { givenName: 'Carol', familyName: 'Example' },
          emails: [{ value: carolEmail, type: 'work', primary: true }],
        },
      })
      const carolId = string(created.body.id)
      const userId = string(
        (await sql`select user_id from scim_user where id = ${carolId}`)[0]?.user_id
      )
      const sessionId = generateId()
      const clientId = generateId()
      await sql`insert into session (id, token, user_id, expires_at, created_at, updated_at)
      values (${sessionId}, ${generateShortId()}, ${userId}, now() + interval '1 day', now(), now())`
      await sql`insert into oauth_client (id, client_id, name, public, token_endpoint_auth_method, grant_types, redirect_uris)
      values (${clientId}, ${clientId}, 'SCIM E2E OAuth client', true, 'none',
        ${['authorization_code', 'refresh_token']}, ${['http://127.0.0.1/callback']})`
      try {
        await sql`insert into oauth_consent (id, client_id, user_id, scopes, created_at, updated_at)
        values (${generateId()}, ${clientId}, ${userId}, ${['api:read']}, now(), now())`
        await sql`insert into oauth_token_family (id, client_id, user_id, session_id, created_at, expires_at)
        values (${generateId()}, ${clientId}, ${userId}, ${sessionId}, now(), now() + interval '1 day')`
        await sql`insert into oauth_access_token (id, token, client_id, user_id, scopes, created_at, expires_at)
        values (${generateId()}, ${generateShortId()}, ${clientId}, ${userId}, ${['api:read']},
          now(), now() + interval '1 hour')`

        await patch(token, `/Users/${carolId}`, [
          { op: 'replace', path: 'name.givenName', value: 'Caroline' },
        ])
        assert.equal(
          (await sql`select id from oauth_access_token where user_id = ${userId}`).length,
          1
        )

        await patch(token, `/Users/${carolId}`, [
          {
            op: 'replace',
            path: 'emails[type eq "work"].value',
            value: `carol-renamed@${primary.domain}`,
          },
        ])

        assert.equal((await sql`select id from session where user_id = ${userId}`).length, 0)
        assert.equal(
          (await sql`select id from oauth_token_family where user_id = ${userId}`).length,
          0
        )
        assert.equal(
          (await sql`select id from oauth_access_token where user_id = ${userId}`).length,
          0
        )

        const rawToken = generateShortId(32)
        const bearer = `sim_oat_${rawToken}`
        await sql`insert into oauth_token_family (id, client_id, user_id, created_at, expires_at)
        values (${generateId()}, ${clientId}, ${userId}, now(), now() + interval '1 day')`
        await sql`insert into oauth_access_token (id, token, client_id, user_id, scopes, created_at, expires_at)
        values (${generateId()}, ${createHash('sha256').update(rawToken).digest('hex')},
          ${clientId}, ${userId}, ${['api:read']}, now(), now() + interval '1 hour')`
        await request('/api/v2/workspaces', { token: bearer })
        await patch(token, `/Users/${carolId}`, [{ op: 'replace', path: 'active', value: false }])
        await request('/api/v2/workspaces', { token: bearer, expected: 401 })
        await scim(token, `/Users/${carolId}`, { method: 'DELETE', expected: 204 })
        await request('/api/v2/workspaces', { token: bearer, expected: 401 })
        assert.equal(
          (await sql`select id from oauth_token_family where user_id = ${userId}`).length,
          0,
          'Directory removal must retire refresh families as well as sessions'
        )
        assert.equal(
          (await sql`select id from oauth_access_token where user_id = ${userId}`).length,
          0
        )
      } finally {
        await sql`delete from oauth_client where client_id = ${clientId}`
        await sql`delete from "user" where id = ${userId}`
      }
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
    'Renaming an automatically matched group withdraws its old policy even when the new target is already mapped',
    async () => {
      await admin(primary, '', {
        method: 'PUT',
        body: { settings: { autoMapPermissionGroupsByName: true } },
      })
      try {
        for (const method of ['PATCH', 'PUT'] as const) {
          const oldPolicyId = generateId()
          const newPolicyId = generateId()
          const oldName = `SCIM E2E ${method} Old policy`
          const newName = `SCIM E2E ${method} New policy`
          await sql`insert into permission_group (id, organization_id, name, created_by)
          values (${oldPolicyId}, ${primary.orgId}, ${oldName}, ${primary.ownerId}),
            (${newPolicyId}, ${primary.orgId}, ${newName}, ${primary.ownerId})`
          const created = await scim(token, '/Groups', {
            method: 'POST',
            expected: 201,
            body: {
              schemas: [GROUP_SCHEMA],
              displayName: oldName,
              members: [{ value: aliceId }],
            },
          })
          const renamedGroupId = string(created.body.id)
          try {
            await admin(primary, '/mappings', {
              method: 'POST',
              expected: 201,
              body: {
                groupId: renamedGroupId,
                targetKind: 'permission_group',
                permissionGroupId: newPolicyId,
              },
            })
            assert.equal(
              (
                await sql`select id from permission_group_member where user_id = ${aliceUserId}
                and permission_group_id in (${oldPolicyId}, ${newPolicyId})`
              ).length,
              2
            )
            if (method === 'PATCH') {
              await patch(
                token,
                `/Groups/${renamedGroupId}`,
                [{ op: 'replace', path: 'displayName', value: newName }],
                204
              )
            } else {
              await scim(token, `/Groups/${renamedGroupId}`, {
                method,
                body: {
                  schemas: [GROUP_SCHEMA],
                  displayName: newName,
                  members: [{ value: aliceId }],
                },
              })
            }
            assert.equal(
              (
                await sql`select id from permission_group_member where permission_group_id = ${oldPolicyId}`
              ).length,
              0,
              `${method} rename must immediately withdraw the old automatically matched policy`
            )
            assert.equal(
              (
                await sql`select id from scim_projection_grant where scim_user_id = ${aliceId}
                and target_kind = 'permission_group' and target_id = ${oldPolicyId}`
              ).length,
              0
            )
            assert.equal(
              (
                await sql`select id from permission_group_member where permission_group_id = ${newPolicyId}`
              ).length,
              1
            )
          } finally {
            await scim(token, `/Groups/${renamedGroupId}`, { method: 'DELETE', expected: 204 })
            await sql`delete from permission_group where id in (${oldPolicyId}, ${newPolicyId})`
          }
        }
      } finally {
        await admin(primary, '', {
          method: 'PUT',
          body: { settings: { autoMapPermissionGroupsByName: false } },
        })
      }
    }
  )

  await check(
    'Mapping status exposes unapplied policy memberships and clears after conflict recovery',
    async () => {
      const firstPolicyId = generateId()
      const secondPolicyId = generateId()
      const conflictGroupIds: string[] = []
      await sql`insert into permission_group (id, organization_id, name, membership_mode, created_by)
      values (${firstPolicyId}, ${primary.orgId}, 'SCIM E2E first policy', 'explicit', ${primary.ownerId}),
        (${secondPolicyId}, ${primary.orgId}, 'SCIM E2E second policy', 'explicit', ${primary.ownerId})`
      for (const policyId of [firstPolicyId, secondPolicyId]) {
        await sql`insert into permission_group_workspace (id, permission_group_id, workspace_id, organization_id)
        values (${generateId()}, ${policyId}, ${primary.workspaceId}, ${primary.orgId})`
      }
      try {
        for (const [index, policyId] of [firstPolicyId, secondPolicyId].entries()) {
          const created = await scim(token, '/Groups', {
            method: 'POST',
            expected: 201,
            body: {
              schemas: [GROUP_SCHEMA],
              displayName: `SCIM E2E conflict ${index}`,
              members: [{ value: aliceId }],
            },
          })
          const directoryGroupId = string(created.body.id)
          conflictGroupIds.push(directoryGroupId)
          await admin(primary, '/mappings', {
            method: 'POST',
            expected: 201,
            body: {
              groupId: directoryGroupId,
              targetKind: 'permission_group',
              permissionGroupId: policyId,
            },
          })
        }
        const mappings = (await admin(primary, '/mappings')).body.groups
        assert(Array.isArray(mappings))
        const conflicted = record(
          mappings.find((value) => record(value).id === conflictGroupIds[1])
        )
        assert(Array.isArray(conflicted.mappings))
        const pending = record(conflicted.mappings[0])
        assert.equal(pending.source, 'manual')
        assert.equal(
          pending.unassignedMemberCount,
          1,
          'A saved mapping must expose the skipped member'
        )
        assert.equal(
          (
            await sql`select id from permission_group_member where permission_group_id = ${secondPolicyId}`
          ).length,
          0
        )
        await patch(
          token,
          `/Groups/${conflictGroupIds[0]}`,
          [{ op: 'remove', path: `members[value eq "${aliceId}"]` }],
          204
        )
        await admin(primary, '/reconcile', { method: 'POST' })
        const recovered = (await admin(primary, '/mappings')).body.groups
        assert(Array.isArray(recovered))
        const recoveredGroup = record(
          recovered.find((value) => record(value).id === conflictGroupIds[1])
        )
        assert(Array.isArray(recoveredGroup.mappings))
        assert.equal(record(recoveredGroup.mappings[0]).unassignedMemberCount, 0)
        assert.equal(
          (
            await sql`select id from permission_group_member where permission_group_id = ${secondPolicyId}`
          ).length,
          1
        )
      } finally {
        for (const directoryGroupId of conflictGroupIds) {
          await scim(token, `/Groups/${directoryGroupId}`, { method: 'DELETE', expected: 204 })
        }
        await sql`delete from permission_group where id in (${firstPolicyId}, ${secondPolicyId})`
      }
    }
  )

  for (const method of ['POST', 'PUT', 'PATCH'] as const) {
    for (const enabled of [true, false]) {
      await check(
        `Group ${method} honors name matching changed to ${enabled} while waiting for the organization lock`,
        async () => {
          const policyId = generateId()
          const name = `SCIM E2E ${method} concurrent ${enabled}`
          let directoryGroupId: string | undefined
          await sql`insert into permission_group (id, organization_id, name, created_by)
          values (${policyId}, ${primary.orgId}, ${name}, ${primary.ownerId})`
          try {
            await admin(primary, '', {
              method: 'PUT',
              body: { settings: { autoMapPermissionGroupsByName: !enabled } },
            })
            if (method !== 'POST') {
              const created = await scim(token, '/Groups', {
                method: 'POST',
                expected: 201,
                body: {
                  schemas: [GROUP_SCHEMA],
                  displayName: `${name} before`,
                  members: [{ value: aliceId }],
                },
              })
              directoryGroupId = string(created.body.id)
            }
            let writing: Promise<unknown> | undefined
            try {
              await sql.begin(async (tx) => {
                const [holder] = await tx`select pg_backend_pid() as pid,
                pg_advisory_xact_lock(hashtextextended(${`organization-mutation:${primary.orgId}`}, 0))`
                writing =
                  method === 'PATCH'
                    ? patch(
                        token,
                        `/Groups/${directoryGroupId}`,
                        [{ op: 'replace', path: 'displayName', value: name }],
                        204
                      )
                    : scim(token, method === 'POST' ? '/Groups' : `/Groups/${directoryGroupId}`, {
                        method,
                        expected: method === 'POST' ? 201 : 200,
                        body: {
                          schemas: [GROUP_SCHEMA],
                          displayName: name,
                          members: [{ value: aliceId }],
                        },
                      }).then((result) => {
                        directoryGroupId = string(result.body.id)
                      })
                void writing.catch(() => {})
                const deadline = performance.now() + 4000
                for (;;) {
                  const waiting = await sql`select pid from pg_stat_activity
                  where wait_event = 'advisory' and ${holder.pid} = any(pg_blocking_pids(pid))`
                  if (waiting.length > 0) break
                  assert(
                    performance.now() < deadline,
                    'The group write must reach the organization lock'
                  )
                  await sleep(10)
                }
                await tx`update scim_connection
                set settings = settings || ${tx.json({ autoMapPermissionGroupsByName: enabled })}::jsonb
                where organization_id = ${primary.orgId}`
              })
            } finally {
              await writing
            }
            assert(directoryGroupId, 'The group write must return its identifier')
            const mappings = await sql`select id from scim_group_mapping
            where group_id = ${directoryGroupId} and permission_group_id = ${policyId}`
            assert.equal(
              mappings.length,
              enabled ? 1 : 0,
              'The committed name-matching setting must govern the group write'
            )
          } finally {
            if (directoryGroupId)
              await scim(token, `/Groups/${directoryGroupId}`, { method: 'DELETE', expected: 204 })
            await sql`delete from permission_group where id = ${policyId}`
            await admin(primary, '', {
              method: 'PUT',
              body: { settings: { autoMapPermissionGroupsByName: false } },
            })
          }
        }
      )
    }
  }

  await check(
    'Group removal honors membership locking enabled while the request waits for the organization lock',
    async () => {
      await sql`insert into permissions (id, user_id, entity_type, entity_id, permission_type)
      values (${generateId()}, ${aliceUserId}, 'workspace', ${primary.workspaceId}, 'read')`
      const created = await scim(token, '/Groups', {
        method: 'POST',
        expected: 201,
        body: {
          schemas: [GROUP_SCHEMA],
          displayName: 'SCIM E2E concurrent lock',
          members: [{ value: aliceId }],
        },
      })
      const lockedGroupId = string(created.body.id)
      try {
        await admin(primary, '/mappings', {
          method: 'POST',
          expected: 201,
          body: {
            groupId: lockedGroupId,
            targetKind: 'workspace',
            workspaceId: primary.workspaceId,
            permissionType: 'read',
          },
        })
        let removal: Promise<unknown> | undefined
        try {
          await sql.begin(async (tx) => {
            const [holder] = await tx`select pg_backend_pid() as pid,
              pg_advisory_xact_lock(hashtextextended(${`organization-mutation:${primary.orgId}`}, 0))`
            removal = patch(
              token,
              `/Groups/${lockedGroupId}`,
              [{ op: 'remove', path: `members[value eq "${aliceId}"]` }],
              204
            )
            void removal.catch(() => {})
            const deadline = performance.now() + 4000
            for (;;) {
              const waiting = await sql`select pid from pg_stat_activity
                where wait_event = 'advisory' and ${holder.pid} = any(pg_blocking_pids(pid))`
              if (waiting.length > 0) break
              assert(
                performance.now() < deadline,
                'The group request must reach the organization lock'
              )
              await sleep(10)
            }
            await tx`update scim_connection
              set settings = settings || '{"lockManualMembership":true}'::jsonb
              where organization_id = ${primary.orgId}`
          })
        } finally {
          await removal
        }
        assert.equal(
          await permission(aliceUserId, primary.workspaceId),
          undefined,
          'A committed membership lock must govern the subsequent directory withdrawal'
        )
      } finally {
        await scim(token, `/Groups/${lockedGroupId}`, { method: 'DELETE', expected: 204 })
        await admin(primary, '', {
          method: 'PUT',
          body: { settings: { lockManualMembership: false } },
        })
        await sql`delete from permissions where user_id = ${aliceUserId}
          and entity_type = 'workspace' and entity_id = ${primary.workspaceId}`
      }
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
    'SCIM writes commit while a People publication waits and the next tick includes them',
    async () => {
      const fixture = await seedFixture()
      const { secret } = await configure(fixture)
      const create = (name: string) =>
        scim(secret, '/Users', {
          method: 'POST',
          expected: 201,
          body: { schemas: [USER_SCHEMA], userName: `${name}@${fixture.domain}`, active: true },
        })
      const anchor = string((await create('held')).body.id)
      const retiring = string((await create('retiring')).body.id)
      const people = `/api/organizations/${fixture.orgId}/people`
      const syncPath = `${people}/sync`
      const initial = await request(syncPath, {
        method: 'PUT',
        fixture,
        contentType: 'application/json',
        body: { source: 'scim' },
      })
      assert.equal(record(initial.body.sync).state, 'scheduled')
      const [retired] =
        await sql`select id from people_directory_entry where organization_id=${fixture.orgId} and external_id=${retiring}`
      assert(retired, 'Expected a previously published SCIM profile')
      await patch(secret, `/Users/${anchor}`, [
        { op: 'replace', path: 'title', value: 'Updated title' },
      ])

      let publication: ReturnType<typeof request> | undefined
      let writes: Promise<void> | undefined
      let createdId = ''
      try {
        await sql.begin(async (tx) => {
          const [held] = await tx`select pg_backend_pid() as pid from people_directory_entry
          where organization_id=${fixture.orgId} and external_id=${anchor} for update`
          assert(held)
          publication = request(`${syncPath}/run`, { method: 'POST', fixture })
          void publication.catch(() => {})
          let publisher: number | undefined
          const deadline = performance.now() + 15_000
          while (publisher === undefined) {
            const [waiting] = await sql<{ pid: number }[]>`select pid from pg_stat_activity
            where ${held.pid} = any(pg_blocking_pids(pid)) and query ilike '%insert into%people_directory_entry%'`
            if (waiting) publisher = waiting.pid
            else {
              assert(
                performance.now() < deadline,
                'The People publish must reach the held profile row'
              )
              await sleep(20)
            }
          }

          writes = (async () => {
            createdId = string((await create('during-publish')).body.id)
            await scim(secret, `/Users/${retiring}`, { method: 'DELETE', expected: 204 })
            await request(`${people}/${retired.id}`, { fixture, expected: 404 })
          })()
          let settled = false
          void writes.then(
            () => {
              settled = true
            },
            () => {
              settled = true
            }
          )
          const writeDeadline = performance.now() + 15_000
          while (!settled) {
            const [blocked] = await sql`select pid from pg_stat_activity
            where ${publisher} = any(pg_blocking_pids(pid)) and query ilike '%update%people_directory_sync%next_sync_at%'`
            assert(!blocked, 'A SCIM write must not wait behind the People publisher')
            assert(
              performance.now() < writeDeadline,
              'SCIM writes must finish before the held People profile is released'
            )
            await sleep(20)
          }
          await writes
        })
      } finally {
        await Promise.allSettled([publication, writes])
      }
      await publication
      await request(`${people}/${retired.id}`, { fixture, expected: 404 })
      assert.equal(record((await request(syncPath, { fixture })).body.sync).state, 'queued')
      await request('/api/cron/people-directory-sync', {
        token: requiredEnvironment('CRON_SECRET'),
      })
      const active =
        await sql`select external_id from people_directory_entry where organization_id=${fixture.orgId}`
      assert.deepEqual(active.map((row) => row.external_id).sort(), [anchor, createdId].sort())
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
      await request(`/api/organizations/${primary.orgId}/people/import`, {
        method: 'POST',
        fixture: primary,
        contentType: 'application/json',
        body: { source: 'directory', apply: false },
        expected: 400,
      })
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
