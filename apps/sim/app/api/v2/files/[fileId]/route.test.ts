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
  download: vi.fn(),
  authorizeDownload: vi.fn(),
  rename: vi.fn(),
  deleteFile: vi.fn(),
  getUserEmailsByIds: vi.fn(),
}))

vi.mock('@/lib/workspace-files/application/download-workspace-file', () => ({
  downloadWorkspaceFileStream: {
    operation: { id: 'files.download', minimumRole: 'read', workspaceApiKey: 'allow' },
    execute: mocks.download,
    authorize: mocks.authorizeDownload,
  },
}))

vi.mock('@/lib/workspace-files/application/rename-workspace-file', () => ({
  renameWorkspaceFile: {
    operation: { id: 'files.rename', minimumRole: 'write', workspaceApiKey: 'allow' },
    execute: mocks.rename,
  },
}))

vi.mock('@/lib/workspace-files/application/delete-workspace-file', () => ({
  deleteWorkspaceFileOperation: {
    operation: { id: 'files.delete', minimumRole: 'write', workspaceApiKey: 'allow' },
    execute: mocks.deleteFile,
  },
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/app/api/v2/lib/gate', () => v2GateModuleMock)

vi.mock('@/lib/users/queries', () => ({
  getUserEmailsByIds: mocks.getUserEmailsByIds,
  requireResolvedUserEmail: (emails: Map<string, string>, userId: string) => emails.get(userId)!,
}))

import {
  InsufficientWorkspacePermissionsError,
  NoWorkspaceAccessError,
} from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { DELETE, GET, PATCH } from '@/app/api/v2/files/[fileId]/route'

const WORKSPACE_ID = 'workspace-1'
const FILE_ID = 'wf_1'
const context = { params: Promise.resolve({ fileId: FILE_ID }) }
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

function headRequest(query: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/v2/files/${FILE_ID}?${query}`, {
    method: 'HEAD',
  })
}

function fileRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: FILE_ID,
    workspaceId: WORKSPACE_ID,
    name: 'data.csv',
    key: 'workspace/ws/1-x-data.csv',
    path: '/api/files/serve/x',
    size: 8,
    type: 'text/csv',
    uploadedBy: 'user-1',
    folderId: null,
    uploadedAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-03T00:00:00Z'),
    ...overrides,
  }
}

describe('v2 single-file routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.gate.mockResolvedValue(null)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.download.mockResolvedValue({
      file: fileRecord(),
      stream: new Blob(['id,name\n']).stream(),
      contentType: 'text/csv',
      contentLength: 'id,name\n'.length,
    })
    mocks.rename.mockResolvedValue({ file: fileRecord({ name: 'renamed.csv' }) })
    mocks.deleteFile.mockResolvedValue({
      id: FILE_ID,
      workspaceId: WORKSPACE_ID,
      deleted: true,
    })
    mocks.getUserEmailsByIds.mockResolvedValue(new Map([['user-1', 'ada@example.com']]))
    mocks.authorizeDownload.mockResolvedValue(undefined)
  })

  /**
   * A download `HEAD` answered before the use case's workspace-scoped file
   * resolution is an existence oracle: any valid API key draws a bodiless 200
   * for a file id whose `GET` answers 404. These pin the probe to the answer the
   * download gives, and to still not auditing one.
   */
  it('answers an authorized HEAD bodiless without auditing a download', async () => {
    const response = await GET(headRequest(`workspaceId=${WORKSPACE_ID}`), context)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.authorizeDownload).toHaveBeenCalledOnce()
  })

  it('does not confirm a file the caller cannot reach', async () => {
    mocks.authorizeDownload.mockRejectedValueOnce(new NoWorkspaceAccessError())

    const response = await GET(headRequest('workspaceId=someone-elses-workspace'), context)

    expect(response.status).toBe(404)
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it('does not confirm a file id that does not exist', async () => {
    mocks.authorizeDownload.mockRejectedValueOnce(
      new OrchestrationError('not_found', 'File not found')
    )

    const response = await GET(headRequest(`workspaceId=${WORKSPACE_ID}`), context)

    expect(response.status).toBe(404)
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it('rejects a HEAD missing the required workspaceId instead of answering 200', async () => {
    const response = await GET(headRequest(''), context)

    expect(response.status).toBe(400)
    expect(mocks.authorizeDownload).not.toHaveBeenCalled()
  })

  it('downloads bytes through the binary adapter with operation rate headers', async () => {
    const response = await GET(
      new NextRequest(`http://localhost:3000/api/v2/files/${FILE_ID}?workspaceId=${WORKSPACE_ID}`),
      context
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/csv')
    expect(response.headers.get('Content-Disposition')).toContain('data.csv')
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('99')
    expect(await response.text()).toBe('id,name\n')
    expect(mocks.download).toHaveBeenCalledWith({
      principal: auth.principal,
      input: { fileId: FILE_ID, assertedWorkspaceId: WORKSPACE_ID },
      request: expect.anything(),
    })
  })

  it('rejects an unauthenticated request', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await GET(
      new NextRequest(`http://localhost:3000/api/v2/files/${FILE_ID}?workspaceId=${WORKSPACE_ID}`),
      context
    )

    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('UNAUTHORIZED')
  })

  it('encodes special characters in the extended download filename', async () => {
    mocks.download.mockResolvedValueOnce({
      file: fileRecord({ name: "it's (final)* café.pdf" }),
      stream: new Blob(['pdf']).stream(),
      contentType: 'application/pdf',
      contentLength: 3,
    })

    const response = await GET(
      new NextRequest(`http://localhost:3000/api/v2/files/${FILE_ID}?workspaceId=${WORKSPACE_ID}`),
      context
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Disposition')).toBe(
      `attachment; filename="it's (final)* caf_.pdf"; filename*=UTF-8''it%27s%20%28final%29%2A%20caf%C3%A9.pdf`
    )
  })

  it('conceals cross-workspace download authorization', async () => {
    mocks.download.mockRejectedValue(new NoWorkspaceAccessError())

    const response = await GET(
      new NextRequest(`http://localhost:3000/api/v2/files/${FILE_ID}?workspaceId=${WORKSPACE_ID}`),
      context
    )

    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('NOT_FOUND')
  })

  it('renames through the shared use case and v2 presenter', async () => {
    const request = new NextRequest(`http://localhost:3000/api/v2/files/${FILE_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: WORKSPACE_ID, name: 'renamed.csv' }),
    })
    const response = await PATCH(request, context)

    expect(response.status).toBe(200)
    expect((await response.json()).data.name).toBe('renamed.csv')
    expect(mocks.rename).toHaveBeenCalledWith({
      principal: auth.principal,
      input: { fileId: FILE_ID, assertedWorkspaceId: WORKSPACE_ID, name: 'renamed.csv' },
      request,
    })
  })

  it('maps rename conflicts and conceals absent workspace access', async () => {
    mocks.rename.mockRejectedValueOnce(new OrchestrationError('conflict', 'Name exists'))
    const conflict = await PATCH(
      new NextRequest(`http://localhost:3000/api/v2/files/${FILE_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: WORKSPACE_ID, name: 'renamed.csv' }),
      }),
      context
    )
    expect(conflict.status).toBe(409)

    mocks.rename.mockRejectedValueOnce(new NoWorkspaceAccessError())
    const concealed = await PATCH(
      new NextRequest(`http://localhost:3000/api/v2/files/${FILE_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: WORKSPACE_ID, name: 'renamed.csv' }),
      }),
      context
    )
    expect(concealed.status).toBe(404)
  })

  it('returns forbidden when the current workspace role cannot rename the file', async () => {
    mocks.rename.mockRejectedValueOnce(new InsufficientWorkspacePermissionsError())
    const response = await PATCH(
      new NextRequest(`http://localhost:3000/api/v2/files/${FILE_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: WORKSPACE_ID, name: 'renamed.csv' }),
      }),
      context
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: {
        code: 'FORBIDDEN',
        message: 'Insufficient workspace permissions',
        details: { code: 'INSUFFICIENT_WORKSPACE_ROLE' },
      },
    })
  })

  it('archives through the same principal and operation pipeline', async () => {
    const request = new NextRequest(
      `http://localhost:3000/api/v2/files/${FILE_ID}?workspaceId=${WORKSPACE_ID}`,
      { method: 'DELETE' }
    )
    const response = await DELETE(request, context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { id: FILE_ID, deleted: true } })
    expect(mocks.deleteFile).toHaveBeenCalledWith({
      principal: auth.principal,
      input: { fileId: FILE_ID, assertedWorkspaceId: WORKSPACE_ID },
      request,
    })
  })
})
