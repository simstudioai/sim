/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckRateLimit, mockResolveWorkspaceAccess, mockPerformRestore } = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceAccess: vi.fn(),
  mockPerformRestore: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceAccess: mockResolveWorkspaceAccess,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/workspace-files/orchestration', () => ({
  performRestoreWorkspaceFile: mockPerformRestore,
}))

import { POST } from '@/app/api/v2/files/[fileId]/restore/route'

const WS = 'workspace-1'
const FILE_ID = 'wf_1'

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

const callRestore = (body: unknown) =>
  POST(
    new NextRequest(`http://localhost:3000/api/v2/files/${FILE_ID}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ fileId: FILE_ID }) }
  )

describe('POST /api/v2/files/[fileId]/restore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockPerformRestore.mockResolvedValue({ success: true })
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callRestore({ workspaceId: WS })

    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('NOT_FOUND')
    expect(mockPerformRestore).not.toHaveBeenCalled()
  })

  it('400s when workspaceId is missing', async () => {
    const res = await callRestore({})
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
    expect(mockPerformRestore).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied failure in the v2 error envelope', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Access denied',
    })
    const res = await callRestore({ workspaceId: WS })
    expect(res.status).toBe(403)
    expect(mockPerformRestore).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED)
    const res = await callRestore({ workspaceId: WS })
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('restores the file and acknowledges', async () => {
    const res = await callRestore({ workspaceId: WS })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toEqual({ id: FILE_ID, restored: true })
    expect(mockPerformRestore).toHaveBeenCalledWith({
      workspaceId: WS,
      fileId: FILE_ID,
      userId: 'user-1',
    })
  })

  it('maps a not_found errorCode to 404 rather than a blanket 500', async () => {
    mockPerformRestore.mockResolvedValue({
      success: false,
      error: 'File not found',
      errorCode: 'not_found',
    })

    const res = await callRestore({ workspaceId: WS })
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error.code).toBe('NOT_FOUND')
    expect(body.error.message).toBe('File not found')
  })
})
