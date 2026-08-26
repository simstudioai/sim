/**
 * @vitest-environment node
 */
import {
  MockV2ApiKeyUnauthenticatedError,
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { REFILTERED_CURSOR_MESSAGE, UNREADABLE_CURSOR_MESSAGE } from '@/lib/api/cursor-binding'

const mocks = vi.hoisted(() => ({
  listVersions: vi.fn(),
}))

vi.mock('@/lib/workflows/application/list-workflow-versions', () => ({
  listWorkflowVersions: {
    operation: { id: 'workflows.versions.list' },
    execute: mocks.listVersions,
  },
}))
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

import { GET } from '@/app/api/v2/workflows/[workflowId]/versions/route'

const auth = {
  principal: {
    kind: 'workspace_api_key' as const,
    workspaceId: 'workspace-1',
    keyId: 'workspace-key-1',
  },
  rateLimitSubjectIds: ['api-key:workspace-key-1', 'workspace:workspace-1'] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
const context = { params: Promise.resolve({ workflowId: 'workflow-1' }) }

function contextFor(workflowId: string) {
  return { params: Promise.resolve({ workflowId: workflowId }) }
}

function listVersions(workflowId: string, query = '') {
  return GET(
    new NextRequest(`http://localhost/api/v2/workflows/${workflowId}/versions${query}`),
    contextFor(workflowId)
  )
}

/**
 * A cursor as the route itself mints it, rather than a payload hand-built by
 * the test. The binding a cursor carries is the route's to compute, so a test
 * that reconstructs it would pass against a route that stopped applying one.
 */
async function mintCursor(workflowId: string): Promise<string> {
  mocks.listVersions.mockResolvedValueOnce({
    versions: [
      {
        id: 'version-5',
        version: 5,
        name: 'Production',
        description: null,
        isActive: true,
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        deployedByName: 'Ada',
        latestOperationStatus: 'active',
      },
    ],
    hasMore: true,
  })
  const { nextCursor } = await (await listVersions(workflowId)).json()
  expect(typeof nextCursor).toBe('string')
  return nextCursor
}

/** A minted cursor's binding, carrying a forged payload inside it. */
async function forgeInsideBinding(workflowId: string, payload: unknown): Promise<string> {
  const { scope } = JSON.parse(Buffer.from(await mintCursor(workflowId), 'base64').toString())
  const inner = Buffer.from(JSON.stringify(payload)).toString('base64')
  return Buffer.from(JSON.stringify({ scope, inner })).toString('base64')
}

describe('GET /api/v2/workflows/[workflowId]/versions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.listVersions.mockResolvedValue({
      versions: [
        {
          id: 'version-2',
          version: 2,
          name: 'Production',
          description: null,
          isActive: true,
          createdAt: new Date('2026-08-01T00:00:00.000Z'),
          deployedByName: 'Ada',
          latestOperationStatus: 'active',
        },
      ],
      hasMore: false,
    })
  })

  it('lists versions through canonical workflow authorization', async () => {
    const request = new NextRequest(
      'http://localhost/api/v2/workflows/workflow-1/versions?limit=10'
    )
    const response = await GET(request, context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: [
        {
          id: 'version-2',
          version: 2,
          name: 'Production',
          description: null,
          isActive: true,
          createdAt: '2026-08-01T00:00:00.000Z',
          deployedBy: 'Ada',
          latestOperationStatus: 'active',
        },
      ],
      nextCursor: null,
    })
    expect(mocks.listVersions).toHaveBeenCalledWith({
      principal: auth.principal,
      input: { workflowId: 'workflow-1', limit: 10, afterVersion: undefined },
      request,
    })
  })

  it('rejects malformed cursors before the use case', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/v2/workflows/workflow-1/versions?cursor=bad'),
      context
    )

    expect(response.status).toBe(400)
    expect(mocks.listVersions).not.toHaveBeenCalled()
    /**
     * The undecodable-token message, not the sort-mismatch one: this list
     * declares no `sortBy`/`sortOrder`, so naming them would answer a 400 with
     * advice that earns a second.
     */
    expect((await response.json()).error.message).toBe(UNREADABLE_CURSOR_MESSAGE)
  })

  /**
   * A cursor is caller-controlled bytes, so its decoded payload is validated
   * like any request field. `version` is compared against an `integer` column,
   * where an out-of-range value overflows the comparison and 500s instead of
   * returning an empty page.
   */
  it.each([
    ['out of the integer range', { version: 2147483648 }],
    ['at zero', { version: 0 }],
    ['non-numeric', { version: 'two' }],
    ['carrying an unknown key', { version: 2, sort: 'name' }],
    ['missing its key', {}],
  ])('rejects a forged cursor %s', async (_case, payload) => {
    const cursor = await forgeInsideBinding('workflow-1', payload)
    mocks.listVersions.mockClear()

    const response = await listVersions('workflow-1', `?cursor=${encodeURIComponent(cursor)}`)

    expect(response.status).toBe(400)
    expect(mocks.listVersions).not.toHaveBeenCalled()
  })

  /**
   * The regression guard for the binding: a list still pages through its OWN
   * cursor. A token that no route accepts binds nothing — it just breaks
   * pagination.
   */
  it('resumes from the cursor it minted', async () => {
    const cursor = await mintCursor('workflow-1')
    mocks.listVersions.mockClear()

    const response = await listVersions('workflow-1', `?cursor=${encodeURIComponent(cursor)}`)

    expect(response.status).toBe(200)
    expect(mocks.listVersions).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ afterVersion: 5 }) })
    )
  })

  /**
   * A `version` is an ordinal every workflow's history numbers from 1, so an
   * unbound token from a sibling workflow decoded cleanly and resumed from a
   * position in a history the caller never walked — silently skipping versions.
   */
  it('refuses a cursor minted on another workflow', async () => {
    const cursor = await mintCursor('workflow-1')
    mocks.listVersions.mockClear()

    const response = await listVersions('workflow-2', `?cursor=${encodeURIComponent(cursor)}`)

    expect(response.status).toBe(400)
    expect((await response.json()).error.message).toBe(REFILTERED_CURSOR_MESSAGE)
    expect(mocks.listVersions).not.toHaveBeenCalled()
  })

  it('mints a cursor bound to the workflow that answered', async () => {
    expect(await mintCursor('workflow-1')).not.toBe(await mintCursor('workflow-2'))
  })

  it('rejects an unauthenticated request', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await GET(
      new NextRequest('http://localhost/api/v2/workflows/workflow-1/versions?limit=10'),
      context
    )

    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('UNAUTHORIZED')
  })
})
