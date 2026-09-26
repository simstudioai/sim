import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  discover: vi.fn(),
  listMine: vi.fn(),
  create: vi.fn(),
  cancel: vi.fn(),
  listOrganization: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}))
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/ee/access-requests/lib/application/requests', () => ({
  discoverAccessRequests: {
    operation: { id: 'access_requests.discover' },
    execute: mocks.discover,
  },
  listMyAccessRequests: {
    operation: { id: 'access_requests.list_mine' },
    execute: mocks.listMine,
  },
  createAccessRequest: { operation: { id: 'access_requests.create' }, execute: mocks.create },
  cancelAccessRequest: { operation: { id: 'access_requests.cancel' }, execute: mocks.cancel },
  listOrganizationAccessRequests: {
    operation: { id: 'access_requests.list_organization' },
    execute: mocks.listOrganization,
  },
  getAccessRequestSettings: {
    operation: { id: 'access_requests.get_settings' },
    execute: mocks.getSettings,
  },
  updateAccessRequestSettings: {
    operation: { id: 'access_requests.update_settings' },
    execute: mocks.updateSettings,
  },
}))

import type {
  AccessRequestDiscoveryEntry,
  AccessRequestRecord,
} from '@/lib/api/contracts/access-requests'
import type { JsonNextRouteHandler } from '@/lib/api/server/routes/types'
import { NoWorkspaceAccessError } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { GET as discoverOrganization } from '@/app/api/v2/organizations/[organizationId]/access-requests/discovery/route'
import { GET as listMyOrganization } from '@/app/api/v2/organizations/[organizationId]/access-requests/mine/route'
import {
  POST as createOrganization,
  GET as listOrganization,
} from '@/app/api/v2/organizations/[organizationId]/access-requests/route'
import { GET as discoverWorkspace } from '@/app/api/v2/workspaces/[workspaceId]/access-requests/discovery/route'
import {
  POST as createWorkspace,
  GET as listWorkspace,
} from '@/app/api/v2/workspaces/[workspaceId]/access-requests/route'

const principal = { kind: 'personal_api_key', userId: 'caller', keyId: 'key' } as const
const organizationId = 'organization-123'
const workspaceId = 'workspace-123'
const requestId = 'request-123'
const workspaceScope = { kind: 'workspace', workspaceId } as const
const organizationScope = { kind: 'organization', organizationId } as const
const target = { kind: 'integration', id: 'slack' } as const
const record: AccessRequestRecord = {
  id: requestId,
  organizationId,
  workspaceId,
  target,
  targetLabel: 'Slack',
  reason: 'Coordinate incident response',
  status: 'pending',
  decisionReason: null,
  createdAt: '2026-09-21T10:00:00.000Z',
  decidedAt: null,
  groupName: 'Engineering',
  requester: { id: principal.userId, name: 'Caller', email: 'caller@example.com' },
}
const entry: AccessRequestDiscoveryEntry = {
  target,
  label: 'Slack',
  state: 'requestable',
  reason: null,
  pendingRequestId: null,
}

interface RouteCase {
  name: string
  handler: JsonNextRouteHandler
  method: 'GET' | 'POST' | 'PATCH'
  params: Record<string, string>
  execute: ReturnType<typeof vi.fn>
  body?: unknown
}

const listCases = [
  {
    name: 'workspace history',
    handler: listWorkspace,
    method: 'GET',
    params: { workspaceId },
    execute: mocks.listMine,
  },
  {
    name: 'organization caller history',
    handler: listMyOrganization,
    method: 'GET',
    params: { organizationId },
    execute: mocks.listMine,
  },
  {
    name: 'organization admin list',
    handler: listOrganization,
    method: 'GET',
    params: { organizationId },
    execute: mocks.listOrganization,
  },
] satisfies RouteCase[]
const discoveryCases = [
  {
    name: 'workspace discovery',
    handler: discoverWorkspace,
    method: 'GET',
    params: { workspaceId },
    execute: mocks.discover,
    scope: workspaceScope,
  },
  {
    name: 'organization discovery',
    handler: discoverOrganization,
    method: 'GET',
    params: { organizationId },
    execute: mocks.discover,
    scope: organizationScope,
  },
] satisfies (RouteCase & { scope: typeof workspaceScope | typeof organizationScope })[]
const createCases = [
  {
    name: 'workspace create',
    handler: createWorkspace,
    method: 'POST',
    params: { workspaceId },
    execute: mocks.create,
    body: { target },
    scope: workspaceScope,
  },
  {
    name: 'organization create',
    handler: createOrganization,
    method: 'POST',
    params: { organizationId },
    execute: mocks.create,
    body: { target },
    scope: organizationScope,
  },
] satisfies (RouteCase & { scope: typeof workspaceScope | typeof organizationScope })[]

function call(
  route: RouteCase,
  options: { query?: string; body?: unknown; params?: Record<string, string> } = {}
) {
  const body = options.body ?? route.body
  return route.handler(
    new NextRequest(`http://localhost/api/v2/access-requests${options.query ?? ''}`, {
      method: route.method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: { 'content-type': 'application/json' },
    }),
    { params: Promise.resolve(options.params ?? route.params) }
  )
}

