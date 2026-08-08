/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  describeFile: vi.fn(),
  rename: vi.fn(),
  deleteFile: vi.fn(),
  authenticateV2ApiKey: vi.fn(),
  checkRateLimitDirect: vi.fn(),
  checkRateLimitDirectOrThrow: vi.fn(),
  getUserEmailsByIds: vi.fn(),
}))

vi.mock('@/lib/workspace-files/application/describe-workspace-file', () => ({
  describeWorkspaceFile: {
    operation: { id: 'files.read_metadata', minimumRole: 'read', workspaceApiKey: 'allow' },
    execute: mocks.describeFile,
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

vi.mock('@/lib/users/queries', () => ({
  getUserEmailsByIds: mocks.getUserEmailsByIds,
  requireResolvedUserEmail: (emails: Map<string, string>, userId: string) => emails.get(userId)!,
}))

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

const SHARE = {
  id: 'shr_1',
  token: 'existing-token-abcd',
  url: 'https://www.sim.ai/f/existing-token-abcd',
  isActive: true,
  resourceType: 'file' as const,
  resourceId: FILE_ID,
  authType: 'email' as const,
  hasPassword: false,
  allowedEmails: ['ada@example.com'],
}

describe('v2 single-file routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticateV2ApiKey.mockResolvedValue(auth)
    mocks.checkRateLimitDirect.mockResolvedValue({
      allowed: true,
      remaining: 599,
      resetAt: new Date('2024-01-01T01:00:00Z'),
    })
    mocks.checkRateLimitDirectOrThrow.mockResolvedValue({
      allowed: true,
      remaining: 99,
      resetAt: new Date('2024-01-01T01:00:00Z'),
    })
    mocks.describeFile.mockResolvedValue({ file: fileRecord(), share: SHARE })
    mocks.rename.mockResolvedValue({ file: fileRecord({ name: 'renamed.csv' }) })
    mocks.deleteFile.mockResolvedValue({
      id: FILE_ID,
      workspaceId: WORKSPACE_ID,
      deleted: true,
    })
    mocks.getUserEmailsByIds.mockResolvedValue(new Map([['user-1', 'ada@example.com']]))
  })

  it('describes the file and its sharing state', async () => {
    const response = await GET(
      new NextRequest(`http://localhost:3000/api/v2/files/${FILE_ID}?workspaceId=${WORKSPACE_ID}`),
      context
    )

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
        sharing: {
          enabled: true,
          url: SHARE.url,
          authType: 'email',
          hasPassword: false,
          allowedEmails: ['ada@example.com'],
        },
      },
    })
    expect(mocks.describeFile).toHaveBeenCalledWith({
      principal: auth.principal,
      input: { fileId: FILE_ID, assertedWorkspaceId: WORKSPACE_ID },
      request: expect.anything(),
    })
  })

  it('returns an explicit disabled sharing state', async () => {
    mocks.describeFile.mockResolvedValueOnce({ file: fileRecord(), share: null })

    const response = await GET(
      new NextRequest(`http://localhost:3000/api/v2/files/${FILE_ID}?workspaceId=${WORKSPACE_ID}`),
      context
    )

    expect((await response.json()).data.sharing).toEqual({ enabled: false })
  })

  it('conceals description authorization failures', async () => {
    mocks.describeFile.mockRejectedValue(
      new OrchestrationError('forbidden', 'Insufficient workspace permissions')
    )

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

  it('maps rename conflicts and conceals authorization failures', async () => {
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

    mocks.rename.mockRejectedValueOnce(
      new OrchestrationError('forbidden', 'Insufficient workspace permissions')
    )
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
