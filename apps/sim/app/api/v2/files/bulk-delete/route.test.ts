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

const { mockExecute } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/api/server/rate-limit-context', () => ({
  recordRateLimitSnapshot: vi.fn(),
  getRateLimitHeaders: vi.fn().mockReturnValue(null),
}))
vi.mock('@/lib/core/utils/request', () => ({
  generateRequestId: vi.fn().mockReturnValue('request-1'),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}))
vi.mock('@/lib/workspace-files/application/archive-workspace-file-items', () => ({
  archiveWorkspaceFileItemsOperation: {
    operation: { id: 'files.delete', minimumRole: 'write', workspaceApiKey: 'allow' },
    execute: mockExecute,
  },
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { POST } from '@/app/api/v2/files/bulk-delete/route'

const WS = 'workspace-1'
const AUTH = {
  principal: { kind: 'workspace_api_key' as const, workspaceId: WS, keyId: 'key-1' },
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WS}`] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
const RATE_LIMIT_DENIED = {
  allowed: false,
  limit: 100,
  remaining: 0,
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
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mockExecute.mockResolvedValue({ deletedItems: { files: 3, folders: 0 } })
  })

  it('400s when the selection is empty', async () => {
    const res = await callDelete({ workspaceId: WS, fileIds: [] })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('surfaces a forbidden collection operation', async () => {
    mockExecute.mockRejectedValue(new OrchestrationError('forbidden', 'Access denied'))
    const res = await callDelete({ workspaceId: WS, fileIds: ['wf_1'] })
    expect(res.status).toBe(403)
  })

  it('returns the rate-limit response when denied', async () => {
    v2RouteMocks.preauthRate.mockResolvedValue(RATE_LIMIT_DENIED)
    const res = await callDelete({ workspaceId: WS, fileIds: ['wf_1'] })
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('rejects an unauthenticated request', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())
    const res = await callDelete({ workspaceId: WS, fileIds: ['wf_1'] })
    expect(res.status).toBe(401)
    expect((await res.json()).error.code).toBe('UNAUTHORIZED')
    expect(mockExecute).not.toHaveBeenCalled()
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
    mockExecute.mockRejectedValue(new OrchestrationError('not_found', 'File not found'))
    const res = await callDelete({ workspaceId: WS, fileIds: ['wf_missing'] })
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('NOT_FOUND')
  })
})
