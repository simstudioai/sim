/**
 * @vitest-environment node
 */
import {
  auditMock,
  auditMockFns,
  authMockFns,
  permissionsMock,
  permissionsMockFns,
  posthogServerMock,
  posthogServerMockFns,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRegisterUploadedWorkspaceFile, mockParseWorkspaceFileKey, FileConflictErrorImpl } =
  vi.hoisted(() => {
    class FileConflictErrorImpl extends Error {
      constructor(message: string) {
        super(message)
        this.name = 'FileConflictError'
      }
    }
    return {
      mockRegisterUploadedWorkspaceFile: vi.fn(),
      mockParseWorkspaceFileKey: vi.fn(),
      FileConflictErrorImpl,
    }
  })

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  registerUploadedWorkspaceFile: mockRegisterUploadedWorkspaceFile,
  parseWorkspaceFileKey: mockParseWorkspaceFileKey,
  FileConflictError: FileConflictErrorImpl,
}))

vi.mock('@/lib/posthog/server', () => posthogServerMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@sim/audit', () => auditMock)

const WS = '7727ef3f-8cf6-4686-b063-2bb006a10785'
const VALID_KEY = `workspace/${WS}/123-abc-video.mp4`

import { POST } from '@/app/api/workspaces/[id]/files/register/route'

const params = (id = WS) => ({ params: Promise.resolve({ id }) })

const makeRequest = (body: unknown) =>
  new NextRequest(`http://localhost/api/workspaces/${WS}/files/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const validBody = {
  key: VALID_KEY,
  name: 'video.mp4',
  contentType: 'video/mp4',
}

describe('POST /api/workspaces/[id]/files/register', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-1', name: 'User One', email: 'u@example.com' },
    })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('write')
    mockParseWorkspaceFileKey.mockImplementation((key: string) => {
      const match = key.match(/^workspace\/([^/]+)\//)
      return match ? match[1] : null
    })
    mockRegisterUploadedWorkspaceFile.mockResolvedValue({
      file: {
        id: 'wf_123',
        name: 'video.mp4',
        size: 10 * 1024 * 1024,
        type: 'video/mp4',
        url: '/api/files/serve/...',
        key: VALID_KEY,
        context: 'workspace',
      },
      created: true,
    })
  })

  it('returns 401 when unauthenticated', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce(null)
    const res = await POST(makeRequest(validBody), params())
    expect(res.status).toBe(401)
  })

  it('returns 403 when user lacks write permission', async () => {
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValueOnce('read')
    const res = await POST(makeRequest(validBody), params())
    expect(res.status).toBe(403)
  })

  it('rejects keys belonging to a different workspace', async () => {
    const otherWsKey = `workspace/00000000-0000-0000-0000-000000000000/123-abc-video.mp4`
    const res = await POST(makeRequest({ ...validBody, key: otherWsKey }), params())
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toContain('does not belong')
    expect(mockRegisterUploadedWorkspaceFile).not.toHaveBeenCalled()
  })

  it('returns 400 for empty key/name', async () => {
    const res = await POST(makeRequest({ ...validBody, key: '' }), params())
    expect(res.status).toBe(400)
  })

  it('returns 404 when storage object is missing', async () => {
    mockRegisterUploadedWorkspaceFile.mockRejectedValueOnce(
      new Error('Uploaded object not found in storage')
    )
    const res = await POST(makeRequest(validBody), params())
    expect(res.status).toBe(404)
  })

  it('returns 409 on duplicate file conflict', async () => {
    mockRegisterUploadedWorkspaceFile.mockRejectedValueOnce(new FileConflictErrorImpl('video.mp4'))
    const res = await POST(makeRequest(validBody), params())
    const body = await res.json()
    expect(res.status).toBe(409)
    expect(body.isDuplicate).toBe(true)
  })

  it('skips audit + analytics on idempotent re-register (created=false)', async () => {
    mockRegisterUploadedWorkspaceFile.mockResolvedValueOnce({
      file: {
        id: 'wf_123',
        name: 'video.mp4',
        size: 10 * 1024 * 1024,
        type: 'video/mp4',
        url: '/api/files/serve/...',
        key: VALID_KEY,
        context: 'workspace',
      },
      created: false,
    })

    const res = await POST(makeRequest(validBody), params())
    expect(res.status).toBe(200)
    expect(posthogServerMockFns.mockCaptureServerEvent).not.toHaveBeenCalled()
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
  })

  it('finalizes upload, records audit and analytics', async () => {
    const res = await POST(makeRequest(validBody), params())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.file).toMatchObject({ id: 'wf_123', key: VALID_KEY })

    expect(mockRegisterUploadedWorkspaceFile).toHaveBeenCalledWith({
      workspaceId: WS,
      userId: 'user-1',
      key: VALID_KEY,
      originalName: 'video.mp4',
      contentType: 'video/mp4',
    })

    expect(posthogServerMockFns.mockCaptureServerEvent).toHaveBeenCalledWith(
      'user-1',
      'file_uploaded',
      expect.objectContaining({ workspace_id: WS, file_type: 'video/mp4' }),
      expect.any(Object)
    )
  })
})
