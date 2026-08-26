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
  abort: vi.fn(),
  read: vi.fn(),
}))

vi.mock('@/lib/uploads/upload-session/application', () => ({
  abortWorkspaceFileUploadOperation: {
    operation: { id: 'files.upload.cancel', minimumRole: 'write', workspaceApiKey: 'allow' },
    execute: mocks.abort,
  },
  readWorkspaceFileUploadOperation: {
    operation: { id: 'files.upload.read', minimumRole: 'read', workspaceApiKey: 'allow' },
    execute: mocks.read,
  },
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

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
import { DELETE, GET } from '@/app/api/v2/files/uploads/[uploadId]/route'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'
const UPLOAD_ID = 'upload-1'
const context = { params: Promise.resolve({ uploadId: UPLOAD_ID }) }
const AUTH = {
  principal: {
    kind: 'workspace_api_key' as const,
    workspaceId: WORKSPACE_ID,
    keyId: 'key-1',
  },
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

function readRequest(headers: Record<string, string> = { 'upload-token': 'signed-token' }) {
  return new NextRequest(
    `http://localhost:3000/api/v2/files/uploads/${UPLOAD_ID}?workspaceId=${WORKSPACE_ID}`,
    { headers: { 'x-api-key': 'secret', ...headers } }
  )
}

describe('GET /api/v2/files/uploads/[uploadId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.read.mockResolvedValue({ id: UPLOAD_ID })
  })

  it('reads the session through the shared use case', async () => {
    const response = await GET(readRequest(), context)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: { id: UPLOAD_ID } })
    expect(mocks.abort).not.toHaveBeenCalled()
  })

  /**
   * The read must never travel on the cancel operation: a caller allowed to ask
   * about a session must not thereby be allowed to destroy it.
   */
  it('runs on the read operation, not the cancel operation', async () => {
    await GET(readRequest(), context)

    expect(v2RouteMocks.operationRate).toHaveBeenCalledWith(
      expect.stringContaining('files.upload.read'),
      expect.anything()
    )
    expect(v2RouteMocks.operationRate).not.toHaveBeenCalledWith(
      expect.stringContaining('files.upload.cancel'),
      expect.anything()
    )
  })

  /** The GET is a control leg, so it carries the signed token like the others. */
  it('forwards the signed upload token to the use case', async () => {
    await GET(readRequest(), context)

    expect(mocks.read).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          uploadId: UPLOAD_ID,
          workspaceId: WORKSPACE_ID,
          uploadToken: 'signed-token',
        },
      })
    )
  })

  it('rejects a read missing the signed upload token', async () => {
    const response = await GET(readRequest({}), context)

    expect(response.status).toBe(400)
    expect(mocks.read).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated request', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await GET(readRequest(), context)

    expect(response.status).toBe(401)
    expect(mocks.read).not.toHaveBeenCalled()
  })

  it('conceals a cross-tenant reach as a missing upload session', async () => {
    mocks.read.mockRejectedValueOnce(new NoWorkspaceAccessError())

    const response = await GET(readRequest(), context)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Upload session not found' },
    })
  })

  it('keeps a workspace-key policy denial as a 403', async () => {
    mocks.read.mockRejectedValueOnce(new WorkspaceApiKeyAuthorizationError())

    const response = await GET(readRequest(), context)

    expect(response.status).toBe(403)
  })
})

describe('DELETE /api/v2/files/uploads/[uploadId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.abort.mockResolvedValue({ id: UPLOAD_ID })
  })

  it('aborts through the shared use case', async () => {
    const response = await DELETE(abortRequest(), context)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: { id: UPLOAD_ID, status: 'aborted' } })
  })

  it('rejects an unauthenticated request', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await DELETE(abortRequest(), context)

    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('UNAUTHORIZED')
    expect(mocks.abort).not.toHaveBeenCalled()
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
      error: {
        code: 'FORBIDDEN',
        message: 'Insufficient workspace permissions',
        details: { code: 'INSUFFICIENT_WORKSPACE_ROLE' },
      },
    })
  })
})
