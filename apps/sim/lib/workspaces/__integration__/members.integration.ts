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
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { hashApiKey } from '@/lib/api-key/crypto'
import { hashOAuthToken } from '@/lib/auth/oauth-access-token'
import {
  DELETE as removeMember,
  PATCH as updateMember,
} from '@/app/api/v2/workspaces/[workspaceId]/members/[userId]/route'
import { GET as listMembers } from '@/app/api/v2/workspaces/[workspaceId]/members/route'

/** Directory provisioning on a self-hosted deployment, so a locked SCIM member is refused. */
vi.mock('@/lib/core/config/env-flags', () => ({ ...envFlagsMock, isScimEnabled: true }))

const orgId = generateId()
const scimConnectionId = generateId()
const workspaceId = generateId()
/** Personal workspace whose only explicit admin is `admin`; its owner holds no grant. */
const lastAdminWorkspaceId = generateId()
/** Personal workspace whose billing account holds no grant, so its owner has no successor. */
const unresolvedOwnerWorkspaceId = generateId()
const workspaceIds = [workspaceId, lastAdminWorkspaceId, unresolvedOwnerWorkspaceId]

const users = {
  orgOwner: generateId(),
  admin: generateId(),
  wsOwner: generateId(),
  billing: generateId(),
  writer: generateId(),
  reader: generateId(),
  managed: generateId(),
  outsider: generateId(),
}
const userIds = Object.values(users)
const personalKeys = {
  admin: `sk-sim-fixture-${generateId()}`,
  writer: `sk-sim-fixture-${generateId()}`,
  reader: `sk-sim-fixture-${generateId()}`,
  outsider: `sk-sim-fixture-${generateId()}`,
}
const workspaceKey = `sk-sim-fixture-${generateId()}`
const oauthClientId = generateId()
const oauthReadToken = `sim_oat_${generateShortId(32)}`
const oauthWriteToken = `sim_oat_${generateShortId(32)}`

type Credential = { apiKey: string } | { bearer: string }
const key = (name: keyof typeof personalKeys): Credential => ({ apiKey: personalKeys[name] })
const admin = key('admin')

async function call(
  credential: Credential,
  method: 'PATCH' | 'DELETE',
  target: string,
  options: { workspace?: string; body?: unknown; query?: string } = {}
) {
  const scope = options.workspace ?? workspaceId
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
  return { status: response.status, body: await response.json() }
}

async function roleOf(target: string, scope = workspaceId) {
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

function auditRows(action: string, scope = workspaceId) {
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.workspaceId, scope), eq(auditLog.action, action)))
    .orderBy(asc(auditLog.createdAt))
}

/** Audit is written after the response; wait for the expected row count. */
async function awaitAudit(action: string, count: number, scope = workspaceId) {
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
    .where(and(eq(member.organizationId, orgId), eq(member.userId, target)))
}

