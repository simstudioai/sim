import type { Principal } from '@sim/auth/principal'
import { invitation, invitationWorkspaceGrant, member, workspace } from '@sim/db/schema'
import {
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import {
  createPersonalApiKeyPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { createRouteContext } from '@sim/testing/helpers/http'
import {
  permissionGroupsResolveMock,
  permissionGroupsResolveMockFns,
} from '@sim/testing/mocks/permission-groups-resolve.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)

import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { GET } from '@/app/api/v2/organizations/[organizationId]/invitations/[invitationId]/workspaces/route'

const principal: Principal = createPersonalApiKeyPrincipal({ userId: 'actor', keyId: 'key' })
const params = { organizationId: 'organization', invitationId: 'invitation' }
const rows = [
  { id: 'workspace-a', name: 'Engineering', permission: 'write', archivedAt: null },
  {
    id: 'workspace-b',
    name: 'Engineering',
    permission: 'read',
    archivedAt: new Date('2026-01-01'),
  },
]

function setPrincipal(value: Principal) {
  v2RouteMocks.authenticate.mockResolvedValue({
    principal: value,
    keyType: value.kind === 'workspace_api_key' ? 'workspace' : 'personal',
    rateLimitSubjectIds: ['key:key'],
    rateLimitSubscription: null,
  })
}

function request(query = '', scope = params) {
  return GET(
    createMockRequest({
      url: `http://localhost/api/v2/organizations/${scope.organizationId}/invitations/${scope.invitationId}/workspaces${query}`,
      headers: { 'x-api-key': 'key', 'x-forwarded-for': '127.0.0.1' },
    }),
    createRouteContext(scope)
  )
}

function queueAuthorized(status = 'pending', grants = rows) {
  queueTableRows(member, [{ role: 'admin' }])
  queueTableRows(invitation, [{ id: 'invitation', organizationId: 'organization', status }])
  queueTableRows(invitationWorkspaceGrant, grants)
}

beforeEach(() => {
  resetDbChainMock()
  setPrincipal(principal)
  v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
  v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
  permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization.mockResolvedValue(null)
})

describe('organization invitation workspace grants', () => {
  it.each(['pending', 'accepted', 'rejected', 'cancelled', 'expired'])(
    'inspects retained grants on a %s invitation without exposing tokens',
    async (status) => {
      queueAuthorized(status)
      const response = await request()
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(await response.json()).toEqual({
        data: [rows[0], { ...rows[1], archivedAt: '2026-01-01T00:00:00.000Z' }],
        nextCursor: null,
      })
      expect(dbChainMockFns.select).toHaveBeenLastCalledWith({
        id: workspace.id,
        name: workspace.name,
        permission: invitationWorkspaceGrant.permission,
        archivedAt: workspace.archivedAt,
      })
    }
  )

  it('bounds pages and retains a unique workspace ID tiebreaker', async () => {
    queueAuthorized()
    const first = await request('?limit=1')
    const payload = await first.json()
    expect(payload.data).toEqual([rows[0]])
    expect(payload.nextCursor).toEqual(expect.any(String))
    expect(dbChainMockFns.limit).toHaveBeenLastCalledWith(2)
    queueAuthorized('expired', [rows[1]])
    const next = await request(`?limit=5&cursor=${encodeURIComponent(payload.nextCursor)}`)
    expect(await next.json()).toEqual({
      data: [{ ...rows[1], archivedAt: '2026-01-01T00:00:00.000Z' }],
      nextCursor: null,
    })
    expect(dbChainMockFns.orderBy).toHaveBeenLastCalledWith(
      { type: 'asc', column: workspace.name },
      { type: 'asc', column: workspace.id }
    )
  })

  it('binds a cursor to the organization, invitation, search, and sort', async () => {
    queueAuthorized()
    const payload = await (await request('?limit=1&search=Engineering')).json()
    const cursor = encodeURIComponent(payload.nextCursor)
    for (const [query, scope] of [
      [`?search=Other&cursor=${cursor}`, params],
      [`?search=Engineering&sortBy=id&cursor=${cursor}`, params],
      [`?search=Engineering&sortOrder=desc&cursor=${cursor}`, params],
      [`?search=Engineering&cursor=${cursor}`, { ...params, invitationId: 'another' }],
      [`?search=Engineering&cursor=${cursor}`, { ...params, organizationId: 'another' }],
    ] as const) {
      const selects = dbChainMockFns.select.mock.calls.length
      expect((await request(query, scope)).status).toBe(400)
      expect(dbChainMockFns.select).toHaveBeenCalledTimes(selects)
    }
  })

  it('scopes both invitation ownership and joined workspace metadata to the organization', async () => {
    queueAuthorized()
    await request()
    expect(dbChainMockFns.where).toHaveBeenLastCalledWith({
      type: 'and',
      conditions: [
        { type: 'eq', left: invitation.organizationId, right: 'organization' },
        { type: 'eq', left: invitationWorkspaceGrant.invitationId, right: 'invitation' },
        { type: 'eq', left: workspace.organizationId, right: 'organization' },
        undefined,
        undefined,
      ],
    })
  })

  it.each([
    ['member', 403],
    [null, 404],
  ] as const)('refuses organization role %s before invitation loading', async (role, status) => {
    queueTableRows(member, role ? [{ role }] : [])
    expect((await request()).status).toBe(status)
    expect(dbChainMockFns.from).not.toHaveBeenCalledWith(invitation)
    expect(dbChainMockFns.from).not.toHaveBeenCalledWith(invitationWorkspaceGrant)
  })

  it('conceals an invitation belonging to another organization', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    queueTableRows(invitation, [])
    const response = await request()
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } })
    expect(dbChainMockFns.where).toHaveBeenLastCalledWith({
      type: 'and',
      conditions: [
        { type: 'eq', left: invitation.organizationId, right: 'organization' },
        { type: 'eq', left: invitation.id, right: 'invitation' },
      ],
    })
    expect(dbChainMockFns.from).not.toHaveBeenCalledWith(invitationWorkspaceGrant)
  })

  it('refuses actorless workspace keys before protected loading', async () => {
    setPrincipal(createWorkspaceApiKeyPrincipal({ workspaceId: 'workspace', keyId: 'key' }))
    expect((await request()).status).toBe(403)
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  it('rechecks credential policy but does not require permission to send new invitations', async () => {
    queueAuthorized()
    permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      disableInvitations: true,
    })
    expect((await request()).status).toBe(200)
    queueTableRows(member, [{ role: 'admin' }])
    permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      disablePersonalApiKeys: true,
    })
    expect((await request()).status).toBe(403)
  })
})
