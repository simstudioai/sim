import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { assertDisposableTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId, generateShortId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import postgres from 'postgres'

/**
 * Exercises `PATCH` and `DELETE /api/v2/workspaces/{workspaceId}/members/{userId}`
 * over real HTTP against a running local app and a disposable PostgreSQL
 * database. SQL seeds identities, credentials, and workspaces, and inspects
 * persistence and audit rows; every member operation crosses the HTTP boundary.
 *
 * Required: WORKSPACE_MEMBERS_E2E_BASE_URL (loopback origin),
 * WORKSPACE_MEMBERS_E2E_DATABASE_URL (loopback, database name containing
 * "test"), WORKSPACE_MEMBERS_E2E_REPORT_PATH (JSON report destination).
 */
const logger = createLogger('WorkspaceMembersE2E')

function required(name: string): string {
  const value = process.env[name]
  assert(value, `${name} must be explicitly provided`)
  return value
}

const baseUrl = new URL(required('WORKSPACE_MEMBERS_E2E_BASE_URL'))
assert(['localhost', '127.0.0.1', '[::1]'].includes(baseUrl.hostname), 'Use a loopback app host')
assert.equal(baseUrl.protocol, 'http:', 'The app must use local HTTP')
assert.equal(baseUrl.pathname, '/', 'App URL must be an origin without a path')
const databaseUrl = assertDisposableTestDatabaseUrl(required('WORKSPACE_MEMBERS_E2E_DATABASE_URL'))
const reportPath = required('WORKSPACE_MEMBERS_E2E_REPORT_PATH')

const sql = postgres(databaseUrl.toString(), { max: 2 })
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []
const requests: { method: string; path: string; status: number }[] = []
const startedAt = new Date().toISOString()

const runId = generateId().replaceAll('-', '')
const domain = `workspace-members-e2e-${runId}.test`
const orgId = generateId()
const oauthClientId = generateId()

/** The primary organization workspace and two personal workspaces for the edge states. */
const workspaceId = generateId()
const lastAdminWorkspaceId = generateId()
const unresolvedOwnerWorkspaceId = generateId()
const workspaceIds = [workspaceId, lastAdminWorkspaceId, unresolvedOwnerWorkspaceId]

const users = {
  orgOwner: generateId(),
  admin: generateId(),
  wsOwner: generateId(),
  billing: generateId(),
  writer: generateId(),
  reader: generateId(),
  outsider: generateId(),
} as const
type UserName = keyof typeof users

const personalKeys = {
  admin: `sk-sim-e2e-${generateId()}`,
  writer: `sk-sim-e2e-${generateId()}`,
  reader: `sk-sim-e2e-${generateId()}`,
  outsider: `sk-sim-e2e-${generateId()}`,
}
const workspaceKey = `sk-sim-e2e-ws-${generateId()}`
const oauthReadToken = `sim_oat_${generateShortId(32)}`
const oauthWriteToken = `sim_oat_${generateShortId(32)}`

type Credential = { apiKey: string } | { bearer: string }

interface V2ErrorBody {
  code: string
  message: string
  details?: Record<string, unknown>
}

function record(value: unknown): Record<string, unknown> {
  assert(isRecordLike(value), 'Expected a JSON object')
  return value
}

function emailOf(name: UserName): string {
  return `${name}@${domain}`
}

function memberPath(targetUserId: string, workspace = workspaceId): string {
  return `/api/v2/workspaces/${workspace}/members/${encodeURIComponent(targetUserId)}`
}

async function call(
  credential: Credential,
  method: 'GET' | 'PATCH' | 'DELETE',
  path: string,
  expected: number,
  body?: unknown
): Promise<Record<string, unknown>> {
  const headers = new Headers({ 'User-Agent': 'Sim-local-workspace-members-E2E' })
  if ('apiKey' in credential) headers.set('X-API-Key', credential.apiKey)
  else headers.set('Authorization', `Bearer ${credential.bearer}`)
  if (body !== undefined) headers.set('Content-Type', 'application/json')
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(60_000),
  })
  requests.push({ method, path, status: response.status })
  const text = await response.text()
  assert.equal(
    response.status,
    expected,
    `${method} ${path}: ${response.status} ${truncate(text, 500)}`
  )
  assert.match(response.headers.get('cache-control') ?? '', /no-store/, 'v2 responses are no-store')
  return record(JSON.parse(text))
}

