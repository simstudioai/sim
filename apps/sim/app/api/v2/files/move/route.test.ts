/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPreauth, mockOperationRate, mockGate, mockExecute } = vi.hoisted(() => ({
  mockPreauth: vi.fn(),
  mockOperationRate: vi.fn(),
  mockGate: vi.fn(),
  mockExecute: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => ({
  authenticateV2ApiKey: vi.fn().mockResolvedValue({
    principal: { kind: 'workspace_api_key', workspaceId: 'workspace-1', keyId: 'key-1' },
    rolloutUserId: 'owner-1',
    rateLimitSubjectIds: ['workspace:workspace-1'],
    rateLimitSubscription: null,
    keyType: 'workspace',
  }),
  V2ApiKeyUnauthenticatedError: class V2ApiKeyUnauthenticatedError extends Error {},
}))
vi.mock('@/lib/core/rate-limiter', () => ({
  RateLimiter: class {
    checkRateLimitDirect = mockPreauth
    checkRateLimitDirectOrThrow = mockOperationRate
  },
  getRateLimit: vi
    .fn()
    .mockReturnValue({ maxTokens: 100, refillRate: 100, refillIntervalMs: 60_000 }),
}))
vi.mock('@/lib/api/server/rate-limit-context', () => ({
  recordRateLimitSnapshot: vi.fn(),
  getRateLimitHeaders: vi.fn().mockReturnValue(null),
}))
vi.mock('@/lib/core/utils/request', () => ({
  generateRequestId: vi.fn().mockReturnValue('request-1'),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}))
vi.mock('@/app/api/v2/lib/gate', () => ({ v2ApiGateError: mockGate }))
vi.mock('@/lib/workspace-files/application/move-workspace-file-items', () => ({
  moveWorkspaceFileItemsOperation: {
    operation: { id: 'files.move', minimumRole: 'write', workspaceApiKey: 'allow' },
    execute: mockExecute,
  },
}))

import { WorkspaceFileMoveConflictError } from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import { POST } from '@/app/api/v2/files/move/route'

const WS = 'workspace-1'
const RATE_LIMIT_OK = {
  allowed: true,
  limit: 100,
  remaining: 99,
  resetAt: new Date('2024-01-01T01:00:00Z'),
  retryAfterMs: 0,
}
const RATE_LIMIT_DENIED = { ...RATE_LIMIT_OK, allowed: false, remaining: 0, retryAfterMs: 1000 }

const callMove = (body: unknown) =>
  POST(
    new NextRequest('http://localhost:3000/api/v2/files/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'key' },
      body: JSON.stringify(body),
    })
  )

describe('POST /api/v2/files/move', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPreauth.mockResolvedValue(RATE_LIMIT_OK)
    mockOperationRate.mockResolvedValue(RATE_LIMIT_OK)
    mockGate.mockResolvedValue(null)
    mockExecute.mockResolvedValue({ movedItems: { files: 2, folders: 0 } })
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2Error } = await import('@/app/api/v2/lib/response')
    mockGate.mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))
    const res = await callMove({ workspaceId: WS, fileIds: ['wf_1'] })
    expect(res.status).toBe(404)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('400s when the selection is empty', async () => {
    const res = await callMove({ workspaceId: WS })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('surfaces a forbidden collection operation', async () => {
    const { OrchestrationError } = await import('@/lib/core/orchestration/types')
    mockExecute.mockRejectedValue(new OrchestrationError('forbidden', 'Access denied'))
    const res = await callMove({ workspaceId: WS, fileIds: ['wf_1'] })
    expect(res.status).toBe(403)
    expect(mockExecute).toHaveBeenCalledOnce()
  })

  it('returns the rate-limit response when denied', async () => {
    mockPreauth.mockResolvedValue(RATE_LIMIT_DENIED)
    const res = await callMove({ workspaceId: WS, fileIds: ['wf_1'] })
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('moves the selection into the target folder', async () => {
    const res = await callMove({
      workspaceId: WS,
      fileIds: ['wf_1', 'wf_2'],
      targetFolderPath: '/Reports',
    })
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ movedItems: { files: 2 } })
    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { workspaceId: WS, fileIds: ['wf_1', 'wf_2'], targetFolderPath: '/Reports' },
      })
    )
  })

  it('treats an omitted targetFolderPath as the workspace root', async () => {
    await callMove({ workspaceId: WS, fileIds: ['wf_1'] })
    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ targetFolderPath: '/' }) })
    )
  })

  it('maps a conflict error to 409', async () => {
    mockExecute.mockRejectedValue(new WorkspaceFileMoveConflictError('report.csv'))
    const res = await callMove({ workspaceId: WS, fileIds: ['wf_1'] })
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('CONFLICT')
  })
})
