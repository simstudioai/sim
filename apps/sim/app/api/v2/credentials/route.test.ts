/**
 * @vitest-environment node
 */
import {
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
  execute: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/app/api/v2/lib/gate', () => v2GateModuleMock)

vi.mock('@/lib/credentials/application/list-workspace-credentials', () => ({
  listWorkspaceCredentials: {
    operation: { id: 'credentials.connections.list' },
    execute: mocks.execute,
  },
}))

import { V2_DEFAULT_PAGE_SIZE } from '@/lib/api/contracts/v2/shared'
import { REFILTERED_CURSOR_MESSAGE } from '@/lib/api/cursor-binding'
import { GET } from '@/app/api/v2/credentials/route'

const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555'
const auth = {
  principal: {
    kind: 'workspace_api_key' as const,
    workspaceId: WORKSPACE_ID,
    keyId: 'key-1',
  },
  rolloutUserId: 'billing-owner-1',
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
const credential = {
  id: 'credential-1',
  workspaceId: WORKSPACE_ID,
  type: 'service_account' as const,
  displayName: 'Zoom account',
  description: null,
  providerId: 'zoom-service-account',
  accountId: null,
  envKey: 'MUST_NOT_LEAK',
  envOwnerUserId: null,
  createdBy: 'user-1',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
  hasServiceAccountKey: true,
  role: 'member' as const,
}

describe('GET /api/v2/credentials', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.gate.mockResolvedValue(null)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.execute.mockResolvedValue({
      credentials: [credential],
      nextCursorKeys: null,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    })
  })

  it('authenticates and charges before validating workspace input', async () => {
    const response = await GET(new NextRequest('http://localhost:3000/api/v2/credentials'))

    expect(response.status).toBe(400)
    expect(v2RouteMocks.authenticate).toHaveBeenCalled()
    expect(v2RouteMocks.operationRate).toHaveBeenCalledTimes(2)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('calls the application operation with the workspace principal', async () => {
    const request = new NextRequest(
      `http://localhost:3000/api/v2/credentials?workspaceId=${WORKSPACE_ID}&type=service_account`
    )
    const response = await GET(request)

    expect(response.status).toBe(200)
    expect(mocks.execute).toHaveBeenCalledWith({
      principal: auth.principal,
      input: {
        workspaceId: WORKSPACE_ID,
        type: 'service_account',
        providerId: undefined,
        search: undefined,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        limit: V2_DEFAULT_PAGE_SIZE,
        cursor: undefined,
        cursorKeys: undefined,
      },
      request,
    })
  })

  /**
   * Pins the binding end-to-end — the mint in `present` and the read in
   * `mapInput` — because the contract-level sweep only checks a hand-maintained
   * map of param names and stays green when a route drops the stamp entirely.
   */
  it('refuses a cursor minted under a different filter', async () => {
    mocks.execute.mockResolvedValue({
      credentials: [credential],
      nextCursorKeys: ['2026-01-01T00:00:00.000Z', 'credential-1'],
      sortBy: 'createdAt',
      sortOrder: 'desc',
    })

    const minted = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/credentials?workspaceId=${WORKSPACE_ID}&search=zoom`
      )
    )
    const { nextCursor } = await minted.json()
    expect(nextCursor).toEqual(expect.any(String))

    mocks.execute.mockClear()
    const replayed = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/credentials?workspaceId=${WORKSPACE_ID}&search=slack&cursor=${encodeURIComponent(nextCursor)}`
      )
    )

    expect(replayed.status).toBe(400)
    expect((await replayed.json()).error.message).toBe(REFILTERED_CURSOR_MESSAGE)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('resumes a cursor replayed under the filters it was minted with', async () => {
    mocks.execute.mockResolvedValue({
      credentials: [credential],
      nextCursorKeys: ['2026-01-01T00:00:00.000Z', 'credential-1'],
      sortBy: 'createdAt',
      sortOrder: 'desc',
    })

    const minted = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/credentials?workspaceId=${WORKSPACE_ID}&search=zoom`
      )
    )
    const { nextCursor } = await minted.json()

    mocks.execute.mockClear()
    const resumed = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/credentials?workspaceId=${WORKSPACE_ID}&search=zoom&cursor=${encodeURIComponent(nextCursor)}`
      )
    )

    expect(resumed.status).toBe(200)
    expect(mocks.execute).toHaveBeenCalledWith({
      principal: auth.principal,
      input: expect.objectContaining({
        search: 'zoom',
        cursorKeys: ['2026-01-01T00:00:00.000Z', 'credential-1'],
      }),
      request: expect.anything(),
    })
  })

  it('projects credential metadata field by field without secret material', async () => {
    const response = await GET(
      new NextRequest(`http://localhost:3000/api/v2/credentials?workspaceId=${WORKSPACE_ID}`)
    )
    const body = await response.json()

    expect(body).toEqual({
      data: [
        {
          id: 'credential-1',
          type: 'service_account',
          displayName: 'Zoom account',
          description: null,
          providerId: 'zoom-service-account',
          accountId: null,
          hasServiceAccountKey: true,
          role: 'member',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
      nextCursor: null,
    })
    expect(JSON.stringify(body)).not.toContain('envKey')
    expect(JSON.stringify(body)).not.toContain('createdBy')
  })

  /**
   * The projection is an explicit field-by-field copy, which is what makes a
   * column added to the credential table later inert here: a field nobody wrote
   * into `toV2Credential` is simply never read. The outbound response `.parse()`
   * strips whatever survives, so a leak needs two independent mistakes. This
   * pins the pairing against a row carrying a column the projection has never
   * heard of.
   */
  it('withholds a credential column the projection was never taught to publish', async () => {
    mocks.execute.mockResolvedValueOnce({
      credentials: [{ ...credential, encryptedFutureSecret: 'MUST_NOT_LEAK_EITHER' }],
      nextCursorKeys: null,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    })

    const response = await GET(
      new NextRequest(`http://localhost:3000/api/v2/credentials?workspaceId=${WORKSPACE_ID}`)
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(JSON.stringify(body)).not.toContain('encryptedFutureSecret')
    expect(JSON.stringify(body)).not.toContain('MUST_NOT_LEAK_EITHER')
  })

  it('hides repository errors that may contain secret details', async () => {
    mocks.execute.mockRejectedValueOnce(new Error('encryptedServiceAccountKey failed'))

    const response = await GET(
      new NextRequest(`http://localhost:3000/api/v2/credentials?workspaceId=${WORKSPACE_ID}`)
    )

    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
  })
})
