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

const { mockExecute } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/app/api/v2/lib/gate', () => v2GateModuleMock)
vi.mock('@/lib/api/server/rate-limit-context', () => ({
  recordRateLimitSnapshot: vi.fn(),
  getRateLimitHeaders: vi.fn().mockReturnValue(null),
}))
vi.mock('@/lib/core/utils/request', () => ({
  generateRequestId: vi.fn().mockReturnValue('request-1'),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}))
vi.mock('@/lib/workspace-files/application/move-workspace-file-items', () => ({
  moveWorkspaceFileItemsOperation: {
    operation: { id: 'files.move', minimumRole: 'write', workspaceApiKey: 'allow' },
    execute: mockExecute,
  },
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { WorkspaceFileMoveConflictError } from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import { POST } from '@/app/api/v2/files/move/route'
import { v2Error } from '@/app/api/v2/lib/response'

const WS = 'workspace-1'
const auth = {
  principal: { kind: 'workspace_api_key' as const, workspaceId: WS, keyId: 'key-1' },
  rolloutUserId: 'owner-1',
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WS}`] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
const RATE_LIMIT_DENIED = {
  allowed: false,
  limit: 100,
  remaining: 0,
  resetAt: new Date('2024-01-01T01:00:00Z'),
  retryAfterMs: 1000,
}

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
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.gate.mockResolvedValue(null)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mockExecute.mockResolvedValue({ movedItems: { files: 2, folders: 0 } })
  })

  it('rejects an unauthenticated request', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())
    const res = await callMove({ workspaceId: WS, fileIds: ['wf_1'] })
    expect(res.status).toBe(401)
    expect((await res.json()).error.code).toBe('UNAUTHORIZED')
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    v2RouteMocks.gate.mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))
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
    mockExecute.mockRejectedValue(new OrchestrationError('forbidden', 'Access denied'))
    const res = await callMove({ workspaceId: WS, fileIds: ['wf_1'] })
    expect(res.status).toBe(403)
    expect(mockExecute).toHaveBeenCalledOnce()
  })

  it('returns the rate-limit response when denied', async () => {
    v2RouteMocks.preauthRate.mockResolvedValue(RATE_LIMIT_DENIED)
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
