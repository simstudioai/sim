/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckRateLimit, mockResolveWorkspaceAccess, mockPerformMove } = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceAccess: vi.fn(),
  mockPerformMove: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceAccess: mockResolveWorkspaceAccess,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/workspace-files/orchestration', () => ({
  performMoveWorkspaceFileItems: mockPerformMove,
}))

import { POST } from '@/app/api/v2/files/move/route'

const WS = 'workspace-1'

const RATE_LIMIT_OK = {
  allowed: true,
  userId: 'user-1',
  keyType: 'workspace',
  limit: 100,
  remaining: 99,
  resetAt: new Date('2024-01-01T01:00:00Z'),
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  )

describe('POST /api/v2/files/move', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockPerformMove.mockResolvedValue({ success: true, movedItems: { files: 2, folders: 0 } })
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callMove({ workspaceId: WS, fileIds: ['wf_1'] })

    expect(res.status).toBe(404)
    expect(mockPerformMove).not.toHaveBeenCalled()
  })

  it('400s when the selection is empty', async () => {
    const res = await callMove({ workspaceId: WS })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
    expect(mockPerformMove).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied failure in the v2 error envelope', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Access denied',
    })
    const res = await callMove({ workspaceId: WS, fileIds: ['wf_1'] })
    expect(res.status).toBe(403)
    expect(mockPerformMove).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED)
    const res = await callMove({ workspaceId: WS, fileIds: ['wf_1'] })
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('moves the selection into the target folder', async () => {
    const res = await callMove({
      workspaceId: WS,
      fileIds: ['wf_1', 'wf_2'],
      targetFolderId: 'fold_1',
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toEqual({ movedItems: { files: 2, folders: 0 } })
    expect(mockPerformMove).toHaveBeenCalledWith({
      workspaceId: WS,
      userId: 'user-1',
      fileIds: ['wf_1', 'wf_2'],
      folderIds: [],
      targetFolderId: 'fold_1',
    })
  })

  it('treats an omitted targetFolderId as the workspace root', async () => {
    await callMove({ workspaceId: WS, folderIds: ['fold_2'] })
    expect(mockPerformMove).toHaveBeenCalledWith(
      expect.objectContaining({ folderIds: ['fold_2'], targetFolderId: null })
    )
  })

  it('maps a conflict errorCode to 409 without partially applying', async () => {
    mockPerformMove.mockResolvedValue({
      success: false,
      error: 'A file named "data.csv" already exists in the destination folder',
      errorCode: 'conflict',
    })

    const res = await callMove({ workspaceId: WS, fileIds: ['wf_1'], targetFolderId: 'fold_1' })
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.error.code).toBe('CONFLICT')
  })
})
