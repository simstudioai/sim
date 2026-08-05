/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckRateLimit, mockResolveWorkspaceAccess, mockPerformDelete } = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceAccess: vi.fn(),
  mockPerformDelete: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceAccess: mockResolveWorkspaceAccess,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/workspace-files/orchestration', () => ({
  performDeleteWorkspaceFileItems: mockPerformDelete,
}))

import { POST } from '@/app/api/v2/files/bulk-delete/route'

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

const callDelete = (body: unknown) =>
  POST(
    new NextRequest('http://localhost:3000/api/v2/files/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  )

describe('POST /api/v2/files/bulk-delete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockPerformDelete.mockResolvedValue({ success: true, deletedItems: { files: 3, folders: 1 } })
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callDelete({ workspaceId: WS, fileIds: ['wf_1'] })

    expect(res.status).toBe(404)
    expect(mockPerformDelete).not.toHaveBeenCalled()
  })

  it('400s when the selection is empty', async () => {
    const res = await callDelete({ workspaceId: WS, fileIds: [] })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
    expect(mockPerformDelete).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied failure in the v2 error envelope', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Access denied',
    })
    const res = await callDelete({ workspaceId: WS, fileIds: ['wf_1'] })
    expect(res.status).toBe(403)
    expect(mockPerformDelete).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED)
    const res = await callDelete({ workspaceId: WS, fileIds: ['wf_1'] })
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('deletes the selection and reports the file count', async () => {
    const res = await callDelete({ workspaceId: WS, fileIds: ['wf_1'] })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toEqual({ deletedItems: { files: 3 } })
    expect(mockPerformDelete).toHaveBeenCalledWith({
      workspaceId: WS,
      userId: 'user-1',
      fileIds: ['wf_1'],
      request: expect.anything(),
    })
  })

  it('maps a not_found errorCode to 404', async () => {
    mockPerformDelete.mockResolvedValue({
      success: false,
      error: 'File not found',
      errorCode: 'not_found',
    })

    const res = await callDelete({ workspaceId: WS, fileIds: ['wf_missing'] })

    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('NOT_FOUND')
  })
})
