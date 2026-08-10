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
      updateShare: vi.fn(),
      unshare: vi.fn(),
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
  updateWorkspaceFileShare: {
    operation: { id: 'files.share.update', minimumRole: 'write', workspaceApiKey: 'allow' },
    execute: mocks.updateShare,
  },
  unshareWorkspaceFile: {
    operation: { id: 'files.share.update', minimumRole: 'write', workspaceApiKey: 'allow' },
    execute: mocks.unshare,
  },
}))

import { InsufficientWorkspacePermissionsError } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { DELETE, PUT } from '@/app/api/v2/files/[fileId]/share/route'

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

function callPut(body: unknown) {
  return PUT(
    new NextRequest(`http://localhost:3000/api/v2/files/${FILE_ID}/share`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'key' },
      body: JSON.stringify(body),
    }),
    context
  )
}

function callDelete(query = `workspaceId=${WORKSPACE_ID}`) {
  return DELETE(
    new NextRequest(`http://localhost:3000/api/v2/files/${FILE_ID}/share?${query}`, {
      method: 'DELETE',
      headers: { 'x-api-key': 'key' },
    }),
    context
  )
}

describe('PUT /api/v2/files/[fileId]/share', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticate.mockResolvedValue(AUTH)
    mocks.preauthRate.mockResolvedValue(RATE_LIMIT_OK)
    mocks.operationRate.mockResolvedValue(RATE_LIMIT_OK)
    mocks.gate.mockResolvedValue(null)
    mocks.updateShare.mockResolvedValue({ share: SHARE })
  })

  it('rejects a caller-supplied token at the v2 boundary', async () => {
    const response = await callPut({
      workspaceId: WORKSPACE_ID,
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

    const response = await callPut({ workspaceId: WORKSPACE_ID })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toEqual({
      code: 'BAD_REQUEST',
      message: 'Password is required for password-protected shares',
    })
  })

  it('passes the shared principal and canonical workspace assertion to the use case', async () => {
    const response = await callPut({
      workspaceId: WORKSPACE_ID,
      authType: 'password',
      password: 'hunter2hunter2',
    })

    expect(response.status).toBe(200)
    expect((await response.json()).data).toEqual({
      sharing: {
        enabled: true,
        url: SHARE.url,
        authType: 'public',
        hasPassword: false,
        allowedEmails: [],
      },
    })
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

  it('conceals forbidden updates as not found', async () => {
    mocks.updateShare.mockRejectedValueOnce(new InsufficientWorkspacePermissionsError())

    const response = await callPut({ workspaceId: WORKSPACE_ID })

    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('NOT_FOUND')
  })

  it('returns the rate-limit response when denied', async () => {
    mocks.operationRate.mockResolvedValueOnce({ ...RATE_LIMIT_OK, allowed: false, remaining: 0 })

    const response = await callPut({ workspaceId: WORKSPACE_ID })

    expect(response.status).toBe(429)
    expect((await response.json()).error.code).toBe('RATE_LIMITED')
    expect(mocks.updateShare).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/v2/files/[fileId]/share', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticate.mockResolvedValue(AUTH)
    mocks.preauthRate.mockResolvedValue(RATE_LIMIT_OK)
    mocks.operationRate.mockResolvedValue(RATE_LIMIT_OK)
    mocks.gate.mockResolvedValue(null)
    mocks.unshare.mockResolvedValue({ share: { ...SHARE, isActive: false }, changed: true })
  })

  it('disables sharing through the canonical workspace assertion', async () => {
    const response = await callDelete()

    expect(response.status).toBe(200)
    expect((await response.json()).data).toEqual({ sharing: { enabled: false } })
    expect(mocks.unshare).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: { fileId: FILE_ID, assertedWorkspaceId: WORKSPACE_ID },
      request: expect.anything(),
    })
  })

  it('validates the workspace before executing', async () => {
    const response = await callDelete('')

    expect(response.status).toBe(400)
    expect(mocks.unshare).not.toHaveBeenCalled()
  })

  it('returns disabled when the file was already unshared', async () => {
    mocks.unshare.mockResolvedValueOnce({ share: null, changed: false })

    const response = await callDelete()

    expect(response.status).toBe(200)
    expect((await response.json()).data.sharing).toEqual({ enabled: false })
  })
})
