/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockAssertAppPermission,
  mockPublishPreparedRelease,
  mockSelect,
  mockLimit,
  mockRecordAudit,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockAssertAppPermission: vi.fn(),
  mockPublishPreparedRelease: vi.fn(),
  mockSelect: vi.fn(),
  mockLimit: vi.fn(),
  mockRecordAudit: vi.fn(),
}))

vi.mock('@sim/db', () => ({ db: { select: mockSelect } }))
vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/apps/permissions', () => ({ assertAppPermission: mockAssertAppPermission }))
vi.mock('@/lib/apps/publish', () => ({ publishPreparedRelease: mockPublishPreparedRelease }))
vi.mock('@sim/audit', () => ({
  AuditAction: { APP_PUBLISHED: 'app.published' },
  AuditResourceType: { APP: 'app' },
  recordAudit: mockRecordAudit,
}))

import { POST } from '@/app/api/apps/[projectId]/releases/publish/route'

function request() {
  return new NextRequest('http://localhost/api/apps/project-1/releases/publish', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ releaseId: 'release-1', expectedVersion: 4 }),
  })
}

function callPost() {
  return POST(request(), { params: Promise.resolve({ projectId: 'project-1' }) })
}

describe('POST /api/apps/[projectId]/releases/publish', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: mockLimit }),
      }),
    })
    mockLimit.mockResolvedValue([{ id: 'project-1', workspaceId: 'ws-1', name: 'Example App' }])
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockAssertAppPermission.mockResolvedValue({ ok: true })
    mockPublishPreparedRelease.mockResolvedValue({ success: true, releaseId: 'release-1' })
  })

  it('returns 401 without a session', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const response = await callPost()

    expect(response.status).toBe(401)
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it('returns permission denial before publishing', async () => {
    mockAssertAppPermission.mockResolvedValueOnce({
      ok: false,
      status: 403,
      message: 'Publish access denied',
    })

    const response = await callPost()

    expect(response.status).toBe(403)
    expect(mockPublishPreparedRelease).not.toHaveBeenCalled()
  })

  it('publishes the prepared release with optimistic version checking', async () => {
    const response = await callPost()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ releaseId: 'release-1', state: 'published' })
    expect(mockPublishPreparedRelease).toHaveBeenCalledWith({
      projectId: 'project-1',
      releaseId: 'release-1',
      expectedVersion: 4,
    })
  })
})
