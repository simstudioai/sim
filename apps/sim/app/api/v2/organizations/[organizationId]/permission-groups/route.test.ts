import { member, permissionGroup } from '@sim/db/schema'
import { authMockFns, dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class Unauthenticated extends Error {}
  return {
    authenticate: vi.fn(),
    preauth: vi.fn(),
    rate: vi.fn(),
    regime: vi.fn(),
    config: vi.fn(),
    lock: vi.fn(),
    group: vi.fn(),
    workspaces: vi.fn(),
    groupWorkspaces: vi.fn(),
    conflict: vi.fn(),
    scopeConflicts: vi.fn(),
    Unauthenticated,
  }
})
vi.mock('@sim/audit', () => ({ recordAudit: vi.fn(), AuditAction: {}, AuditResourceType: {} }))
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => ({
  authenticateV2ApiKey: mocks.authenticate,
  V2ApiKeyUnauthenticatedError: mocks.Unauthenticated,
}))
vi.mock('@/lib/core/rate-limiter', () => ({
  RateLimiter: class {
    checkRateLimitDirect = mocks.preauth
    checkRateLimitDirectOrThrow = mocks.rate
  },
  getRateLimit: () => ({ maxTokens: 100, refillRate: 100, refillIntervalMs: 60_000 }),
}))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  isOrganizationPermissionRegimeActive: mocks.regime,
  getUserPermissionConfigForOrganization: mocks.config,
}))
vi.mock('@/lib/permission-groups/locks', () => ({ acquirePermissionGroupOrgLock: mocks.lock }))
vi.mock('@/lib/permission-groups/repository', () => ({
  loadGroupInOrganization: mocks.group,
  getGroupWorkspaces: mocks.groupWorkspaces,
  getWorkspacesForGroups: mocks.workspaces,
  findWorkspacesNotInOrganization: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/lib/permission-groups/application/group-membership', () => ({
  findAllMembersWorkspaceConflict: mocks.conflict,
  findScopeConflicts: mocks.scopeConflicts,
}))

import { dispatchMcpOperation } from '@/lib/api/mcp/dispatch'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { GET as internalList } from '@/app/api/organizations/[id]/permission-groups/route'
import {
  DELETE,
  PATCH,
  GET as readGroup,
} from '@/app/api/v2/organizations/[organizationId]/permission-groups/[groupId]/route'
import { GET, POST } from '@/app/api/v2/organizations/[organizationId]/permission-groups/route'

