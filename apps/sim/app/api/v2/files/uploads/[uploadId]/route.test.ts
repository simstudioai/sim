/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  abort: vi.fn(),
  authenticateV2ApiKey: vi.fn(),
  checkRateLimitDirect: vi.fn(),
  checkRateLimitDirectOrThrow: vi.fn(),
}))

vi.mock('@/lib/uploads/upload-session/application', () => ({
  abortWorkspaceFileUploadOperation: {
    operation: { id: 'files.upload.cancel', minimumRole: 'write', workspaceApiKey: 'allow' },
    execute: mocks.abort,
  },
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => ({
  authenticateV2ApiKey: mocks.authenticateV2ApiKey,
  V2ApiKeyUnauthenticatedError: class V2ApiKeyUnauthenticatedError extends Error {},
}))

vi.mock('@/lib/core/rate-limiter', () => ({
  getRateLimit: () => ({ maxTokens: 100, refillRate: 50, refillIntervalMs: 60_000 }),
  RateLimiter: class RateLimiter {
    checkRateLimitDirect = mocks.checkRateLimitDirect
    checkRateLimitDirectOrThrow = mocks.checkRateLimitDirectOrThrow
  },
}))

vi.mock('@/app/api/v2/lib/gate', () => ({ v2ApiGateError: vi.fn().mockResolvedValue(null) }))

vi.mock('@/app/api/v2/files/uploads/utils', () => ({
  toV2FileUpload: vi.fn(async () => ({
    id: 'upload-1',
    status: 'aborted',
    name: 'file.csv',
    contentType: 'text/csv',
    size: 10,
    expiresAt: '2026-08-04T21:00:00.000Z',
    error: null,
    file: null,
  })),
}))

import {
  InsufficientWorkspacePermissionsError,
  NoWorkspaceAccessError,
  WorkspaceApiKeyAuthorizationError,
} from '@/lib/core/application'
import { DELETE } from '@/app/api/v2/files/uploads/[uploadId]/route'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'
const UPLOAD_ID = 'upload-1'
const context = { params: Promise.resolve({ uploadId: UPLOAD_ID }) }
const AUTH = {
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

function abortRequest() {
  return new NextRequest(
    `http://localhost:3000/api/v2/files/uploads/${UPLOAD_ID}?workspaceId=${WORKSPACE_ID}`,
    { method: 'DELETE', headers: { 'x-api-key': 'secret', 'upload-token': 'signed-token' } }
  )
}

describe('DELETE /api/v2/files/uploads/[uploadId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticateV2ApiKey.mockResolvedValue(AUTH)
    mocks.checkRateLimitDirect.mockResolvedValue({
      allowed: true,
      remaining: 599,
      resetAt: new Date('2026-08-04T21:00:00.000Z'),
    })
    mocks.checkRateLimitDirectOrThrow.mockResolvedValue({
      allowed: true,
      remaining: 99,
      resetAt: new Date('2026-08-04T21:00:00.000Z'),
    })
    mocks.abort.mockResolvedValue({ id: UPLOAD_ID })
  })

  it('aborts through the shared use case', async () => {
    const response = await DELETE(abortRequest(), context)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: { id: UPLOAD_ID, status: 'aborted' } })
  })

  it('conceals a cross-tenant reach as a missing upload session', async () => {
    mocks.abort.mockRejectedValueOnce(new NoWorkspaceAccessError())

    const response = await DELETE(abortRequest(), context)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Upload session not found' },
    })
  })

  /**
   * Only cross-tenant reaches are concealed. A workspace key barred from this
   * operation is a same-workspace policy denial — the caller owns the session
   * and needs to be told why, not handed a misleading 404.
   */
  it('keeps a workspace-key policy denial as a 403', async () => {
    mocks.abort.mockRejectedValueOnce(new WorkspaceApiKeyAuthorizationError())

    const response = await DELETE(abortRequest(), context)

    expect(response.status).toBe(403)
  })

  it('does not conceal a workspace-policy denial behind a not-found', async () => {
    mocks.abort.mockRejectedValueOnce(new InsufficientWorkspacePermissionsError())

    const response = await DELETE(abortRequest(), context)

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: { code: 'FORBIDDEN', message: 'Insufficient workspace permissions' },
    })
  })
})
