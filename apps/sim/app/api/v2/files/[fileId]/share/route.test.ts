/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks, MockV2ApiKeyUnauthenticatedError } = vi.hoisted(() => {
  class MockV2ApiKeyUnauthenticatedError extends Error {
    constructor(message = 'Invalid API key') {
      super(message)
      this.name = 'V2ApiKeyUnauthenticatedError'
    }
  }

  return {
    mocks: {
      authenticate: vi.fn(),
      preauthRate: vi.fn(),
      operationRate: vi.fn(),
      gate: vi.fn(),
      getShare: vi.fn(),
      updateShare: vi.fn(),
    },
    MockV2ApiKeyUnauthenticatedError,
  }
})

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => ({
  authenticateV2ApiKey: mocks.authenticate,
  V2ApiKeyUnauthenticatedError: MockV2ApiKeyUnauthenticatedError,
}))

vi.mock('@/lib/core/rate-limiter', () => ({
  RateLimiter: class {
    checkRateLimitDirect = mocks.preauthRate
    checkRateLimitDirectOrThrow = mocks.operationRate
  },
  getRateLimit: vi.fn().mockReturnValue({
    maxTokens: 100,
    refillRate: 100,
    refillIntervalMs: 60_000,
  }),
}))

vi.mock('@/lib/api/server/rate-limit-context', () => ({
  recordRateLimitSnapshot: vi.fn(),
  getRateLimitHeaders: vi.fn().mockReturnValue(null),
}))

vi.mock('@/lib/core/utils/request', () => ({
  generateRequestId: vi.fn().mockReturnValue('request-1'),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}))

vi.mock('@/app/api/v2/lib/gate', () => ({ v2ApiGateError: mocks.gate }))