/** Asserts the v2 failure envelope and returns its `error`. */
async function fails(
  credential: Credential,
  method: 'PATCH' | 'DELETE',
  path: string,
  expected: number,
  body?: unknown
): Promise<V2ErrorBody> {
  const response = await call(credential, method, path, expected, body)
  assert.deepEqual(Object.keys(response), ['error'], 'A failure carries only the error envelope')
  const error = record(response.error)
  assert.equal(typeof error.code, 'string')
  assert.equal(typeof error.message, 'string')
  return {
    code: String(error.code),
    message: String(error.message),
    ...(error.details === undefined ? {} : { details: record(error.details) }),
  }
}

const key = (name: keyof typeof personalKeys): Credential => ({ apiKey: personalKeys[name] })

async function permissionOf(userId: string, workspace = workspaceId): Promise<string | null> {
  const [row] = await sql<{ permission_type: string }[]>`select permission_type from permissions
    where entity_type = 'workspace' and entity_id = ${workspace} and user_id = ${userId}`
  return row?.permission_type ?? null
}

async function auditRows(action: string, workspace = workspaceId) {
  return sql<
    { actor_id: string | null; description: string | null; metadata: Record<string, unknown> }[]
  >`select actor_id, description, metadata from audit_log
    where workspace_id = ${workspace} and action = ${action} order by created_at asc`
}

