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
vi.mock('@/lib/workspace-files/application/archive-workspace-file-items', () => ({
  archiveWorkspaceFileItemsOperation: {
    operation: { id: 'files.delete', minimumRole: 'write', workspaceApiKey: 'allow' },
    execute: mockExecute,
  },
}))

import { POST } from '@/app/api/v2/files/bulk-delete/route'

const WS = 'workspace-1'
const RATE_LIMIT_OK = {
  allowed: true,
  limit: 100,
  remaining: 99,
  resetAt: new Date('2024-01-01T01:00:00Z'),
  retryAfterMs: 0,
}

const callDelete = (body: unknown) =>
  POST(
    new NextRequest('http://localhost:3000/api/v2/files/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'key' },
      body: JSON.stringify(body),
    })
  )

describe('POST /api/v2/files/bulk-delete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPreauth.mockResolvedValue(RATE_LIMIT_OK)
    mockOperationRate.mockResolvedValue(RATE_LIMIT_OK)
    mockGate.mockResolvedValue(null)
    mockExecute.mockResolvedValue({ deletedItems: { files: 3, folders: 0 } })
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2Error } = await import('@/app/api/v2/lib/response')
    mockGate.mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))
    const res = await callDelete({ workspaceId: WS, fileIds: ['wf_1'] })
    expect(res.status).toBe(404)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('400s when the selection is empty', async () => {
    const res = await callDelete({ workspaceId: WS, fileIds: [] })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('surfaces a forbidden collection operation', async () => {
    const { OrchestrationError } = await import('@/lib/core/orchestration/types')
    mockExecute.mockRejectedValue(new OrchestrationError('forbidden', 'Access denied'))
    const res = await callDelete({ workspaceId: WS, fileIds: ['wf_1'] })
    expect(res.status).toBe(403)
  })

  it('returns the rate-limit response when denied', async () => {
    mockPreauth.mockResolvedValue({ ...RATE_LIMIT_OK, allowed: false, remaining: 0 })
    const res = await callDelete({ workspaceId: WS, fileIds: ['wf_1'] })
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('deletes the selection and reports the file count', async () => {
    const res = await callDelete({ workspaceId: WS, fileIds: ['wf_1'] })
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ deletedItems: { files: 3 } })
    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({ input: { workspaceId: WS, fileIds: ['wf_1'] } })
    )
  })

  it('maps a not-found failure to 404', async () => {
    const { OrchestrationError } = await import('@/lib/core/orchestration/types')
    mockExecute.mockRejectedValue(new OrchestrationError('not_found', 'File not found'))
    const res = await callDelete({ workspaceId: WS, fileIds: ['wf_missing'] })
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('NOT_FOUND')
  })
})
