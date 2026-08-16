/**
 * @vitest-environment node
 */
import {
  MockV2ApiKeyUnauthenticatedError,
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2GateModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createWorkflow: vi.fn(),
  listWorkflows: vi.fn(),
}))

vi.mock('@/lib/workflows/application/create-workflow', () => ({
  createWorkflow: { operation: { id: 'workflows.create' }, execute: mocks.createWorkflow },
}))

vi.mock('@/lib/workflows/application/list-workflows', () => ({
  listWorkflows: { operation: { id: 'workflows.list' }, execute: mocks.listWorkflows },
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/app/api/v2/lib/gate', () => v2GateModuleMock)

import { GET, POST } from '@/app/api/v2/workflows/route'

const WORKSPACE_ID = 'workspace-1'
const WORKFLOW = {
  id: 'workflow-1',
  name: 'Daily digest',
  description: null,
  folderId: null,
  folderPath: '/',
  workspaceId: WORKSPACE_ID,
  isDeployed: false,
  deployedAt: null,
  runCount: 3,
  lastRunAt: null,
  sortOrder: 0,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-02T00:00:00.000Z'),
}

const workspaceAuth = {
  principal: {
    kind: 'workspace_api_key' as const,
    workspaceId: WORKSPACE_ID,
    keyId: 'workspace-key-1',
  },
  rolloutUserId: 'billing-owner-1',
  rateLimitSubjectIds: ['api-key:workspace-key-1', `workspace:${WORKSPACE_ID}`] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}

const personalAuth = {
  principal: {
    kind: 'personal_api_key' as const,
    userId: 'user-1',
    keyId: 'personal-key-1',
  },
  rolloutUserId: 'user-1',
  rateLimitSubjectIds: ['api-key:personal-key-1', 'user:user-1'] as const,
  rateLimitSubscription: null,
  keyType: 'personal' as const,
}

describe('/api/v2/workflows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(workspaceAuth)
    v2RouteMocks.gate.mockResolvedValue(null)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.listWorkflows.mockResolvedValue({
      workflows: [WORKFLOW],
      nextCursorKeys: null,
      sortBy: 'position',
      sortOrder: 'asc',
    })
    mocks.createWorkflow.mockResolvedValue({ workflow: WORKFLOW, folderPath: '/' })
  })

  it('authenticates and rate limits before parsing list input', async () => {
    const response = await GET(new NextRequest('http://localhost/api/v2/workflows'))

    expect(response.status).toBe(400)
    expect(v2RouteMocks.authenticate).toHaveBeenCalledOnce()
    expect(v2RouteMocks.operationRate).toHaveBeenCalledTimes(2)
    expect(mocks.listWorkflows).not.toHaveBeenCalled()
  })

  /**
   * The reported defect: a cursor from an unfiltered page was accepted under
   * `deployedOnly=true` or a changed `search`, and answered with whatever
   * matched the new filter *after* the old position — every earlier match
   * silently missing behind an opaque token.
   */
  it.each([
    ['deployedOnly', 'deployedOnly=true'],
    ['search', 'search=billing'],
    ['folderPath', 'folderPath=/Ops'],
  ])('refuses a cursor replayed under a different %s', async (_filter, param) => {
    mocks.listWorkflows.mockResolvedValueOnce({
      workflows: [WORKFLOW],
      nextCursorKeys: [1, WORKFLOW.id],
      sortBy: 'position',
      sortOrder: 'asc',
    })
    const firstPage = await (
      await GET(new NextRequest(`http://localhost/api/v2/workflows?workspaceId=${WORKSPACE_ID}`))
    ).json()
    expect(firstPage.nextCursor).toEqual(expect.any(String))
    mocks.listWorkflows.mockClear()

    const response = await GET(
      new NextRequest(
        `http://localhost/api/v2/workflows?workspaceId=${WORKSPACE_ID}&${param}&cursor=${encodeURIComponent(firstPage.nextCursor)}`
      )
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { code: 'BAD_REQUEST', message: expect.stringContaining('requested filters') },
    })
    expect(mocks.listWorkflows).not.toHaveBeenCalled()
  })

  it('resumes a cursor whose filters are unchanged', async () => {
    mocks.listWorkflows.mockResolvedValueOnce({
      workflows: [WORKFLOW],
      nextCursorKeys: [1, WORKFLOW.id],
      sortBy: 'position',
      sortOrder: 'asc',
    })
    const firstPage = await (
      await GET(
        new NextRequest(
          `http://localhost/api/v2/workflows?workspaceId=${WORKSPACE_ID}&deployedOnly=true`
        )
      )
    ).json()

    const response = await GET(
      new NextRequest(
        `http://localhost/api/v2/workflows?workspaceId=${WORKSPACE_ID}&deployedOnly=true&cursor=${encodeURIComponent(firstPage.nextCursor)}`
      )
    )

    expect(response.status).toBe(200)
    expect(mocks.listWorkflows).toHaveBeenLastCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ cursorKeys: [1, WORKFLOW.id] }),
      })
    )
  })

  it('lists through the workspace principal and preserves rate headers', async () => {
    const request = new NextRequest(
      `http://localhost/api/v2/workflows?workspaceId=${WORKSPACE_ID}`,
      { headers: { 'x-api-key': 'secret' } }
    )
    const response = await GET(request)

    expect(response.status).toBe(200)
    expect(response.headers.get('x-ratelimit-limit')).toBe('100')
    expect(response.headers.get('x-ratelimit-remaining')).toBe('99')
    expect(await response.json()).toEqual({
      data: [
        {
          id: WORKFLOW.id,
          name: WORKFLOW.name,
          description: null,
          folderPath: '/',
          workspaceId: WORKSPACE_ID,
          isDeployed: false,
          deployedAt: null,
          runCount: 3,
          lastRunAt: null,
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-02T00:00:00.000Z',
        },
      ],
      nextCursor: null,
    })
    expect(mocks.listWorkflows).toHaveBeenCalledWith({
      principal: workspaceAuth.principal,
      input: expect.objectContaining({ workspaceId: WORKSPACE_ID, limit: 50 }),
      request,
    })
  })

  it('creates through a personal-key principal with the exact 201 contract', async () => {
    v2RouteMocks.authenticate.mockResolvedValue(personalAuth)
    const request = new NextRequest('http://localhost/api/v2/workflows', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
      body: JSON.stringify({ workspaceId: WORKSPACE_ID, name: WORKFLOW.name }),
    })
    const response = await POST(request)

    expect(response.status).toBe(201)
    expect((await response.json()).data.id).toBe(WORKFLOW.id)
    expect(mocks.createWorkflow).toHaveBeenCalledWith({
      principal: personalAuth.principal,
      input: { workspaceId: WORKSPACE_ID, name: WORKFLOW.name },
      request,
    })
  })

  it('hides infrastructure failures behind the safe v2 500 envelope', async () => {
    mocks.listWorkflows.mockRejectedValue(new Error('database connection details'))
    const response = await GET(
      new NextRequest(`http://localhost/api/v2/workflows?workspaceId=${WORKSPACE_ID}`)
    )

    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
  })

  it('rejects an unauthenticated request', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await GET(
      new NextRequest(`http://localhost/api/v2/workflows?workspaceId=${WORKSPACE_ID}`)
    )

    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('UNAUTHORIZED')
  })

  /**
   * A `U+0000` in caller text is a driver-level throw on the way to a `text`
   * column, and an unclassified throw is a `500 INTERNAL_ERROR`. The read case
   * needed no write at all — a search term was enough — so it is asserted here
   * against the real route, not only against the parser.
   */
  describe('NUL bytes in caller text', () => {
    const NUL = '\u0000'

    it('rejects a NUL search term with the v2 validation envelope, not a 500', async () => {
      const response = await GET(
        new NextRequest(
          `http://localhost/api/v2/workflows?workspaceId=${WORKSPACE_ID}&search=${encodeURIComponent(`a${NUL}b`)}`,
          { headers: { 'x-api-key': 'secret' } }
        )
      )

      expect(response.status).toBe(400)
      expect((await response.json()).error.code).toBe('BAD_REQUEST')
      expect(mocks.listWorkflows).not.toHaveBeenCalled()
    })

    it('rejects a NUL workflow name before the create use case runs', async () => {
      const response = await POST(
        new NextRequest('http://localhost/api/v2/workflows', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
          body: JSON.stringify({ name: `a${NUL}b`, workspaceId: WORKSPACE_ID }),
        })
      )

      expect(response.status).toBe(400)
      expect((await response.json()).error.code).toBe('BAD_REQUEST')
      expect(mocks.createWorkflow).not.toHaveBeenCalled()
    })

    it('rejects a NUL description on the same body', async () => {
      const response = await POST(
        new NextRequest('http://localhost/api/v2/workflows', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
          body: JSON.stringify({
            name: 'Daily digest',
            description: `notes${NUL}`,
            workspaceId: WORKSPACE_ID,
          }),
        })
      )

      expect(response.status).toBe(400)
      expect(mocks.createWorkflow).not.toHaveBeenCalled()
    })
  })
})
