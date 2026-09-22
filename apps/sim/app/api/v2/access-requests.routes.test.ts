/** @vitest-environment node */
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
  preview: vi.fn(),
  resolve: vi.fn(),
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
vi.mock('@/ee/access-requests/lib/application/review', () => ({
  previewAccessRequest: {
    operation: { id: 'access_requests.preview' },
    execute: mocks.preview,
  },
  resolveAccessRequest: {
    operation: { id: 'access_requests.resolve' },
    execute: mocks.resolve,
  },
}))

import type {
  AccessRequestDiscoveryEntry,
  AccessRequestPreviewResponse,
  AccessRequestRecord,
} from '@/lib/api/contracts/access-requests'
import type { JsonNextRouteHandler } from '@/lib/api/server/routes/types'
import { NoWorkspaceAccessError, WorkspaceApiKeyAuthorizationError } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { POST as cancelOrganization } from '@/app/api/v2/organizations/[organizationId]/access-requests/[requestId]/cancel/route'
import { GET as previewOrganization } from '@/app/api/v2/organizations/[organizationId]/access-requests/[requestId]/preview/route'
import { POST as resolveOrganization } from '@/app/api/v2/organizations/[organizationId]/access-requests/[requestId]/resolve/route'
import { GET as discoverOrganization } from '@/app/api/v2/organizations/[organizationId]/access-requests/discovery/route'
import { GET as listMyOrganization } from '@/app/api/v2/organizations/[organizationId]/access-requests/mine/route'
import {
  POST as createOrganization,
  GET as listOrganization,
} from '@/app/api/v2/organizations/[organizationId]/access-requests/route'
import {
  GET as getSettings,
  PATCH as updateSettings,
} from '@/app/api/v2/organizations/[organizationId]/access-requests/settings/route'
import { POST as cancelWorkspace } from '@/app/api/v2/workspaces/[workspaceId]/access-requests/[requestId]/cancel/route'
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
const preview: AccessRequestPreviewResponse = {
  resolutionKind: 'permission',
  request: record,
  group: { id: 'group-123', name: 'Engineering' },
  changes: [],
  impact: { memberCount: 4, workspaceCount: 1, workspaceNames: ['Production'], truncated: false },
  currentLimitCredits: null,
  newLimitCredits: null,
  fingerprint: 'reviewed-fingerprint',
  canApply: true,
  unavailableReason: null,
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
const cancelCases = [
  {
    name: 'workspace cancel',
    handler: cancelWorkspace,
    method: 'POST',
    params: { workspaceId, requestId },
    execute: mocks.cancel,
    scope: workspaceScope,
  },
  {
    name: 'organization cancel',
    handler: cancelOrganization,
    method: 'POST',
    params: { organizationId, requestId },
    execute: mocks.cancel,
    scope: organizationScope,
  },
] satisfies (RouteCase & { scope: typeof workspaceScope | typeof organizationScope })[]
const previewCase: RouteCase = {
  name: 'organization preview',
  handler: previewOrganization,
  method: 'GET',
  params: { organizationId, requestId },
  execute: mocks.preview,
}
const resolveCase: RouteCase = {
  name: 'organization resolve',
  handler: resolveOrganization,
  method: 'POST',
  params: { organizationId, requestId },
  execute: mocks.resolve,
  body: { action: 'apply', expectedFingerprint: preview.fingerprint },
}
const settingsCases: RouteCase[] = [
  {
    name: 'organization settings read',
    handler: getSettings,
    method: 'GET',
    params: { organizationId },
    execute: mocks.getSettings,
  },
  {
    name: 'organization settings update',
    handler: updateSettings,
    method: 'PATCH',
    params: { organizationId },
    execute: mocks.updateSettings,
    body: { allowRequests: false },
  },
]
const allCases = [
  ...listCases,
  ...discoveryCases,
  ...createCases,
  ...cancelCases,
  previewCase,
  resolveCase,
  ...settingsCases,
]

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
  vi.clearAllMocks()
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
  mocks.cancel.mockResolvedValue({ request: { ...record, status: 'cancelled' } })
  mocks.preview.mockResolvedValue(preview)
  mocks.resolve.mockResolvedValue({ request: { ...record, status: 'fulfilled' } })
  mocks.getSettings.mockResolvedValue({ allowRequests: true })
  mocks.updateSettings.mockResolvedValue({ allowRequests: false })
})