/** Audit writes may land just after the response; poll briefly for the expected count. */
async function awaitAuditCount(action: string, count: number, workspace = workspaceId) {
  const deadline = performance.now() + 5_000
  for (;;) {
    const rows = await auditRows(action, workspace)
    if (rows.length >= count || performance.now() > deadline) return rows
    await sleep(100)
  }
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

async function seed() {
  await sql.begin(async (tx) => {
    for (const [name, id] of Object.entries(users) as [UserName, string][]) {
      await tx`insert into "user" (id, name, email, normalized_email, email_verified, created_at, updated_at)
        values (${id}, ${`E2E ${name}`}, ${emailOf(name)}, ${emailOf(name)}, true, now(), now())`
      await tx`insert into user_stats (id, user_id) values (${generateId()}, ${id})`
    }
    await tx`insert into organization (id, name, slug, created_at)
      values (${orgId}, 'Workspace members E2E', ${`workspace-members-e2e-${runId}`}, now())`
    await tx`insert into member (id, user_id, organization_id, role) values
      (${generateId()}, ${users.orgOwner}, ${orgId}, 'owner'),
      (${generateId()}, ${users.admin}, ${orgId}, 'member'),
      (${generateId()}, ${users.wsOwner}, ${orgId}, 'member'),
      (${generateId()}, ${users.billing}, ${orgId}, 'member'),
      (${generateId()}, ${users.writer}, ${orgId}, 'member'),
      (${generateId()}, ${users.reader}, ${orgId}, 'member')`

    await tx`insert into project (id, name, owner_id, organization_id)
      values (${workspaceId}, 'Members E2E', ${users.wsOwner}, ${orgId})`
    await tx`insert into workspace (id, project_id, name, owner_id, billed_account_user_id, organization_id)
      values (${workspaceId}, ${workspaceId}, 'Members E2E', ${users.wsOwner}, ${users.billing}, ${orgId})`
    await tx`insert into permissions (id, user_id, entity_type, entity_id, permission_type) values
      (${generateId()}, ${users.admin}, 'workspace', ${workspaceId}, 'admin'),
      (${generateId()}, ${users.wsOwner}, 'workspace', ${workspaceId}, 'admin'),
      (${generateId()}, ${users.billing}, 'workspace', ${workspaceId}, 'admin'),
      (${generateId()}, ${users.writer}, 'workspace', ${workspaceId}, 'write'),
      (${generateId()}, ${users.reader}, 'workspace', ${workspaceId}, 'read')`

    /** Personal workspace whose only explicit admin is `admin`; its owner holds no grant. */
    await tx`insert into project (id, name, owner_id)
      values (${lastAdminWorkspaceId}, 'Members E2E last admin', ${users.billing})`
    await tx`insert into workspace (id, project_id, name, owner_id, billed_account_user_id)
      values (${lastAdminWorkspaceId}, ${lastAdminWorkspaceId}, 'Members E2E last admin', ${users.billing}, ${users.billing})`
    await tx`insert into permissions (id, user_id, entity_type, entity_id, permission_type)
      values (${generateId()}, ${users.admin}, 'workspace', ${lastAdminWorkspaceId}, 'admin')`

    /**
     * Personal workspace whose billing account holds no grant, so removing its
     * owner leaves nobody to inherit it: the revocation refuses inside the
     * transaction with the billing-account removal error.
     */
    await tx`insert into project (id, name, owner_id)
      values (${unresolvedOwnerWorkspaceId}, 'Members E2E unresolved owner', ${users.wsOwner})`
    await tx`insert into workspace (id, project_id, name, owner_id, billed_account_user_id)
      values (${unresolvedOwnerWorkspaceId}, ${unresolvedOwnerWorkspaceId}, 'Members E2E unresolved owner', ${users.wsOwner}, ${users.billing})`
    await tx`insert into permissions (id, user_id, entity_type, entity_id, permission_type) values
      (${generateId()}, ${users.wsOwner}, 'workspace', ${unresolvedOwnerWorkspaceId}, 'admin'),
      (${generateId()}, ${users.admin}, 'workspace', ${unresolvedOwnerWorkspaceId}, 'admin')`

    for (const [name, value] of Object.entries(personalKeys) as [
      keyof typeof personalKeys,
      string,
    ][]) {
      await tx`insert into api_key (id, user_id, name, key, key_hash, type)
        values (${generateId()}, ${users[name]}, 'Members E2E', ${value}, ${sha256Hex(value)}, 'personal')`
    }
    await tx`insert into api_key (id, user_id, workspace_id, created_by, name, key, key_hash, type)
      values (${generateId()}, ${users.admin}, ${workspaceId}, ${users.admin}, 'Members E2E workspace key',
        ${workspaceKey}, ${sha256Hex(workspaceKey)}, 'workspace')`

    await tx`insert into oauth_client (id, client_id, name, public, token_endpoint_auth_method, grant_types, redirect_uris)
      values (${oauthClientId}, ${oauthClientId}, 'Members E2E OAuth client', true, 'none',
        ${['authorization_code', 'refresh_token']}, ${['http://127.0.0.1/callback']})`
    for (const [token, scopes] of [
      [oauthReadToken, ['api:read']],
      [oauthWriteToken, ['api:write']],
    ] as const) {
      await tx`insert into oauth_access_token (id, token, client_id, user_id, scopes, created_at, expires_at)
        values (${generateId()}, ${sha256Hex(token.slice('sim_oat_'.length))}, ${oauthClientId},
          ${users.admin}, ${[...scopes]}, now(), now() + interval '1 hour')`
    }

    /** A live session for `reader`, which leaving their last organization workspace must end. */
    await tx`insert into session (id, token, user_id, expires_at, created_at, updated_at)
      values (${generateId()}, ${generateShortId()}, ${users.reader}, now() + interval '1 day', now(), now())`
  })
}

async function cleanup() {
  const userIds = Object.values(users)
  await sql.begin(async (tx) => {
    await tx`delete from audit_log where workspace_id in ${tx(workspaceIds)}`
    await tx`delete from api_key where user_id in ${tx(userIds)}`
    await tx`delete from oauth_client where client_id = ${oauthClientId}`
    await tx`delete from permissions where entity_type = 'workspace' and entity_id in ${tx(workspaceIds)}`
    await tx`delete from workspace where id in ${tx(workspaceIds)}`
    await tx`delete from project where id in ${tx(workspaceIds)}`
    await tx`delete from member where organization_id = ${orgId}`
    await tx`delete from organization where id = ${orgId}`
    await tx`delete from "user" where id in ${tx(userIds)}`
  })
}

async function run() {
  await seed()
  const admin = key('admin')

  await check('A workspace API key is refused on both methods with a coded 403', async () => {
    for (const [method, body] of [
      ['PATCH', { role: 'write' }],
      ['DELETE', undefined],
    ] as const) {
      const error = await fails(
        { apiKey: workspaceKey },
        method,
        memberPath(users.reader),
        403,
        body
      )
      assert.equal(error.code, 'FORBIDDEN')
      assert(
        ['WORKSPACE_KEY_OPERATION_NOT_PERMITTED', 'PRINCIPAL_KIND_NOT_PERMITTED'].includes(
          String(error.details?.code)
        ),
        `Unexpected workspace-key refusal code ${String(error.details?.code)}`
      )
    }
    assert.equal(await permissionOf(users.reader), 'read')
  })

  await check('An OAuth token without api:write is refused with INSUFFICIENT_SCOPE', async () => {
    for (const [method, body] of [
      ['PATCH', { role: 'write' }],
      ['DELETE', undefined],
    ] as const) {
      const error = await fails(
        { bearer: oauthReadToken },
        method,
        memberPath(users.reader),
        403,
        body
      )
      assert.equal(error.details?.code, 'INSUFFICIENT_SCOPE')
    }
    assert.equal(await permissionOf(users.reader), 'read')
  })

  await check('A non-admin cannot change or remove someone else', async () => {
    const patch = await fails(key('writer'), 'PATCH', memberPath(users.reader), 403, {
      role: 'write',
    })
    assert.equal(patch.details?.code, 'INSUFFICIENT_WORKSPACE_ROLE')
    const remove = await fails(key('writer'), 'DELETE', memberPath(users.reader), 403)
    assert.equal(remove.details?.code, 'INSUFFICIENT_WORKSPACE_ROLE')
    assert.equal(await permissionOf(users.reader), 'read')
  })

  await check('An unreachable or unknown workspace answers an identical 404', async () => {
    const unreachable = await fails(key('outsider'), 'PATCH', memberPath(users.reader), 404, {
      role: 'write',
    })
    const unknown = await fails(admin, 'PATCH', memberPath(users.reader, generateId()), 404, {
      role: 'write',
    })
    assert.deepEqual(unreachable, unknown)
    assert.deepEqual(unreachable, { code: 'NOT_FOUND', message: 'Workspace not found' })
    await fails(key('outsider'), 'DELETE', memberPath(users.reader), 404)
  })

  await check('A non-member target is a 400 to change and a 404 to remove', async () => {
    await fails(admin, 'PATCH', memberPath(users.outsider), 400, { role: 'write' })
    await fails(admin, 'DELETE', memberPath(users.outsider), 404)
    assert.equal(await permissionOf(users.outsider), null)
  })

  await check('Invalid bodies and query strings are rejected before any write', async () => {
    await fails(admin, 'PATCH', memberPath(users.reader), 400, { role: 'owner' })
    await fails(admin, 'PATCH', memberPath(users.reader), 400, { role: 'write', extra: true })
    await fails(admin, 'PATCH', memberPath(users.reader), 400, {})
    await fails(admin, 'PATCH', `${memberPath(users.reader)}?force=1`, 400, { role: 'write' })
    await fails(admin, 'DELETE', `${memberPath(users.reader)}?force=1`, 400)
    await fails(admin, 'PATCH', memberPath('x'.repeat(200)), 400, { role: 'write' })
    assert.equal(await permissionOf(users.reader), 'read')
  })

  await check('An admin cannot lower their own role', async () => {
    const error = await fails(admin, 'PATCH', memberPath(users.admin), 400, { role: 'write' })
    assert.match(error.message, /own admin/)
    assert.equal(await permissionOf(users.admin), 'admin')
  })

  await check('Owner, billing account, and organization admins keep Admin', async () => {
    await fails(admin, 'PATCH', memberPath(users.wsOwner), 400, { role: 'read' })
    await fails(admin, 'PATCH', memberPath(users.billing), 400, { role: 'read' })
    await fails(admin, 'PATCH', memberPath(users.orgOwner), 400, { role: 'write' })
    await fails(admin, 'DELETE', memberPath(users.orgOwner), 400)
    await fails(admin, 'DELETE', memberPath(users.billing), 400)
    assert.equal(await permissionOf(users.wsOwner), 'admin')
    assert.equal(await permissionOf(users.billing), 'admin')
  })

  await check(
    'A role change returns the roster member and audits the key owner as actor',
    async () => {
      const before = (await auditRows('member.role_changed')).length
      const response = await call(admin, 'PATCH', memberPath(users.reader), 200, {
        role: 'write',
      })
      assert.deepEqual(Object.keys(response), ['data'])
      const roster = await call(admin, 'GET', `/api/v2/workspaces/${workspaceId}/members`, 200)
      assert(Array.isArray(roster.data))
      const listed = roster.data.map(record).find((entry) => entry.userId === users.reader)
      assert.deepEqual(response.data, listed, 'PATCH returns the member exactly as the list does')
      assert.equal(record(response.data).role, 'write')
      assert.equal(await permissionOf(users.reader), 'write')

      const rows = await awaitAuditCount('member.role_changed', before + 1)
      assert.equal(rows.length, before + 1)
      const entry = rows[rows.length - 1]
      assert.equal(entry.actor_id, users.admin)
      assert.equal(record(entry.metadata).targetUserId, users.reader)
      assert.equal(record(entry.metadata).previousRole, 'read')
      assert.equal(record(record(entry.metadata).actor).kind, 'personal_api_key')
    }
  )

  await check('An OAuth token with api:write can change a role', async () => {
    const response = await call(
      { bearer: oauthWriteToken },
      'PATCH',
      memberPath(users.reader),
      200,
      {
        role: 'read',
      }
    )
    assert.equal(record(response.data).role, 'read')
    assert.equal(await permissionOf(users.reader), 'read')
    const rows = await awaitAuditCount('member.role_changed', 2)
    assert.equal(record(record(rows[rows.length - 1].metadata).actor).kind, 'oauth_access_token')
    assert.equal(rows[rows.length - 1].actor_id, users.admin)
  })

  await check('Requesting the current role writes nothing and records no audit', async () => {
    const before = await auditRows('member.role_changed')
    const [{ updated_at: updatedBefore }] = await sql<{ updated_at: Date }[]>`
      select updated_at from permissions
      where entity_type = 'workspace' and entity_id = ${workspaceId} and user_id = ${users.reader}`
    const response = await call(admin, 'PATCH', memberPath(users.reader), 200, { role: 'read' })
    assert.equal(record(response.data).role, 'read')
    await sleep(1_000)
    assert.equal((await auditRows('member.role_changed')).length, before.length)
    const [{ updated_at: updatedAfter }] = await sql<{ updated_at: Date }[]>`
      select updated_at from permissions
      where entity_type = 'workspace' and entity_id = ${workspaceId} and user_id = ${users.reader}`
    assert.equal(updatedAfter.getTime(), updatedBefore.getTime())
  })

  await check('The last explicit admin cannot leave', async () => {
    const error = await fails(admin, 'DELETE', memberPath(users.admin, lastAdminWorkspaceId), 400)
    assert.match(error.message, /last admin/)
    assert.equal(await permissionOf(users.admin, lastAdminWorkspaceId), 'admin')
  })

  await check('An owner removal with no successor is a 409, not a 500', async () => {
    const error = await fails(
      admin,
      'DELETE',
      memberPath(users.wsOwner, unresolvedOwnerWorkspaceId),
      409
    )
    assert.equal(error.code, 'CONFLICT')
    assert.match(error.message, /billing account/)
    assert.equal(await permissionOf(users.wsOwner, unresolvedOwnerWorkspaceId), 'admin')
    const [owner] = await sql<{ owner_id: string }[]>`select owner_id from workspace
      where id = ${unresolvedOwnerWorkspaceId}`
    assert.equal(owner.owner_id, users.wsOwner)
  })

  await check('An admin removes another member and the removal is audited', async () => {
    const before = (await auditRows('member.removed')).length
    const response = await call(admin, 'DELETE', memberPath(users.writer), 200)
    const data = record(response.data)
    assert.equal(data.userId, users.writer)
    assert.equal(data.deleted, true)
    assert.equal(data.organizationMembershipRemoved, true, 'This was their only org workspace')
    assert.equal(await permissionOf(users.writer), null)
    const membership = await sql`select id from member
      where organization_id = ${orgId} and user_id = ${users.writer}`
    assert.equal(membership.length, 0)
    const rows = await awaitAuditCount('member.removed', before + 1)
    assert.equal(rows[rows.length - 1].actor_id, users.admin)
    assert.equal(record(rows[rows.length - 1].metadata).removedUserId, users.writer)
  })

  await check(
    'A member leaves with a personal key, losing org membership and sessions',
    async () => {
      const response = await call(key('reader'), 'DELETE', memberPath(users.reader), 200)
      const data = record(response.data)
      assert.equal(data.userId, users.reader)
      assert.equal(data.organizationMembershipRemoved, true)
      assert.equal(await permissionOf(users.reader), null)
      const membership = await sql`select id from member
        where organization_id = ${orgId} and user_id = ${users.reader}`
      assert.equal(membership.length, 0)
      const sessions = await sql`select id from session where user_id = ${users.reader}`
      assert.equal(sessions.length, 0, 'Leaving the last org workspace ends every session')
      const rows = await awaitAuditCount('member.removed', 2)
      const entry = rows[rows.length - 1]
      assert.equal(entry.actor_id, users.reader)
      assert.equal(record(entry.metadata).selfRemoval, true)
      await fails(key('reader'), 'DELETE', memberPath(users.reader), 404)
    }
  )
}

try {
  await run()
} catch (error) {
  logger.error('Workspace members E2E failed', { error: getErrorMessage(error) })
  process.exitCode = 1
} finally {
  try {
    await cleanup()
    logger.info('Removed workspace members E2E fixtures')
  } catch (error) {
    logger.error('Workspace members E2E fixture cleanup failed', { error: getErrorMessage(error) })
    process.exitCode = 1
  }
  await sql.end()
  const report = {
    startedAt,
    completedAt: new Date().toISOString(),
    status: process.exitCode ? 'failed' : 'passed',
    transport: 'Real HTTP against a local Next.js app and PostgreSQL',
    requestCount: requests.length,
    checks,
    requests,
  }
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  logger.info(
    `Workspace members E2E ${report.status}: ${checks.filter((item) => item.status === 'passed').length}/${checks.length} checks, ${requests.length} HTTP requests`
  )
}
