/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readMetadata: vi.fn(),
  authenticateV2ApiKey: vi.fn(),
  checkRateLimitDirect: vi.fn(),
  checkRateLimitDirectOrThrow: vi.fn(),
  getUserEmailsByIds: vi.fn(),
}))

vi.mock('@/lib/workspace-files/application/read-workspace-file-metadata', () => ({
  readWorkspaceFileMetadata: {
    operation: { id: 'files.read_metadata', minimumRole: 'read', workspaceApiKey: 'allow' },
    execute: mocks.readMetadata,
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

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/users/queries', () => ({
  getUserEmailsByIds: mocks.getUserEmailsByIds,
  requireResolvedUserEmail: (emails: Map<string, string>, userId: string) => emails.get(userId)!,
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { GET } from '@/app/api/v2/files/[fileId]/metadata/route'

const WORKSPACE_ID = 'workspace-1'
const FILE_ID = 'wf_1'
const context = { params: Promise.resolve({ fileId: FILE_ID }) }
const auth = {
  principal: { kind: 'workspace_api_key' as const, workspaceId: WORKSPACE_ID, keyId: 'key-1' },
  rolloutUserId: 'billing-owner-1',
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}

function buildRecord() {
  return {
    id: FILE_ID,
    workspaceId: WORKSPACE_ID,
    name: 'data.csv',
    key: 'workspace/ws/1-x-data.csv',
    path: '/api/files/serve/x',
    size: 1024,
    type: 'text/csv',
    uploadedBy: 'user-1',
    folderId: null,
    folderPath: null,
    uploadedAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-02T00:00:00Z'),
  }
}

const callGet = (query: string) =>
  GET(new NextRequest(`http://localhost:3000/api/v2/files/${FILE_ID}/metadata?${query}`), context)

describe('GET /api/v2/files/[fileId]/metadata', () => {
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
    mocks.readMetadata.mockResolvedValue({ file: buildRecord() })
    mocks.getUserEmailsByIds.mockResolvedValue(new Map([['user-1', 'ada@example.com']]))
  })

  it('authenticates and charges before rejecting a missing workspaceId', async () => {
    const response = await callGet('')

    expect(response.status).toBe(400)
    expect(mocks.authenticateV2ApiKey).toHaveBeenCalled()
    expect(mocks.checkRateLimitDirectOrThrow).toHaveBeenCalledTimes(2)
    expect(mocks.readMetadata).not.toHaveBeenCalled()
  })

  it('conceals an authorization failure as not found', async () => {
    mocks.readMetadata.mockRejectedValue(
      new OrchestrationError('forbidden', 'Insufficient workspace permissions')
    )

    const response = await callGet(`workspaceId=${WORKSPACE_ID}`)

    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('NOT_FOUND')
  })

  it('returns the v2 metadata projection through the shared use case', async () => {
    const response = await callGet(`workspaceId=${WORKSPACE_ID}`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        id: FILE_ID,
        name: 'data.csv',
        size: 1024,
        type: 'text/csv',
        key: 'workspace/ws/1-x-data.csv',
        folderPath: '/',
        uploadedByEmail: 'ada@example.com',
        uploadedAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      },
    })
    expect(mocks.readMetadata).toHaveBeenCalledWith({
      principal: auth.principal,
      input: { fileId: FILE_ID, assertedWorkspaceId: WORKSPACE_ID },
      request: expect.anything(),
    })
  })
})
