import { db } from '@sim/db'
import {
  apiKey,
  auditLog,
  member,
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  organization,
  permissions,
  scimConnection,
  scimUser,
  session,
  user,
  userStats,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { envFlagsMock } from '@sim/testing/mocks/env-flags.mock'
import { generateId, generateShortId } from '@sim/utils/id'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashApiKey } from '@/lib/api-key/crypto'
import { hashOAuthToken } from '@/lib/auth/oauth-access-token'
import {
  DELETE as removeMember,
  PATCH as updateMember,
} from '@/app/api/v2/workspaces/[workspaceId]/members/[userId]/route'
import { GET as listMembers } from '@/app/api/v2/workspaces/[workspaceId]/members/route'

/** Directory provisioning on a self-hosted deployment, so a locked SCIM member is refused. */
vi.mock('@/lib/core/config/env-flags', () => ({ ...envFlagsMock, isScimEnabled: true }))

const USER_NAMES = [
  'orgOwner',
  'admin',
  'wsOwner',
  'billing',
  'writer',
  'reader',
  'managed',
  'outsider',
] as const
const KEY_HOLDERS = ['admin', 'writer', 'reader', 'outsider'] as const
type KeyHolder = (typeof KEY_HOLDERS)[number]

/** A fresh organization, users, workspaces, and credentials for every test. */
function newFixture() {
  const workspaceId = generateId()
  /** Personal workspace whose only explicit admin is `admin`; its owner holds no grant. */
  const lastAdminWorkspaceId = generateId()
  /** Personal workspace whose billing account holds no grant, so its owner has no successor. */
  const unresolvedOwnerWorkspaceId = generateId()
  return {
    orgId: generateId(),
    scimConnectionId: generateId(),
    oauthClientId: generateId(),
    workspaceId,
    lastAdminWorkspaceId,
    unresolvedOwnerWorkspaceId,
    workspaceIds: [workspaceId, lastAdminWorkspaceId, unresolvedOwnerWorkspaceId],
    users: Object.fromEntries(USER_NAMES.map((name) => [name, generateId()])) as Record<
      (typeof USER_NAMES)[number],
      string
    >,
    keys: Object.fromEntries(
      KEY_HOLDERS.map((name) => [name, `sk-sim-fixture-${generateId()}`])
    ) as Record<KeyHolder, string>,
    workspaceKey: `sk-sim-fixture-${generateId()}`,
    oauthReadToken: `sim_oat_${generateShortId(32)}`,
    oauthWriteToken: `sim_oat_${generateShortId(32)}`,
  }
}

let f = newFixture()

type Credential = { apiKey: string } | { bearer: string }
const key = (name: KeyHolder): Credential => ({ apiKey: f.keys[name] })

async function call(
  credential: Credential,
  method: 'PATCH' | 'DELETE',
  target: string,
  options: { workspace?: string; body?: unknown; query?: string } = {}
) {
  const scope = options.workspace ?? f.workspaceId
  const headers = new Headers({ 'x-forwarded-for': '127.0.0.1' })
  if ('apiKey' in credential) headers.set('X-API-Key', credential.apiKey)
  else headers.set('Authorization', `Bearer ${credential.bearer}`)
  if (options.body !== undefined) headers.set('Content-Type', 'application/json')
  const request = new NextRequest(
    `http://localhost/api/v2/workspaces/${scope}/members/${target}${options.query ?? ''}`,
    {
      method,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    }
  )
  const context = { params: Promise.resolve({ workspaceId: scope, userId: target }) }
  const response =
    method === 'PATCH' ? await updateMember(request, context) : await removeMember(request, context)
  expect(response.headers.get('cache-control')).toMatch(/no-store/)
  const body = await response.json()
  // requestId is per-request: check it against its header, then drop it from the compared body.
  if (body?.error) {
    const { requestId, ...error } = body.error
    expect(requestId).toBe(response.headers.get('x-request-id'))
    body.error = error
  }
  return { status: response.status, retryAfter: response.headers.get('retry-after'), body }
}

async function roleOf(target: string, scope = f.workspaceId) {
  const [row] = await db
    .select({ role: permissions.permissionType })
    .from(permissions)
    .where(
      and(
        eq(permissions.entityType, 'workspace'),
        eq(permissions.entityId, scope),
        eq(permissions.userId, target)
      )
    )
  return row?.role ?? null
}

function auditRows(action: string, scope = f.workspaceId) {
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.workspaceId, scope), eq(auditLog.action, action)))
    .orderBy(asc(auditLog.createdAt))
}

