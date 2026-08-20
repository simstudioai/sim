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
  list: vi.fn(),
  create: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/app/api/v2/lib/gate', () => v2GateModuleMock)

vi.mock('@/lib/credentials/application/list-workspace-credentials', () => ({
  listWorkspaceCredentials: {
    operation: { id: 'credentials.connections.list' },
    execute: mocks.list,
  },
}))

vi.mock('@/lib/credentials/application/service-account', () => ({
  createServiceAccountCredentialUseCase: {
    operation: { id: 'credentials.service_accounts.create' },
    execute: mocks.create,
  },
}))

import { V2_DEFAULT_PAGE_SIZE } from '@/lib/api/contracts/v2/shared'
import { REFILTERED_CURSOR_MESSAGE } from '@/lib/api/cursor-binding'
import { GET, POST } from '@/app/api/v2/credentials/route'

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
    mocks.list.mockResolvedValue({
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
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('calls the application operation with the workspace principal', async () => {
    const request = new NextRequest(
      `http://localhost:3000/api/v2/credentials?workspaceId=${WORKSPACE_ID}&type=service_account`
    )
    const response = await GET(request)

    expect(response.status).toBe(200)
    expect(mocks.list).toHaveBeenCalledWith({
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
    mocks.list.mockResolvedValue({
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

    mocks.list.mockClear()
    const replayed = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/credentials?workspaceId=${WORKSPACE_ID}&search=slack&cursor=${encodeURIComponent(nextCursor)}`
      )
    )

    expect(replayed.status).toBe(400)
    expect((await replayed.json()).error.message).toBe(REFILTERED_CURSOR_MESSAGE)
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('resumes a cursor replayed under the filters it was minted with', async () => {
    mocks.list.mockResolvedValue({
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

    mocks.list.mockClear()
    const resumed = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/credentials?workspaceId=${WORKSPACE_ID}&search=zoom&cursor=${encodeURIComponent(nextCursor)}`
      )
    )

    expect(resumed.status).toBe(200)
    expect(mocks.list).toHaveBeenCalledWith({
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

  it('hides repository errors that may contain secret details', async () => {
    mocks.list.mockRejectedValueOnce(new Error('encryptedServiceAccountKey failed'))

    const response = await GET(
      new NextRequest(`http://localhost:3000/api/v2/credentials?workspaceId=${WORKSPACE_ID}`)
    )

    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
  })
})

describe('POST /api/v2/credentials', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue({
      ...auth,
      principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
      rolloutUserId: 'user-1',
      keyType: 'personal',
    })
    v2RouteMocks.gate.mockResolvedValue(null)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.create.mockResolvedValue({
      credential: { ...credential, encryptedServiceAccountKey: 'must-not-leak' },
      created: true,
      hasServiceAccountKey: true,
      role: 'admin',
      auditMetadata: {},
    })
  })

  it('creates a verified service-account credential without returning secrets', async () => {
    const request = new NextRequest('http://localhost:3000/api/v2/credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workspaceId: WORKSPACE_ID,
        type: 'service_account',
        providerId: 'zoom-service-account',
        displayName: 'Zoom account',
        credentials: JSON.stringify({
          clientId: 'client-id',
          clientSecret: 'client-secret',
          orgId: 'account-id',
        }),
      }),
    })
    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.data).toMatchObject({
      id: 'credential-1',
      type: 'service_account',
      displayName: 'Zoom account',
      providerId: 'zoom-service-account',
      hasServiceAccountKey: true,
      role: 'admin',
    })
    expect(JSON.stringify(body)).not.toContain('client-secret')
    expect(JSON.stringify(body)).not.toContain('must-not-leak')
    expect(mocks.create).toHaveBeenCalledWith({
      principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
      input: {
        workspaceId: WORKSPACE_ID,
        providerId: 'zoom-service-account',
        displayName: 'Zoom account',
        description: undefined,
        id: undefined,
        serviceAccountJson: undefined,
        apiToken: undefined,
        domain: undefined,
        signingSecret: undefined,
        botToken: undefined,
        clientId: 'client-id',
        clientSecret: 'client-secret',
        orgId: 'account-id',
        dataCenter: undefined,
        authMethod: undefined,
        privateKey: undefined,
        username: undefined,
      },
      request,
    })
  })

  it('rejects an unknown service-account provider before the use case', async () => {
    const response = await POST(
      new NextRequest('http://localhost:3000/api/v2/credentials', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: WORKSPACE_ID,
          type: 'service_account',
          providerId: 'made-up-service-account',
          credentials: JSON.stringify({ serviceAccountJson: '{}' }),
        }),
      })
    )

    expect(response.status).toBe(400)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('rejects flattened provider fields before the use case', async () => {
    const response = await POST(
      new NextRequest('http://localhost:3000/api/v2/credentials', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: WORKSPACE_ID,
          type: 'service_account',
          providerId: 'zoom-service-account',
          clientId: 'client-id',
          clientSecret: 'client-secret',
          orgId: 'account-id',
        }),
      })
    )

    expect(response.status).toBe(400)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it.each([
    ['malformed JSON', '{'],
    ['a JSON array', '[]'],
    ['an unsupported field', JSON.stringify({ extra: 'not-accepted' })],
  ])('rejects credentials containing %s before the use case', async (_label, credentials) => {
    const response = await POST(
      new NextRequest('http://localhost:3000/api/v2/credentials', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: WORKSPACE_ID,
          type: 'service_account',
          providerId: 'zoom-service-account',
          credentials,
        }),
      })
    )

    expect(response.status).toBe(400)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('rejects missing provider fields inside credentials before the use case', async () => {
    const response = await POST(
      new NextRequest('http://localhost:3000/api/v2/credentials', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: WORKSPACE_ID,
          type: 'service_account',
          providerId: 'zoom-service-account',
          credentials: JSON.stringify({ clientId: 'client-id', clientSecret: 'client-secret' }),
        }),
      })
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: {
        code: 'BAD_REQUEST',
        details: [{ path: ['credentials', 'orgId'] }],
      },
    })
    expect(mocks.create).not.toHaveBeenCalled()
  })
})