describe('public access-request adapters', () => {
  it.each(allCases)('$name authenticates before parsing or executing', async (route) => {
    v2RouteMocks.authenticate.mockRejectedValue(
      new v2ApiKeyAuthModuleMock.V2ApiKeyUnauthenticatedError()
    )
    const response = await call(route, { query: '?userId=other-user' })
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } })
    expect(route.execute).not.toHaveBeenCalled()
  })

  it.each(allCases)('$name rejects undeclared query fields before executing', async (route) => {
    const response = await call(route, { query: '?userId=other-user' })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'BAD_REQUEST' } })
    expect(route.execute).not.toHaveBeenCalled()
  })

  it.each(allCases)(
    '$name forwards the authenticated actor and returns the v2 envelope',
    async (route) => {
      const response = await call(route)
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(route.execute).toHaveBeenCalledWith(expect.objectContaining({ principal }))
      expect(await response.json()).toHaveProperty('data')
    }
  )

  it.each([...listCases, ...discoveryCases])(
    '$name rejects fractional and out-of-range limits',
    async (route) => {
      for (const limit of ['1.5', '0', '101', '-1']) {
        expect((await call(route, { query: `?limit=${limit}` })).status).toBe(400)
      }
      expect(route.execute).not.toHaveBeenCalled()
    }
  )

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

  it.each(cancelCases)(
    '$name accepts an empty HTTP body and passes the asserted scope',
    async (route) => {
      const response = await call(route)
      expect(await response.json()).toEqual({ data: { ...record, status: 'cancelled' } })
      expect(mocks.cancel).toHaveBeenCalledWith(
        expect.objectContaining({ input: { requestId, scope: route.scope } })
      )
      expect((await call(route, { body: {} })).status).toBe(200)
    }
  )

  it('keeps caller history separate from organization administrator listing', async () => {
    await call(listCases[0], { query: '?status=pending&sortBy=targetLabel&sortOrder=asc&limit=3' })
    expect(mocks.listMine).toHaveBeenLastCalledWith(
      expect.objectContaining({
        input: {
          scope: workspaceScope,
          status: 'pending',
          limit: 3,
          offset: 0,
          paging: { sortBy: 'targetLabel', sortOrder: 'asc', cursorKeys: undefined },
        },
      })
    )
    await call(listCases[1])
    expect(mocks.listMine).toHaveBeenLastCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ scope: organizationScope }) })
    )
    expect(mocks.listOrganization).not.toHaveBeenCalled()
    const response = await call(listCases[2], { query: '?search=Caller&status=pending' })
    expect(await response.json()).toEqual({ data: [record], nextCursor: null })
    expect(mocks.listOrganization).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          organizationId,
          search: 'Caller',
          status: 'pending',
          limit: 50,
          offset: 0,
          paging: { sortBy: 'createdAt', sortOrder: 'desc', cursorKeys: undefined },
        },
      })
    )
    expect((await call(listCases[0], { query: '?search=Caller' })).status).toBe(400)
    expect((await call(listCases[1], { query: '?search=Caller' })).status).toBe(400)
  })

  it.each(discoveryCases)('$name maps bounded discovery filters and scope', async (route) => {
    const response = await call(route, {
      query: '?search=Slack&targetKind=integration&state=requestable&limit=3&sortOrder=desc',
    })
    expect(await response.json()).toEqual({ data: [entry], nextCursor: null })
    expect(mocks.discover).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          ...route.scope,
          search: 'Slack',
          targetKind: 'integration',
          state: 'requestable',
          limit: 3,
          sortBy: 'label',
          sortOrder: 'desc',
          offset: 0,
        }),
      })
    )
  })

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

  it('returns the full preview under the v2 data envelope', async () => {
    const response = await call(previewCase)
    expect(await response.json()).toEqual({ data: preview })
    expect(mocks.preview).toHaveBeenCalledWith(
      expect.objectContaining({ input: { organizationId, requestId } })
    )
  })

  it.each([
    { action: 'apply', expectedFingerprint: preview.fingerprint },
    { action: 'apply', expectedFingerprint: preview.fingerprint, newLimitCredits: 500 },
    { action: 'decline', reason: 'Please use the approved integration' },
  ])('passes the exact discriminated review decision to the shared use case', async (decision) => {
    const response = await call(resolveCase, { body: decision })
    expect(await response.json()).toEqual({ data: { ...record, status: 'fulfilled' } })
    expect(mocks.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ input: { organizationId, requestId, decision } })
    )
  })

  it.each([
    { action: 'approve', expectedFingerprint: preview.fingerprint },
    { action: 'apply' },
    { action: 'apply', expectedFingerprint: '' },
    { action: 'apply', expectedFingerprint: 'x'.repeat(129) },
    { action: 'apply', expectedFingerprint: preview.fingerprint, reason: 'wrong branch' },
    ...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '500', null].map((newLimitCredits) => ({
      action: 'apply',
      expectedFingerprint: preview.fingerprint,
      newLimitCredits,
    })),
    { action: 'decline' },
    { action: 'decline', reason: '   ' },
    { action: 'decline', reason: 'x'.repeat(1001) },
    { action: 'decline', reason: 'No', expectedFingerprint: preview.fingerprint },
    { action: 'decline', reason: 'No', newLimitCredits: 500 },
  ])('rejects invalid or mixed review decisions before applying any change', async (body) => {
    expect((await call(resolveCase, { body })).status).toBe(400)
    expect(mocks.resolve).not.toHaveBeenCalled()
  })

  it('preserves a stale-preview conflict instead of retrying the mutation', async () => {
    mocks.resolve.mockRejectedValue(new OrchestrationError('conflict', 'Preview changed'))
    const response = await call(resolveCase)
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: { code: 'CONFLICT', message: 'Preview changed' },
    })
    expect(mocks.resolve).toHaveBeenCalledTimes(1)
  })

  it('reads and updates the exact organization request setting', async () => {
    expect(await (await call(settingsCases[0])).json()).toEqual({ data: { allowRequests: true } })
    expect(mocks.getSettings).toHaveBeenCalledWith(
      expect.objectContaining({ input: { organizationId } })
    )
    expect(await (await call(settingsCases[1])).json()).toEqual({ data: { allowRequests: false } })
    expect(mocks.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ input: { organizationId, allowRequests: false } })
    )
    mocks.updateSettings.mockClear()
    for (const body of [
      {},
      { allowRequests: 'false' },
      { allowRequests: false, organizationId: 'other' },
    ]) {
      expect((await call(settingsCases[1], { body })).status).toBe(400)
    }
    expect(mocks.updateSettings).not.toHaveBeenCalled()
  })

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

  it('preserves the explicit workspace-key refusal code', async () => {
    mocks.create.mockRejectedValue(new WorkspaceApiKeyAuthorizationError())
    const response = await call(createCases[0])
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      error: { code: 'FORBIDDEN', details: { code: 'WORKSPACE_KEY_OPERATION_NOT_PERMITTED' } },
    })
  })
})