/** Audit is written after the response; wait for the expected row count. */
async function awaitAudit(action: string, count: number, scope = f.workspaceId) {
  return vi.waitFor(
    async () => {
      const rows = await auditRows(action, scope)
      expect(rows).toHaveLength(count)
      return rows
    },
    { timeout: 5_000, interval: 100 }
  )
}

async function orgMembership(target: string) {
  return db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, f.orgId), eq(member.userId, target)))
}

async function seed() {
  const { users } = f
  const now = new Date()
  const userIds = Object.values(users)
  await db.insert(user).values(
    Object.entries(users).map(([name, id]) => ({
      id,
      name: `Fixture ${name}`,
      email: `${id}@members.test`,
      normalizedEmail: `${id}@members.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }))
  )
  await db.insert(userStats).values(userIds.map((id) => ({ id: generateId(), userId: id })))
  await db
    .insert(organization)
    .values({ id: f.orgId, name: 'Members fixture', slug: `members-${f.orgId}`, createdAt: now })
  await db.insert(member).values(
    USER_NAMES.filter((name) => name !== 'outsider').map((name) => ({
      id: generateId(),
      userId: users[name],
      organizationId: f.orgId,
      role: name === 'orgOwner' ? 'owner' : 'member',
    }))
  )
  await insertWorkspaceFixture(db, [
    {
      id: f.workspaceId,
      name: 'Members fixture',
      ownerId: users.wsOwner,
      billedAccountUserId: users.billing,
      organizationId: f.orgId,
      allowPersonalApiKeys: true,
    },
    {
      id: f.lastAdminWorkspaceId,
      name: 'Last admin fixture',
      ownerId: users.billing,
      billedAccountUserId: users.billing,
      allowPersonalApiKeys: true,
    },
    {
      id: f.unresolvedOwnerWorkspaceId,
      name: 'Unresolved owner fixture',
      ownerId: users.wsOwner,
      billedAccountUserId: users.billing,
      allowPersonalApiKeys: true,
    },
  ])
  const grant = (target: string, scope: string, role: 'admin' | 'write' | 'read') => ({
    id: generateId(),
    userId: target,
    entityType: 'workspace',
    entityId: scope,
    permissionType: role,
  })
  await db
    .insert(permissions)
    .values([
      grant(users.admin, f.workspaceId, 'admin'),
      grant(users.wsOwner, f.workspaceId, 'admin'),
      grant(users.billing, f.workspaceId, 'admin'),
      grant(users.writer, f.workspaceId, 'write'),
      grant(users.reader, f.workspaceId, 'read'),
      grant(users.managed, f.workspaceId, 'write'),
      grant(users.admin, f.lastAdminWorkspaceId, 'admin'),
      grant(users.wsOwner, f.unresolvedOwnerWorkspaceId, 'admin'),
      grant(users.admin, f.unresolvedOwnerWorkspaceId, 'admin'),
    ])
  await db.insert(apiKey).values([
    ...KEY_HOLDERS.map((name) => ({
      id: generateId(),
      userId: users[name],
      name: 'Members fixture',
      key: f.keys[name],
      keyHash: hashApiKey(f.keys[name]),
      type: 'personal',
    })),
    {
      id: generateId(),
      userId: users.admin,
      workspaceId: f.workspaceId,
      createdBy: users.admin,
      name: 'Members workspace fixture',
      key: f.workspaceKey,
      keyHash: hashApiKey(f.workspaceKey),
      type: 'workspace',
    },
  ])
  await db.insert(oauthClient).values({
    id: f.oauthClientId,
    clientId: f.oauthClientId,
    name: 'Members fixture client',
    public: true,
    tokenEndpointAuthMethod: 'none',
    grantTypes: ['authorization_code', 'refresh_token'],
    redirectUris: ['http://127.0.0.1/callback'],
  })
  await db.insert(oauthConsent).values({
    id: generateId(),
    clientId: f.oauthClientId,
    userId: users.admin,
    scopes: ['api:read', 'api:write'],
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(oauthAccessToken).values(
    (
      [
        [f.oauthReadToken, ['api:read']],
        [f.oauthWriteToken, ['api:write']],
      ] as const
    ).map(([token, scopes]) => ({
      id: generateId(),
      token: hashOAuthToken(token.slice('sim_oat_'.length)),
      clientId: f.oauthClientId,
      userId: users.admin,
      scopes: [...scopes],
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    }))
  )
  await db.insert(scimConnection).values({
    id: f.scimConnectionId,
    organizationId: f.orgId,
    status: 'active',
    settings: { lockManualMembership: true },
  })
  const managedEmail = `${users.managed}@members.test`
  await db.insert(scimUser).values({
    id: generateId(),
    connectionId: f.scimConnectionId,
    userId: users.managed,
    userName: managedEmail,
    orderKey: users.managed,
    attributes: {
      userName: managedEmail,
      active: true,
      displayName: 'Managed user',
      name: { formatted: 'Managed user' },
      emails: [{ value: managedEmail, primary: true, type: 'work' }],
    },
  })
  await db.insert(session).values({
    id: generateId(),
    token: generateShortId(32),
    userId: users.reader,
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    createdAt: now,
    updatedAt: now,
  })
}

async function cleanup() {
  const userIds = Object.values(f.users)
  await db.delete(auditLog).where(inArray(auditLog.workspaceId, f.workspaceIds))
  await db.delete(apiKey).where(inArray(apiKey.userId, userIds))
  await db.delete(oauthClient).where(eq(oauthClient.clientId, f.oauthClientId))
  await db
    .delete(permissions)
    .where(
      and(eq(permissions.entityType, 'workspace'), inArray(permissions.entityId, f.workspaceIds))
    )
  await deleteWorkspaceFixture(db, inArray(workspace.id, f.workspaceIds))
  await db.delete(scimConnection).where(eq(scimConnection.id, f.scimConnectionId))
  await db.delete(member).where(eq(member.organizationId, f.orgId))
  await db.delete(organization).where(eq(organization.id, f.orgId))
  await db.delete(session).where(inArray(session.userId, userIds))
  await db.delete(userStats).where(inArray(userStats.userId, userIds))
  await db.delete(user).where(inArray(user.id, userIds))
}

/** Drives the real v2 member route handlers with hashed credentials against PostgreSQL. */
describe('v2 workspace member management against PostgreSQL', () => {
  beforeEach(async () => {
    f = newFixture()
    await seed()
  })

  afterEach(cleanup)

  afterAll(async () => {
    await db.$client.end()
  })

  it('refuses a workspace API key on both methods with a coded 403', async () => {
    for (const [method, body] of [
      ['PATCH', { role: 'write' }],
      ['DELETE', undefined],
    ] as const) {
      const response = await call({ apiKey: f.workspaceKey }, method, f.users.reader, { body })
      expect(response).toMatchObject({
        status: 403,
        body: {
          error: {
            code: 'FORBIDDEN',
            details: { code: 'WORKSPACE_KEY_OPERATION_NOT_PERMITTED' },
          },
        },
      })
    }
    expect(await roleOf(f.users.reader)).toBe('read')
  })

  it('refuses an OAuth token without api:write', async () => {
    for (const [method, body] of [
      ['PATCH', { role: 'write' }],
      ['DELETE', undefined],
    ] as const) {
      const response = await call({ bearer: f.oauthReadToken }, method, f.users.reader, { body })
      expect(response).toMatchObject({
        status: 403,
        body: { error: { details: { code: 'INSUFFICIENT_SCOPE' } } },
      })
    }
    expect(await roleOf(f.users.reader)).toBe('read')
  })

  it('refuses a non-admin changing or removing someone else', async () => {
    for (const [method, body] of [
      ['PATCH', { role: 'write' }],
      ['DELETE', undefined],
    ] as const) {
      const response = await call(key('writer'), method, f.users.reader, { body })
      expect(response).toMatchObject({
        status: 403,
        body: { error: { details: { code: 'INSUFFICIENT_WORKSPACE_ROLE' } } },
      })
    }
    expect(await roleOf(f.users.reader)).toBe('read')
  })

  it('answers an unreachable and an unknown workspace with the same 404', async () => {
    const unreachable = await call(key('outsider'), 'PATCH', f.users.reader, {
      body: { role: 'write' },
    })
    const unknown = await call(key('admin'), 'PATCH', f.users.reader, {
      workspace: generateId(),
      body: { role: 'write' },
    })
    expect(unreachable).toEqual(unknown)
    expect(unreachable).toEqual({
      status: 404,
      retryAfter: null,
      body: { error: { code: 'NOT_FOUND', message: 'Workspace not found' } },
    })
    expect((await call(key('outsider'), 'DELETE', f.users.reader)).status).toBe(404)
  })

  it('answers a non-member target with 404 on both methods and writes nothing', async () => {
    const patch = await call(key('admin'), 'PATCH', f.users.outsider, { body: { role: 'write' } })
    expect(patch).toMatchObject({
      status: 404,
      body: { error: { code: 'NOT_FOUND', message: 'Member not found' } },
    })
    expect((await call(key('admin'), 'DELETE', f.users.outsider)).status).toBe(404)
    expect(await roleOf(f.users.outsider)).toBeNull()
    expect(await auditRows('member.role_changed')).toHaveLength(0)
  })

  it('rejects invalid bodies, query strings, and ids before any write', async () => {
    const admin = key('admin')
    const invalid = [
      call(admin, 'PATCH', f.users.reader, { body: { role: 'owner' } }),
      call(admin, 'PATCH', f.users.reader, { body: { role: 'write', extra: true } }),
      call(admin, 'PATCH', f.users.reader, { body: {} }),
      call(admin, 'PATCH', f.users.reader, { body: { role: 'write' }, query: '?force=1' }),
      call(admin, 'DELETE', f.users.reader, { query: '?force=1' }),
      call(admin, 'PATCH', 'x'.repeat(200), { body: { role: 'write' } }),
    ]
    for (const response of await Promise.all(invalid)) {
      expect(response).toMatchObject({ status: 400, body: { error: { code: 'BAD_REQUEST' } } })
    }
    expect(await roleOf(f.users.reader)).toBe('read')
  })

  it('keeps the SCIM_MANAGED_MEMBERSHIP code for a directory-managed member', async () => {
    const response = await call(key('admin'), 'PATCH', f.users.managed, { body: { role: 'read' } })
    expect(response).toMatchObject({
      status: 403,
      body: { error: { code: 'FORBIDDEN', details: { code: 'SCIM_MANAGED_MEMBERSHIP' } } },
    })
    expect(await roleOf(f.users.managed)).toBe('write')
  })

  it('answers a role change held up by a competing writer with a retryable 503', async () => {
    let lockTaken!: () => void
    let release!: () => void
    const taken = new Promise<void>((resolve) => {
      lockTaken = resolve
    })
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    // Held from its own async context, so the request is not nested inside this transaction.
    const competingWriter = db.transaction(async (tx) => {
      await tx
        .select({ id: member.id })
        .from(member)
        .where(and(eq(member.organizationId, f.orgId), eq(member.userId, f.users.reader)))
        .for('update')
      lockTaken()
      await released
    })
    await taken
    const response = await call(key('admin'), 'PATCH', f.users.reader, {
      body: { role: 'write' },
    }).finally(release)
    await competingWriter
    expect(response).toMatchObject({
      status: 503,
      body: { error: { code: 'SERVICE_UNAVAILABLE' } },
    })
    expect(Number(response.retryAfter)).toBeGreaterThan(0)
    expect(await roleOf(f.users.reader)).toBe('read')
  }, 30_000)

  it('refuses an admin lowering their own role', async () => {
    const response = await call(key('admin'), 'PATCH', f.users.admin, { body: { role: 'write' } })
    expect(response.status).toBe(400)
    expect(response.body.error.message).toMatch(/own admin/)
    expect(await roleOf(f.users.admin)).toBe('admin')
  })

  it('keeps Admin for the owner, the billing account, and organization admins', async () => {
    const admin = key('admin')
    const refusals = await Promise.all([
      call(admin, 'PATCH', f.users.wsOwner, { body: { role: 'read' } }),
      call(admin, 'PATCH', f.users.billing, { body: { role: 'read' } }),
      call(admin, 'DELETE', f.users.orgOwner),
      call(admin, 'DELETE', f.users.billing),
    ])
    expect(refusals.map((response) => response.status)).toEqual([400, 400, 400, 400])
    expect(await roleOf(f.users.wsOwner)).toBe('admin')
    expect(await roleOf(f.users.billing)).toBe('admin')
  })

  it('refuses an inherited organization admin, who holds no grant row, whatever role is requested', async () => {
    expect(await roleOf(f.users.orgOwner)).toBeNull()
    for (const role of ['admin', 'write', 'read'] as const) {
      const response = await call(key('admin'), 'PATCH', f.users.orgOwner, { body: { role } })
      expect(response).toEqual({
        status: 400,
        retryAfter: null,
        body: {
          error: {
            code: 'BAD_REQUEST',
            message: 'Organization admins are workspace admins and their role cannot be changed',
          },
        },
      })
    }
    expect(await roleOf(f.users.orgOwner)).toBeNull()
    expect(await auditRows('member.role_changed')).toHaveLength(0)
  })

  it('returns the roster member and audits the key owner as actor', async () => {
    const response = await call(key('admin'), 'PATCH', f.users.reader, { body: { role: 'write' } })
    expect(response.status).toBe(200)
    expect(Object.keys(response.body)).toEqual(['data'])
    const roster = await listMembers(
      new NextRequest(`http://localhost/api/v2/workspaces/${f.workspaceId}/members`, {
        headers: { 'X-API-Key': f.keys.admin, 'x-forwarded-for': '127.0.0.1' },
      }),
      { params: Promise.resolve({ workspaceId: f.workspaceId }) }
    )
    const listed = (await roster.json()).data.find(
      (entry: { userId: string }) => entry.userId === f.users.reader
    )
    expect(response.body.data).toEqual(listed)
    expect(listed.role).toBe('write')
    expect(await roleOf(f.users.reader)).toBe('write')

    const [entry] = await awaitAudit('member.role_changed', 1)
    expect(entry.actorId).toBe(f.users.admin)
    expect(entry.metadata).toMatchObject({
      targetUserId: f.users.reader,
      previousRole: 'read',
      actor: { kind: 'personal_api_key' },
    })
  })

  it('lets an OAuth token with api:write change a role', async () => {
    const response = await call({ bearer: f.oauthWriteToken }, 'PATCH', f.users.reader, {
      body: { role: 'write' },
    })
    expect(response).toMatchObject({ status: 200, body: { data: { role: 'write' } } })
    expect(await roleOf(f.users.reader)).toBe('write')
    const [entry] = await awaitAudit('member.role_changed', 1)
    expect(entry.actorId).toBe(f.users.admin)
    expect(entry.metadata).toMatchObject({ actor: { kind: 'oauth_access_token' } })
  })

  it('writes and audits nothing when the requested role is already held', async () => {
    const grantRow = () =>
      db
        .select({ updatedAt: permissions.updatedAt })
        .from(permissions)
        .where(and(eq(permissions.entityId, f.workspaceId), eq(permissions.userId, f.users.reader)))
    const [before] = await grantRow()
    const response = await call(key('admin'), 'PATCH', f.users.reader, { body: { role: 'read' } })
    expect(response).toMatchObject({ status: 200, body: { data: { role: 'read' } } })
    await new Promise((settle) => setTimeout(settle, 500))
    expect(await auditRows('member.role_changed')).toHaveLength(0)
    expect(await grantRow()).toEqual([before])
  })

  it('refuses the last explicit admin leaving', async () => {
    const response = await call(key('admin'), 'DELETE', f.users.admin, {
      workspace: f.lastAdminWorkspaceId,
    })
    expect(response.status).toBe(400)
    expect(response.body.error.message).toMatch(/last admin/)
    expect(await roleOf(f.users.admin, f.lastAdminWorkspaceId)).toBe('admin')
  })

  it('answers an owner removal with no successor as 409, not 500', async () => {
    const response = await call(key('admin'), 'DELETE', f.users.wsOwner, {
      workspace: f.unresolvedOwnerWorkspaceId,
    })
    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('CONFLICT')
    expect(response.body.error.message).toMatch(/billing account/)
    expect(await roleOf(f.users.wsOwner, f.unresolvedOwnerWorkspaceId)).toBe('admin')
    const [row] = await db
      .select({ ownerId: workspace.ownerId })
      .from(workspace)
      .where(eq(workspace.id, f.unresolvedOwnerWorkspaceId))
    expect(row.ownerId).toBe(f.users.wsOwner)
  })

  it('removes another member and audits the removal', async () => {
    const response = await call(key('admin'), 'DELETE', f.users.writer)
    expect(response).toMatchObject({
      status: 200,
      body: {
        data: { userId: f.users.writer, deleted: true, organizationMembershipRemoved: true },
      },
    })
    expect(await roleOf(f.users.writer)).toBeNull()
    expect(await orgMembership(f.users.writer)).toHaveLength(0)
    const [entry] = await awaitAudit('member.removed', 1)
    expect(entry.actorId).toBe(f.users.admin)
    expect(entry.metadata).toMatchObject({ removedUserId: f.users.writer })
  })

  it('lets a member leave with a personal key, ending org membership and sessions', async () => {
    const response = await call(key('reader'), 'DELETE', f.users.reader)
    expect(response).toMatchObject({
      status: 200,
      body: {
        data: { userId: f.users.reader, deleted: true, organizationMembershipRemoved: true },
      },
    })
    expect(await roleOf(f.users.reader)).toBeNull()
    expect(await orgMembership(f.users.reader)).toHaveLength(0)
    expect(await db.select().from(session).where(eq(session.userId, f.users.reader))).toHaveLength(
      0
    )
    const [entry] = await awaitAudit('member.removed', 1)
    expect(entry.actorId).toBe(f.users.reader)
    expect(entry.metadata).toMatchObject({ selfRemoval: true })
    expect((await call(key('reader'), 'DELETE', f.users.reader)).status).toBe(404)
  })
})
