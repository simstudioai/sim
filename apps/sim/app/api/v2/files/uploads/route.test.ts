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

const mocks = vi.hoisted(() => ({
  createUpload: vi.fn(),
}))

vi.mock('@/lib/uploads/upload-session/application', () => ({
  createWorkspaceFileUploadOperation: {
    operation: { id: 'files.upload.create', minimumRole: 'write', workspaceApiKey: 'allow' },
    execute: mocks.createUpload,
  },
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

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
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
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
    expect(v2RouteMocks.authenticate).toHaveBeenCalledTimes(1)
    expect(v2RouteMocks.operationRate).toHaveBeenCalledTimes(2)
    expect(mocks.createUpload).not.toHaveBeenCalled()
  })

  it.each(['secretProvenance', 'workspaceFileSecretProvenance', 'metadata'])(
    'does not accept private source classification through the public %s input',
    async (key) => {
      const response = await request({
        workspaceId: WORKSPACE_ID,
        name: 'file.csv',
        contentType: 'text/csv',
        size: 10,
        [key]: { status: 'exact', entries: [] },
      }).response
      expect(response.status).toBe(400)
      expect(mocks.createUpload).not.toHaveBeenCalled()
    }
  )

  it('rejects an unauthenticated request', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await request({
      workspaceId: WORKSPACE_ID,
      name: 'file.csv',
      contentType: 'text/csv',
      size: 10,
    }).response

    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('UNAUTHORIZED')
    expect(mocks.createUpload).not.toHaveBeenCalled()
  })

  it('does not run a second creator-based authentication path', async () => {
    await request({
      workspaceId: WORKSPACE_ID,
      name: 'empty.txt',
      contentType: 'text/plain',
      size: 0,
    }).response

    expect(v2RouteMocks.authenticate).toHaveBeenCalledTimes(1)
    expect(mocks.createUpload).toHaveBeenCalledWith(
      expect.objectContaining({ principal: PRINCIPAL })
    )
  })
})