beforeEach(() => {
  v2RouteMocks.authenticate.mockResolvedValue({
    principal,
    keyType: 'personal',
    rateLimitSubjectIds: ['user:caller'],
    rateLimitSubscription: null,
  })
  v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
  v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
  mocks.discover.mockResolvedValue({ entries: [entry], hasMore: false })
  mocks.listMine.mockResolvedValue({ requests: [record], nextCursorKeys: null })
  mocks.listOrganization.mockResolvedValue({ requests: [record], nextCursorKeys: null })
  mocks.create.mockResolvedValue({ request: record })
})

describe('public access-request adapters', () => {
  it.each(createCases)(
    '$name derives scope exclusively from the path and defaults an omitted reason',
    async (route) => {
      const response = await call(route)
      expect(await response.json()).toEqual({ data: record })
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({ input: { scope: route.scope, target, reason: '' } })
      )
      mocks.create.mockClear()
      for (const body of [
        { target, scope: { kind: 'organization', organizationId: 'other-org' } },
        { target, userId: 'other-user' },
        { target: { ...target, unexpected: true } },
        { target: { kind: 'unsupported', id: 'slack' } },
        { target, reason: 'a'.repeat(1001) },
      ]) {
        expect((await call(route, { body })).status).toBe(400)
      }
      expect(mocks.create).not.toHaveBeenCalled()
    }
  )

  it.each(listCases)(
    '$name resumes a keyset cursor and rejects scope, sort, or filter rebinding',
    async (route) => {
      const keys = [record.createdAt, requestId]
      route.execute.mockResolvedValueOnce({ requests: [record], nextCursorKeys: keys })
      const first = await call(route, { query: '?status=pending&limit=1' })
      const { nextCursor } = await first.json()
      expect(nextCursor).toEqual(expect.any(String))
      const cursorQuery = `?status=pending&cursor=${encodeURIComponent(nextCursor)}`
      const second = await call(route, { query: cursorQuery })
      expect(second.status).toBe(200)
      expect(await second.json()).toEqual({ data: [record], nextCursor: null })
      expect(route.execute).toHaveBeenLastCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            paging: { sortBy: 'createdAt', sortOrder: 'desc', cursorKeys: keys },
          }),
        })
      )
      route.execute.mockClear()
      for (const query of [
        `${cursorQuery}&sortBy=targetLabel`,
        `${cursorQuery}&sortOrder=asc`,
        cursorQuery.replace('status=pending', 'status=declined'),
        '?cursor=not-a-cursor',
      ]) {
        expect((await call(route, { query })).status).toBe(400)
      }
      const scopeParams =
        'workspaceId' in route.params
          ? { workspaceId: 'other-workspace' }
          : { organizationId: 'other-org' }
      expect((await call(route, { query: cursorQuery, params: scopeParams })).status).toBe(400)
      if (route.execute === mocks.listOrganization) {
        expect((await call(route, { query: `${cursorQuery}&search=other` })).status).toBe(400)
        expect((await call(listCases[1], { query: cursorQuery })).status).toBe(400)
        expect(mocks.listMine).not.toHaveBeenCalled()
      }
      expect(route.execute).not.toHaveBeenCalled()
    }
  )

  it.each(discoveryCases)(
    '$name binds its offset cursor to filters, sorting, and scope',
    async (route) => {
      mocks.discover.mockResolvedValueOnce({ entries: [entry], hasMore: true })
      const query = '?search=Slack&targetKind=integration&state=requestable&limit=1'
      const first = await call(route, { query })
      const { nextCursor } = await first.json()
      expect(nextCursor).toEqual(expect.any(String))
      const cursorQuery = `${query}&cursor=${encodeURIComponent(nextCursor)}`
      const second = await call(route, { query: cursorQuery })
      expect(await second.json()).toEqual({ data: [entry], nextCursor: null })
      expect(mocks.discover).toHaveBeenLastCalledWith(
        expect.objectContaining({ input: expect.objectContaining({ offset: 1 }) })
      )
      mocks.discover.mockClear()
      for (const rebound of [
        `${cursorQuery}&sortOrder=desc`,
        cursorQuery.replace('search=Slack', 'search=GitHub'),
        cursorQuery.replace('targetKind=integration', 'targetKind=model'),
        cursorQuery.replace('state=requestable', 'state=allowed'),
        '?cursor=not-a-cursor',
      ]) {
        expect((await call(route, { query: rebound })).status).toBe(400)
      }
      const scopeParams =
        'workspaceId' in route.params
          ? { workspaceId: 'other-workspace' }
          : { organizationId: 'other-org' }
      expect((await call(route, { query: cursorQuery, params: scopeParams })).status).toBe(400)
      const otherScope = route.handler === discoverWorkspace ? discoveryCases[1] : discoveryCases[0]
      expect((await call(otherScope, { query: cursorQuery })).status).toBe(400)
      expect(mocks.discover).not.toHaveBeenCalled()
    }
  )

  it.each([
    new NoWorkspaceAccessError(),
    new OrchestrationError('not_found', 'Workspace not found'),
  ])('conceals inaccessible and missing scopes consistently', async (error) => {
    mocks.listMine.mockRejectedValue(error)
    const response = await call(listCases[0])
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Access request scope not found' },
    })
  })
})