/** Drives the real v2 member route handlers with hashed credentials against PostgreSQL. */
describe('v2 workspace member management against PostgreSQL', () => {
  beforeAll(async () => {
    const now = new Date()
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
      .values({ id: orgId, name: 'Members fixture', slug: `members-${orgId}`, createdAt: now })
    await db.insert(member).values(
      (['orgOwner', 'admin', 'wsOwner', 'billing', 'writer', 'reader', 'managed'] as const).map(
        (name) => ({
          id: generateId(),
          userId: users[name],
          organizationId: orgId,
          role: name === 'orgOwner' ? 'owner' : 'member',
        })
      )
    )
    await insertWorkspaceFixture(db, [
      {
        id: workspaceId,
        name: 'Members fixture',
        ownerId: users.wsOwner,
        billedAccountUserId: users.billing,
        organizationId: orgId,
        allowPersonalApiKeys: true,
      },
      {
        id: lastAdminWorkspaceId,
        name: 'Last admin fixture',
        ownerId: users.billing,
        billedAccountUserId: users.billing,
        allowPersonalApiKeys: true,
      },
      {
        id: unresolvedOwnerWorkspaceId,
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
        grant(users.admin, workspaceId, 'admin'),
        grant(users.wsOwner, workspaceId, 'admin'),
        grant(users.billing, workspaceId, 'admin'),
        grant(users.writer, workspaceId, 'write'),
        grant(users.reader, workspaceId, 'read'),
        grant(users.managed, workspaceId, 'write'),
        grant(users.admin, lastAdminWorkspaceId, 'admin'),
        grant(users.wsOwner, unresolvedOwnerWorkspaceId, 'admin'),
        grant(users.admin, unresolvedOwnerWorkspaceId, 'admin'),
      ])
    await db.insert(apiKey).values([
      ...(Object.entries(personalKeys) as [keyof typeof personalKeys, string][]).map(
        ([name, value]) => ({
          id: generateId(),
          userId: users[name],
          name: 'Members fixture',
          key: value,
          keyHash: hashApiKey(value),
          type: 'personal',
        })
      ),
      {
        id: generateId(),
        userId: users.admin,
        workspaceId,
        createdBy: users.admin,
        name: 'Members workspace fixture',
        key: workspaceKey,
        keyHash: hashApiKey(workspaceKey),
        type: 'workspace',
      },
    ])
    await db.insert(oauthClient).values({
      id: oauthClientId,
      clientId: oauthClientId,
      name: 'Members fixture client',
      public: true,
      tokenEndpointAuthMethod: 'none',
      grantTypes: ['authorization_code', 'refresh_token'],
      redirectUris: ['http://127.0.0.1/callback'],
    })
    await db.insert(oauthConsent).values({
      id: generateId(),
      clientId: oauthClientId,
      userId: users.admin,
      scopes: ['api:read', 'api:write'],
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(oauthAccessToken).values(
      (
        [
          [oauthReadToken, ['api:read']],
          [oauthWriteToken, ['api:write']],
        ] as const
      ).map(([token, scopes]) => ({
        id: generateId(),
        token: hashOAuthToken(token.slice('sim_oat_'.length)),
        clientId: oauthClientId,
        userId: users.admin,
        scopes: [...scopes],
        createdAt: now,
        expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      }))
    )
    await db.insert(scimConnection).values({
      id: scimConnectionId,
      organizationId: orgId,
      status: 'active',
      settings: { lockManualMembership: true },
    })
    const managedEmail = `${users.managed}@members.test`
    await db.insert(scimUser).values({
      id: generateId(),
      connectionId: scimConnectionId,
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
  })

  afterAll(async () => {
    await db.delete(auditLog).where(inArray(auditLog.workspaceId, workspaceIds))
    await db.delete(apiKey).where(inArray(apiKey.userId, userIds))
    await db.delete(oauthClient).where(eq(oauthClient.clientId, oauthClientId))
    await db
      .delete(permissions)
      .where(
        and(eq(permissions.entityType, 'workspace'), inArray(permissions.entityId, workspaceIds))
      )
    await deleteWorkspaceFixture(db, inArray(workspace.id, workspaceIds))
    await db.delete(scimConnection).where(eq(scimConnection.id, scimConnectionId))
    await db.delete(member).where(eq(member.organizationId, orgId))
    await db.delete(organization).where(eq(organization.id, orgId))
    await db.delete(session).where(inArray(session.userId, userIds))
    await db.delete(userStats).where(inArray(userStats.userId, userIds))
    await db.delete(user).where(inArray(user.id, userIds))
    await db.$client.end()
  })

  it('refuses a workspace API key on both methods with a coded 403', async () => {
    for (const [method, body] of [
      ['PATCH', { role: 'write' }],
      ['DELETE', undefined],
    ] as const) {
      const response = await call({ apiKey: workspaceKey }, method, users.reader, { body })
      expect(response).toMatchObject({
        status: 403,
        body: {
          error: { code: 'FORBIDDEN', details: { code: 'WORKSPACE_KEY_OPERATION_NOT_PERMITTED' } },
        },
      })
    }
    expect(await roleOf(users.reader)).toBe('read')
  })

  it('refuses an OAuth token without api:write', async () => {
    for (const [method, body] of [
      ['PATCH', { role: 'write' }],
      ['DELETE', undefined],
    ] as const) {
      const response = await call({ bearer: oauthReadToken }, method, users.reader, { body })
      expect(response).toMatchObject({
        status: 403,
        body: { error: { details: { code: 'INSUFFICIENT_SCOPE' } } },
      })
    }
    expect(await roleOf(users.reader)).toBe('read')
  })

  it('refuses a non-admin changing or removing someone else', async () => {
    for (const [method, body] of [
      ['PATCH', { role: 'write' }],
      ['DELETE', undefined],
    ] as const) {
      const response = await call(key('writer'), method, users.reader, { body })
      expect(response).toMatchObject({
        status: 403,
        body: { error: { details: { code: 'INSUFFICIENT_WORKSPACE_ROLE' } } },
      })
    }
    expect(await roleOf(users.reader)).toBe('read')
  })

  it('answers an unreachable and an unknown workspace with the same 404', async () => {
    const unreachable = await call(key('outsider'), 'PATCH', users.reader, {
      body: { role: 'write' },
    })
    const unknown = await call(admin, 'PATCH', users.reader, {
      workspace: generateId(),
      body: { role: 'write' },
    })
    expect(unreachable).toEqual(unknown)
    expect(unreachable).toEqual({
      status: 404,
      body: { error: { code: 'NOT_FOUND', message: 'Workspace not found' } },
    })
    expect((await call(key('outsider'), 'DELETE', users.reader)).status).toBe(404)
  })

  it('treats a non-member target as a 400 to change and a 404 to remove', async () => {
    expect((await call(admin, 'PATCH', users.outsider, { body: { role: 'write' } })).status).toBe(
      400
    )
    expect((await call(admin, 'DELETE', users.outsider)).status).toBe(404)
    expect(await roleOf(users.outsider)).toBeNull()
  })

  it('rejects invalid bodies, query strings, and ids before any write', async () => {
    const invalid = [
      call(admin, 'PATCH', users.reader, { body: { role: 'owner' } }),
      call(admin, 'PATCH', users.reader, { body: { role: 'write', extra: true } }),
      call(admin, 'PATCH', users.reader, { body: {} }),
      call(admin, 'PATCH', users.reader, { body: { role: 'write' }, query: '?force=1' }),
      call(admin, 'DELETE', users.reader, { query: '?force=1' }),
      call(admin, 'PATCH', 'x'.repeat(200), { body: { role: 'write' } }),
    ]
    for (const response of await Promise.all(invalid)) {
      expect(response).toMatchObject({ status: 400, body: { error: { code: 'BAD_REQUEST' } } })
    }
    expect(await roleOf(users.reader)).toBe('read')
  })

  it('keeps the SCIM_MANAGED_MEMBERSHIP code for a directory-managed member', async () => {
    const response = await call(admin, 'PATCH', users.managed, { body: { role: 'read' } })
    expect(response).toMatchObject({
      status: 403,
      body: { error: { code: 'FORBIDDEN', details: { code: 'SCIM_MANAGED_MEMBERSHIP' } } },
    })
    expect(await roleOf(users.managed)).toBe('write')
  })

  it('refuses an admin lowering their own role', async () => {
    const response = await call(admin, 'PATCH', users.admin, { body: { role: 'write' } })
    expect(response.status).toBe(400)
    expect(response.body.error.message).toMatch(/own admin/)
    expect(await roleOf(users.admin)).toBe('admin')
  })

  it('keeps Admin for the owner, the billing account, and organization admins', async () => {
    const refusals = await Promise.all([
      call(admin, 'PATCH', users.wsOwner, { body: { role: 'read' } }),
      call(admin, 'PATCH', users.billing, { body: { role: 'read' } }),
      call(admin, 'PATCH', users.orgOwner, { body: { role: 'write' } }),
      call(admin, 'DELETE', users.orgOwner),
      call(admin, 'DELETE', users.billing),
    ])
    expect(refusals.map((response) => response.status)).toEqual([400, 400, 400, 400, 400])
    expect(await roleOf(users.wsOwner)).toBe('admin')
    expect(await roleOf(users.billing)).toBe('admin')
  })

  it('returns the roster member and audits the key owner as actor', async () => {
    const response = await call(admin, 'PATCH', users.reader, { body: { role: 'write' } })
    expect(response.status).toBe(200)
    expect(Object.keys(response.body)).toEqual(['data'])
    const roster = await listMembers(
      new NextRequest(`http://localhost/api/v2/workspaces/${workspaceId}/members`, {
        headers: { 'X-API-Key': personalKeys.admin, 'x-forwarded-for': '127.0.0.1' },
      }),
      { params: Promise.resolve({ workspaceId }) }
    )
    const listed = (await roster.json()).data.find(
      (entry: { userId: string }) => entry.userId === users.reader
    )
    expect(response.body.data).toEqual(listed)
    expect(listed.role).toBe('write')
    expect(await roleOf(users.reader)).toBe('write')

    const [entry] = await awaitAudit('member.role_changed', 1)
    expect(entry.actorId).toBe(users.admin)
    expect(entry.metadata).toMatchObject({
      targetUserId: users.reader,
      previousRole: 'read',
      actor: { kind: 'personal_api_key' },
    })
  })

  it('lets an OAuth token with api:write change a role', async () => {
    const response = await call({ bearer: oauthWriteToken }, 'PATCH', users.reader, {
      body: { role: 'read' },
    })
    expect(response).toMatchObject({ status: 200, body: { data: { role: 'read' } } })
    expect(await roleOf(users.reader)).toBe('read')
    const rows = await awaitAudit('member.role_changed', 2)
    expect(rows[1].actorId).toBe(users.admin)
    expect(rows[1].metadata).toMatchObject({ actor: { kind: 'oauth_access_token' } })
  })

  it('writes and audits nothing when the requested role is already held', async () => {
    const grantRow = () =>
      db
        .select({ updatedAt: permissions.updatedAt })
        .from(permissions)
        .where(and(eq(permissions.entityId, workspaceId), eq(permissions.userId, users.reader)))
    const [before] = await grantRow()
    const response = await call(admin, 'PATCH', users.reader, { body: { role: 'read' } })
    expect(response).toMatchObject({ status: 200, body: { data: { role: 'read' } } })
    await new Promise((settle) => setTimeout(settle, 500))
    expect(await auditRows('member.role_changed')).toHaveLength(2)
    expect(await grantRow()).toEqual([before])
  })

  it('refuses the last explicit admin leaving', async () => {
    const response = await call(admin, 'DELETE', users.admin, { workspace: lastAdminWorkspaceId })
    expect(response.status).toBe(400)
    expect(response.body.error.message).toMatch(/last admin/)
    expect(await roleOf(users.admin, lastAdminWorkspaceId)).toBe('admin')
  })

  it('answers an owner removal with no successor as 409, not 500', async () => {
    const response = await call(admin, 'DELETE', users.wsOwner, {
      workspace: unresolvedOwnerWorkspaceId,
    })
    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('CONFLICT')
    expect(response.body.error.message).toMatch(/billing account/)
    expect(await roleOf(users.wsOwner, unresolvedOwnerWorkspaceId)).toBe('admin')
    const [row] = await db
      .select({ ownerId: workspace.ownerId })
      .from(workspace)
      .where(eq(workspace.id, unresolvedOwnerWorkspaceId))
    expect(row.ownerId).toBe(users.wsOwner)
  })

  it('removes another member and audits the removal', async () => {
    const response = await call(admin, 'DELETE', users.writer)
    expect(response).toEqual({
      status: 200,
      body: { data: { userId: users.writer, deleted: true, organizationMembershipRemoved: true } },
    })
    expect(await roleOf(users.writer)).toBeNull()
    expect(await orgMembership(users.writer)).toHaveLength(0)
    const [entry] = await awaitAudit('member.removed', 1)
    expect(entry.actorId).toBe(users.admin)
    expect(entry.metadata).toMatchObject({ removedUserId: users.writer })
  })

  it('lets a member leave with a personal key, ending org membership and sessions', async () => {
    const response = await call(key('reader'), 'DELETE', users.reader)
    expect(response).toEqual({
      status: 200,
      body: { data: { userId: users.reader, deleted: true, organizationMembershipRemoved: true } },
    })
    expect(await roleOf(users.reader)).toBeNull()
    expect(await orgMembership(users.reader)).toHaveLength(0)
    expect(await db.select().from(session).where(eq(session.userId, users.reader))).toHaveLength(0)
    const rows = await awaitAudit('member.removed', 2)
    expect(rows[1].actorId).toBe(users.reader)
    expect(rows[1].metadata).toMatchObject({ selfRemoval: true })
    expect((await call(key('reader'), 'DELETE', users.reader)).status).toBe(404)
  })
})