const principal = { kind: 'personal_api_key', userId: 'admin-1', keyId: 'key-1' } as const
const admission = {
  allowed: true,
  remaining: 99,
  resetAt: new Date(Date.now() + 60_000),
  retryAfterMs: 0,
}
const group = {
  id: 'group-1',
  organizationId: 'org-1',
  name: 'Restricted',
  description: null,
  config: DEFAULT_PERMISSION_GROUP_CONFIG,
  createdBy: 'admin-1',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  isDefault: false,
  membershipMode: 'inherit',
  creatorName: 'Admin',
  creatorEmail: null,
}
const params = { organizationId: 'org-1', groupId: 'group-1' }
const context = { params: Promise.resolve(params) }
const internalContext = { params: Promise.resolve({ id: 'org-1' }) }
const url = 'http://localhost/api/v2/organizations/org-1/permission-groups'
function request(method = 'GET', query = '', body?: unknown) {
  return new NextRequest(url + query, {
    method,
    headers: {
      'x-api-key': 'key',
      'x-forwarded-for': '127.0.0.1',
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  })
}
function authorize(role = 'admin') {
  queueTableRows(member, [{ role }])
}

beforeEach(() => {
  resetDbChainMock()
  mocks.authenticate.mockResolvedValue({
    principal,
    keyType: 'personal',
    rateLimitSubjectIds: ['key:key-1'],
    rateLimitSubscription: null,
  })
  mocks.preauth.mockResolvedValue(admission)
  mocks.rate.mockResolvedValue(admission)
  mocks.regime.mockResolvedValue(true)
  mocks.config.mockResolvedValue(null)
  mocks.group.mockResolvedValue(group)
  mocks.groupWorkspaces.mockResolvedValue([{ id: 'workspace-1', name: 'Engineering' }])
  mocks.workspaces.mockResolvedValue(
    new Map([['group-1', [{ id: 'workspace-1', name: 'Engineering' }]]])
  )
  mocks.conflict.mockResolvedValue(null)
  mocks.scopeConflicts.mockResolvedValue([])
  authMockFns.mockGetSession.mockResolvedValue({
    user: { id: 'admin-1' },
    session: { id: 'session-1' },
  })
})

describe('permission groups across internal and public surfaces', () => {
  it('preserves public authorization failures over MCP', async () => {
    authorize('member')
    const result = await dispatchMcpOperation(
      { operation: 'getPermissionGroup', params },
      {
        inbound: request(),
        credential: { apiKey: 'key', bearer: null },
        audience: { resource: 'https://mcp.sim.test/mcp', allowUnboundApiTokens: true },
        signal: new AbortController().signal,
      }
    )
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([
      expect.objectContaining({ text: expect.stringContaining('ORGANIZATION_ADMIN_REQUIRED') }),
    ])
    expect(mocks.group).not.toHaveBeenCalled()
  })

  it('conceals unrelated organizations through the public API', async () => {
    const response = await GET(request(), context)
    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toMatchObject({
      error: { code: 'NOT_FOUND', message: 'Organization not found' },
    })
  })
  it('preserves the internal organization admin refusal', async () => {
    const response = await internalList(request(), internalContext)
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: 'Admin permissions required' })
  })
  it('returns a machine-readable same-organization role refusal', async () => {
    authorize('member')
    const response = await GET(request(), context)
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      error: { details: { code: 'ORGANIZATION_ADMIN_REQUIRED' } },
    })
  })
  it('rejects a workspace key without loading organization data', async () => {
    mocks.authenticate.mockResolvedValue({
      principal: { kind: 'workspace_api_key', workspaceId: 'workspace-1', keyId: 'key-1' },
      keyType: 'workspace',
      rateLimitSubjectIds: ['key:key-1'],
    })
    expect((await GET(request(), context)).status).toBe(403)
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })
  it('creates a group with 201 and resolved config', async () => {
    authorize()
    queueTableRows(permissionGroup, [])
    const response = await POST(
      request('POST', '', {
        name: '  Restricted  ',
        workspaceIds: ['workspace-1'],
        config: { disableCliAccess: true },
      }),
      context
    )
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      data: {
        name: 'Restricted',
        organizationId: 'org-1',
        membershipMode: 'inherit',
        config: { disableCliAccess: true },
        workspaceIds: ['workspace-1'],
      },
    })
    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
  })
  it('rejects unknown nested policy keys before authorization', async () => {
    const response = await POST(
      request('POST', '', {
        name: 'Restricted',
        workspaceIds: ['workspace-1'],
        config: { disableClAccess: true },
      }),
      context
    )
    expect(response.status).toBe(400)
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })
  it('rejects nonexistent groups within the asserted organization', async () => {
    authorize()
    mocks.group.mockResolvedValue(null)
    expect((await readGroup(request(), context)).status).toBe(404)
    expect(mocks.group).toHaveBeenCalledWith('group-1', 'org-1', expect.anything())
  })
  it('returns conflicts without creating a group', async () => {
    authorize()
    mocks.conflict.mockResolvedValue({
      conflictingGroupName: 'Existing',
      workspaceName: 'Engineering',
    })
    const response = await POST(
      request('POST', '', { name: 'Restricted', workspaceIds: ['workspace-1'] }),
      context
    )
    expect(response.status).toBe(409)
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })
  it('patches config using the locked group and preserves omitted values', async () => {
    authorize()
    mocks.group.mockResolvedValue({
      ...group,
      config: { ...DEFAULT_PERMISSION_GROUP_CONFIG, disableOAuthAppAccess: true },
    })
    dbChainMockFns.returning.mockResolvedValueOnce([
      {
        ...group,
        config: {
          ...DEFAULT_PERMISSION_GROUP_CONFIG,
          disableOAuthAppAccess: true,
          disableCliAccess: true,
        },
      },
    ])
    const response = await PATCH(
      request('PATCH', '', { config: { disableCliAccess: true } }),
      context
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      data: { config: { disableOAuthAppAccess: true, disableCliAccess: true } },
    })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ disableOAuthAppAccess: true, disableCliAccess: true }),
      })
    )
  })
  it('returns 503 with Retry-After for lock contention', async () => {
    authorize()
    mocks.lock.mockRejectedValueOnce(Object.assign(new Error('lock timeout'), { code: '55P03' }))
    const response = await DELETE(request('DELETE'), context)
    expect(response.status).toBe(503)
    expect(response.headers.get('retry-after')).toBeTruthy()
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })
  it('binds cursors to organization, search and sorting but allows a different page size', async () => {
    authorize()
    queueTableRows(permissionGroup, [group, { ...group, id: 'group-2' }])
    const first = await GET(request('GET', '?limit=1&sortBy=name&search=Restr'), context)
    expect(first.status).toBe(200)
    const body = await first.json()
    expect(body.data).toHaveLength(1)
    expect(body.nextCursor).toEqual(expect.any(String))
    for (const query of ['?sortBy=name&search=Other', '?sortBy=name&search=Restr&sortOrder=asc']) {
      expect(
        (
          await GET(
            request('GET', `${query}&cursor=${encodeURIComponent(body.nextCursor)}`),
            context
          )
        ).status
      ).toBe(400)
    }
    expect(
      (
        await GET(
          request('GET', `?sortBy=name&search=Restr&cursor=${encodeURIComponent(body.nextCursor)}`),
          { params: Promise.resolve({ organizationId: 'org-2' }) }
        )
      ).status
    ).toBe(400)
    authorize()
    queueTableRows(permissionGroup, [])
    const last = await GET(
      request(
        'GET',
        `?sortBy=name&search=Restr&limit=2&cursor=${encodeURIComponent(body.nextCursor)}`
      ),
      context
    )
    expect(last.status).toBe(200)
    expect(await last.json()).toEqual({ data: [], nextCursor: null })
    expect(dbChainMockFns.limit).toHaveBeenLastCalledWith(3)
  })
})
