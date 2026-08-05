/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckRateLimit, mockResolveWorkspaceAccess, mockPerformUpdateContent } = vi.hoisted(
  () => ({
    mockCheckRateLimit: vi.fn(),
    mockResolveWorkspaceAccess: vi.fn(),
    mockPerformUpdateContent: vi.fn(),
  })
)

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceAccess: mockResolveWorkspaceAccess,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/workspace-files/orchestration', () => ({
  MAX_WORKSPACE_FILE_INLINE_BODY_BYTES: 70 * 1024 * 1024,
  performUpdateWorkspaceFileContent: mockPerformUpdateContent,
}))

import { PUT } from '@/app/api/v2/files/[fileId]/content/route'

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

const RECORD = {
  id: FILE_ID,
  workspaceId: WS,
  name: 'data.csv',
  key: 'workspace/ws/1-x-data.csv',
  path: '/api/files/serve/x',
  size: 8,
  type: 'text/csv',
  uploadedBy: 'user-1',
  folderId: null,
  folderPath: null,
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
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    mockPerformUpdateContent.mockResolvedValue({ success: true, file: RECORD })
  })

  it('returns 404 when the v2 API surface flag is off', async () => {
    const { v2ApiGateError } = await import('@/app/api/v2/lib/gate')
    const { v2Error } = await import('@/app/api/v2/lib/response')
    vi.mocked(v2ApiGateError).mockResolvedValueOnce(v2Error('NOT_FOUND', 'Not found'))

    const res = await callPut({ workspaceId: WS, content: 'id,name\n' })

    expect(res.status).toBe(404)
    expect(mockPerformUpdateContent).not.toHaveBeenCalled()
  })

  it('400s when content is missing', async () => {
    const res = await callPut({ workspaceId: WS })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
    expect(mockPerformUpdateContent).not.toHaveBeenCalled()
  })

  it('400s on an encoding outside the enum', async () => {
    const res = await callPut({ workspaceId: WS, content: 'x', encoding: 'latin1' })
    expect(res.status).toBe(400)
    expect(mockPerformUpdateContent).not.toHaveBeenCalled()
  })

  it('400s malformed base64 in the v2 error envelope', async () => {
    const res = await callPut({ workspaceId: WS, content: 'not-base64!', encoding: 'base64' })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('BAD_REQUEST')
    expect(body.error.message).toBe('content must be valid base64')
    expect(mockPerformUpdateContent).not.toHaveBeenCalled()
  })

  it('accepts empty base64 as a zero-byte replacement', async () => {
    const res = await callPut({ workspaceId: WS, content: '', encoding: 'base64' })

    expect(res.status).toBe(200)
    expect(mockPerformUpdateContent).toHaveBeenCalledWith(
      expect.objectContaining({ content: '', encoding: 'base64' })
    )
  })

  it('allows JSON bodies above the default 50 MiB cap for base64 expansion', async () => {
    const res = await callPut(
      { workspaceId: WS, content: 'TQ==', encoding: 'base64' },
      60 * 1024 * 1024
    )

    expect(res.status).toBe(200)
    expect(mockPerformUpdateContent).toHaveBeenCalled()
  })

  it('returns an oversized JSON body in the canonical v2 413 envelope', async () => {
    const res = await callPut({ workspaceId: WS, content: '' }, 70 * 1024 * 1024 + 1)

    expect(res.status).toBe(413)
    await expect(res.json()).resolves.toEqual({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' },
    })
    expect(mockPerformUpdateContent).not.toHaveBeenCalled()
  })

  it('surfaces an access-denied failure in the v2 error envelope', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Access denied',
    })
    const res = await callPut({ workspaceId: WS, content: 'id,name\n' })
    expect(res.status).toBe(403)
    expect(mockPerformUpdateContent).not.toHaveBeenCalled()
  })

  it('returns the rate-limit response when denied', async () => {
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_DENIED)
    const res = await callPut({ workspaceId: WS, content: 'id,name\n' })
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
  })

  it('replaces the content and returns the updated file', async () => {
    const res = await callPut({ workspaceId: WS, content: 'id,name\n' })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toEqual({
      id: FILE_ID,
      name: 'data.csv',
      size: 8,
      type: 'text/csv',
      key: 'workspace/ws/1-x-data.csv',
      folderPath: '/',
      uploadedBy: 'user-1',
      uploadedAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-03T00:00:00.000Z',
    })
    expect(mockPerformUpdateContent).toHaveBeenCalledWith({
      workspaceId: WS,
      fileId: FILE_ID,
      userId: 'user-1',
      content: 'id,name\n',
      encoding: 'utf-8',
      request: expect.anything(),
    })
  })

  it('forwards base64 encoding through to the orchestration', async () => {
    await callPut({ workspaceId: WS, content: 'aWQsbmFtZQo=', encoding: 'base64' })
    expect(mockPerformUpdateContent).toHaveBeenCalledWith(
      expect.objectContaining({ encoding: 'base64' })
    )
  })

  it('maps a payload_too_large errorCode to 413 rather than string-sniffing', async () => {
    mockPerformUpdateContent.mockResolvedValue({
      success: false,
      error: 'Storage limit exceeded. Used: 5.10GB, Limit: 5GB',
      errorCode: 'payload_too_large',
    })

    const res = await callPut({ workspaceId: WS, content: 'id,name\n' })
    const body = await res.json()

    expect(res.status).toBe(413)
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE')
    expect(body.error.message).toContain('Storage limit exceeded')
  })

  it('maps a not_found errorCode to 404', async () => {
    mockPerformUpdateContent.mockResolvedValue({
      success: false,
      error: 'File not found',
      errorCode: 'not_found',
    })

    const res = await callPut({ workspaceId: WS, content: 'id,name\n' })

    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('NOT_FOUND')
  })
})
