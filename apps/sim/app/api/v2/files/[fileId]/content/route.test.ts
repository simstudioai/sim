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
  admit: vi.fn(),
  updateContent: vi.fn(),
  getUserEmailsByIds: vi.fn(),
}))

vi.mock('@/lib/workspace-files/orchestration', () => ({
  MAX_WORKSPACE_FILE_INLINE_BODY_BYTES: 70 * 1024 * 1024,
}))

vi.mock('@/lib/workspace-files/application/update-workspace-file-content', () => ({
  admitUpdateWorkspaceFileContent: mocks.admit,
  updateWorkspaceFileContent: {
    operation: { id: 'files.update_content', minimumRole: 'write', workspaceApiKey: 'allow' },
    execute: mocks.updateContent,
  },
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/app/api/v2/lib/gate', () => v2GateModuleMock)

vi.mock('@/lib/users/queries', () => ({
  getUserEmailsByIds: mocks.getUserEmailsByIds,
  requireResolvedUserEmail: (emails: Map<string, string>, userId: string) => emails.get(userId)!,
}))

import { NoWorkspaceAccessError } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { PUT } from '@/app/api/v2/files/[fileId]/content/route'

const WORKSPACE_ID = 'workspace-1'
const FILE_ID = 'wf_1'
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
const record = {
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
}

const callPut = (body: unknown, contentLength?: number) =>
  PUT(
    new NextRequest(`http://localhost:3000/api/v2/files/${FILE_ID}/content`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(contentLength === undefined ? {} : { 'Content-Length': String(contentLength) }),
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ fileId: FILE_ID }) }
  )

describe('PUT /api/v2/files/[fileId]/content', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.gate.mockResolvedValue(null)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.admit.mockResolvedValue(undefined)
    mocks.updateContent.mockResolvedValue({ file: record })
    mocks.getUserEmailsByIds.mockResolvedValue(new Map([['user-1', 'ada@example.com']]))
  })

  it('performs authenticated admission before parsing a large or malformed body', async () => {
    mocks.admit.mockRejectedValue(new NoWorkspaceAccessError())

    const response = await callPut('{not-json')

    expect(response.status).toBe(404)
    expect(mocks.admit).toHaveBeenCalledWith(auth.principal, FILE_ID)
    expect(mocks.updateContent).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated request', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await callPut({ workspaceId: WORKSPACE_ID, content: 'id,name\n' })

    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('UNAUTHORIZED')
  })

  it('validates body fields after admission', async () => {
    const response = await callPut({ workspaceId: WORKSPACE_ID })

    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('BAD_REQUEST')
    expect(mocks.updateContent).not.toHaveBeenCalled()
  })

  it('returns an oversized body in the canonical v2 envelope', async () => {
    const response = await callPut({ workspaceId: WORKSPACE_ID, content: '' }, 70 * 1024 * 1024 + 1)

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' },
    })
    expect(mocks.admit).toHaveBeenCalled()
    expect(mocks.updateContent).not.toHaveBeenCalled()
  })

  it('replaces content through the shared use case and returns the v2 projection', async () => {
    const request = new NextRequest(`http://localhost:3000/api/v2/files/${FILE_ID}/content`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: WORKSPACE_ID, content: 'id,name\n' }),
    })
    const response = await PUT(request, { params: Promise.resolve({ fileId: FILE_ID }) })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        id: FILE_ID,
        name: 'data.csv',
        size: 8,
        type: 'text/csv',
        key: 'workspace/ws/1-x-data.csv',
        folderPath: '/',
        uploadedByEmail: 'ada@example.com',
        uploadedAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-03T00:00:00.000Z',
        deletedAt: null,
      },
    })
    expect(mocks.updateContent).toHaveBeenCalledWith({
      principal: auth.principal,
      input: {
        fileId: FILE_ID,
        assertedWorkspaceId: WORKSPACE_ID,
        content: 'id,name\n',
        encoding: 'utf-8',
      },
      request,
    })
    expect(v2RouteMocks.operationRate).toHaveBeenCalledWith(
      'v2:files.update_content:api-key:key-1',
      expect.anything()
    )
  })

  it('maps typed quota failures to 413', async () => {
    mocks.updateContent.mockRejectedValue(
      new OrchestrationError('payload_too_large', 'Storage limit exceeded')
    )

    const response = await callPut({ workspaceId: WORKSPACE_ID, content: 'id,name\n' })

    expect(response.status).toBe(413)
    expect((await response.json()).error.code).toBe('PAYLOAD_TOO_LARGE')
  })
})
