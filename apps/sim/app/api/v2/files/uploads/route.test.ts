/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticateV2ApiKey: vi.fn(),
  checkRateLimitDirect: vi.fn(),
  checkRateLimitDirectOrThrow: vi.fn(),
  createUpload: vi.fn(),
  gate: vi.fn(),
}))

vi.mock('@/lib/uploads/upload-session/application', () => ({
  createWorkspaceFileUploadOperation: {
    operation: { id: 'files.upload.create', minimumRole: 'write', workspaceApiKey: 'allow' },
    execute: mocks.createUpload,
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

vi.mock('@/app/api/v2/lib/gate', () => ({ v2ApiGateError: mocks.gate }))

vi.mock('@/app/api/v2/files/uploads/utils', () => ({
  toV2FileUpload: vi.fn(async () => ({
    id: 'upload-1',
    status: 'uploading',
    name: 'file.csv',
    contentType: 'text/csv',
    size: 10,
    expiresAt: '2026-08-04T21:00:00.000Z',
    error: null,
    file: null,
  })),
}))

import { POST } from '@/app/api/v2/files/uploads/route'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'
const PRINCIPAL = {
  kind: 'workspace_api_key' as const,
  workspaceId: WORKSPACE_ID,
  keyId: 'key-1',
}
const AUTH = {
  principal: PRINCIPAL,
  rolloutUserId: 'billing-owner-1',
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
const URL_EXPIRES_AT = '2026-01-01T01:00:00.000Z'
const UPLOAD_SESSION = {
  id: 'upload-1',
  uploadToken: 'signed-upload-token',
  transfer: {
    method: 'put' as const,
    url: 'https://storage.example/upload',
    headers: { 'content-type': 'text/csv' },
    expiresAt: URL_EXPIRES_AT,
  },
}

function request(body: Record<string, unknown>) {
  const request = new NextRequest('http://localhost:3000/api/v2/files/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': 'secret' },
    body: JSON.stringify(body),
  })
  return { request, response: POST(request) }
}

describe('POST /api/v2/files/uploads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticateV2ApiKey.mockResolvedValue(AUTH)
    mocks.gate.mockResolvedValue(null)
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
    mocks.createUpload.mockResolvedValue(UPLOAD_SESSION)
  })

  it('creates a signed upload through the workspace principal pipeline', async () => {
    const call = request({
      workspaceId: WORKSPACE_ID,
      name: 'file.csv',
      contentType: 'text/csv',
      size: 10,
    })
    const response = await call.response

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      data: {
        session: { id: 'upload-1', status: 'uploading', file: null },
        uploadToken: 'signed-upload-token',
        transfer: {
          method: 'put',
          url: 'https://storage.example/upload',
          expiresAt: URL_EXPIRES_AT,
        },
      },
    })
    expect(mocks.createUpload).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        workspaceId: WORKSPACE_ID,
        name: 'file.csv',
        contentType: 'text/csv',
        size: 10,
        folderPath: '/',
      },
      request: call.request,
    })
  })

  it('authenticates and rate limits before request validation', async () => {
    const response = await request({ workspaceId: WORKSPACE_ID }).response

    expect(response.status).toBe(400)
    expect(mocks.authenticateV2ApiKey).toHaveBeenCalledTimes(1)
    expect(mocks.checkRateLimitDirectOrThrow).toHaveBeenCalledTimes(2)
    expect(mocks.createUpload).not.toHaveBeenCalled()
  })

  it('does not run a second creator-based authentication path', async () => {
    await request({
      workspaceId: WORKSPACE_ID,
      name: 'empty.txt',
      contentType: 'text/plain',
      size: 0,
    }).response

    expect(mocks.authenticateV2ApiKey).toHaveBeenCalledTimes(1)
    expect(mocks.createUpload).toHaveBeenCalledWith(
      expect.objectContaining({ principal: PRINCIPAL })
    )
  })
})