vi.mock('@/lib/workspace-files/application/share-workspace-file', () => ({
  getWorkspaceFileShare: {
    operation: { id: 'files.share.read', minimumRole: 'read', workspaceApiKey: 'allow' },
    execute: mocks.getShare,
  },
  updateWorkspaceFileShare: {
    operation: { id: 'files.share.update', minimumRole: 'write', workspaceApiKey: 'allow' },
    execute: mocks.updateShare,
  },
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { GET, PATCH } from '@/app/api/v2/files/[fileId]/share/route'

const WORKSPACE_ID = 'workspace-1'
const FILE_ID = 'wf_1'
const PRINCIPAL = { kind: 'workspace_api_key' as const, workspaceId: WORKSPACE_ID, keyId: 'key-1' }
const AUTH = {
  principal: PRINCIPAL,
  rolloutUserId: 'owner-1',
  rateLimitSubjectIds: ['workspace:workspace-1'] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
const RATE_LIMIT_OK = {
  allowed: true,
  limit: 100,
  remaining: 99,
  resetAt: new Date('2024-01-01T01:00:00Z'),
  retryAfterMs: 0,
}
const SHARE = {
  id: 'shr_1',
  token: 'existing-token-abcd',
  url: 'https://www.sim.ai/f/existing-token-abcd',
  isActive: true,
  resourceType: 'file' as const,
  resourceId: FILE_ID,
  authType: 'public' as const,
  hasPassword: false,
  allowedEmails: [] as string[],
}
const context = { params: Promise.resolve({ fileId: FILE_ID }) }

function callGet(query = `workspaceId=${WORKSPACE_ID}`) {
  return GET(
    new NextRequest(`http://localhost:3000/api/v2/files/${FILE_ID}/share?${query}`, {
      headers: { 'x-api-key': 'key' },
    }),
    context
  )
}

function callPatch(body: unknown) {
  return PATCH(
    new NextRequest(`http://localhost:3000/api/v2/files/${FILE_ID}/share`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'key' },
      body: JSON.stringify(body),
    }),
    context
  )
}

describe('GET /api/v2/files/[fileId]/share', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticate.mockResolvedValue(AUTH)
    mocks.preauthRate.mockResolvedValue(RATE_LIMIT_OK)
    mocks.operationRate.mockResolvedValue(RATE_LIMIT_OK)
    mocks.gate.mockResolvedValue(null)
    mocks.getShare.mockResolvedValue({ share: SHARE })
  })

  it('authenticates and rate-limits before parsing or executing', async () => {
    mocks.authenticate.mockRejectedValueOnce(
      new MockV2ApiKeyUnauthenticatedError('API key required')
    )

    const response = await callGet()

    expect(response.status).toBe(401)
    expect(mocks.getShare).not.toHaveBeenCalled()
    expect(mocks.operationRate).not.toHaveBeenCalled()
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2Error } = await import('@/app/api/v2/lib/response')
    mocks.gate.mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const response = await callGet()

    expect(response.status).toBe(404)
    expect(mocks.getShare).not.toHaveBeenCalled()
  })

  it('validates the asserted workspace before executing the use case', async () => {
    const response = await callGet('')

    expect(response.status).toBe(400)
    expect(mocks.getShare).not.toHaveBeenCalled()
  })

  it('preserves generic authorization failures as forbidden', async () => {
    mocks.getShare.mockRejectedValueOnce(new OrchestrationError('forbidden', 'Access denied'))

    const response = await callGet()
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.code).toBe('FORBIDDEN')
    expect(mocks.getShare).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: { fileId: FILE_ID, assertedWorkspaceId: WORKSPACE_ID },
      request: expect.anything(),
    })
  })

  it('returns the share through the v2 envelope', async () => {
    const response = await callGet()

    expect(response.status).toBe(200)
    expect((await response.json()).data).toEqual(SHARE)
  })

  it('returns the rate-limit response when denied', async () => {
    mocks.operationRate.mockResolvedValueOnce({ ...RATE_LIMIT_OK, allowed: false, remaining: 0 })

    const response = await callGet()

    expect(response.status).toBe(429)
    expect((await response.json()).error.code).toBe('RATE_LIMITED')
    expect(mocks.getShare).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/v2/files/[fileId]/share', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticate.mockResolvedValue(AUTH)
    mocks.preauthRate.mockResolvedValue(RATE_LIMIT_OK)
    mocks.operationRate.mockResolvedValue(RATE_LIMIT_OK)
    mocks.gate.mockResolvedValue(null)
    mocks.updateShare.mockResolvedValue({ share: SHARE })
  })

  it('rejects a caller-supplied token at the v2 boundary', async () => {
    const response = await callPatch({
      workspaceId: WORKSPACE_ID,
      isActive: true,
      token: 'attacker-chosen-token',
    })

    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('BAD_REQUEST')
    expect(mocks.updateShare).not.toHaveBeenCalled()
  })

  it('renders typed validation failures in the v2 envelope', async () => {
    mocks.updateShare.mockRejectedValueOnce(
      new OrchestrationError('validation', 'Password is required for password-protected shares')
    )

    const response = await callPatch({ workspaceId: WORKSPACE_ID, isActive: true })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toEqual({
      code: 'BAD_REQUEST',
      message: 'Password is required for password-protected shares',
    })
  })

  it('passes the shared principal and canonical workspace assertion to the use case', async () => {
    const response = await callPatch({
      workspaceId: WORKSPACE_ID,
      isActive: true,
      authType: 'password',
      password: 'hunter2hunter2',
    })

    expect(response.status).toBe(200)
    expect((await response.json()).data).toEqual(SHARE)
    expect(mocks.updateShare).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        fileId: FILE_ID,
        assertedWorkspaceId: WORKSPACE_ID,
        isActive: true,
        authType: 'password',
        password: 'hunter2hunter2',
        allowedEmails: undefined,
      },
      request: expect.anything(),
    })
  })

  it('preserves generic forbidden updates as forbidden', async () => {
    mocks.updateShare.mockRejectedValueOnce(new OrchestrationError('forbidden', 'Access denied'))

    const response = await callPatch({ workspaceId: WORKSPACE_ID, isActive: true })

    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe('FORBIDDEN')
  })

  it('returns the rate-limit response when denied', async () => {
    mocks.operationRate.mockResolvedValueOnce({ ...RATE_LIMIT_OK, allowed: false, remaining: 0 })

    const response = await callPatch({ workspaceId: WORKSPACE_ID, isActive: true })

    expect(response.status).toBe(429)
    expect((await response.json()).error.code).toBe('RATE_LIMITED')
    expect(mocks.updateShare).not.toHaveBeenCalled()
  })
})
