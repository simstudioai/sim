/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockAssertAppPermission,
  mockRevokeRelease,
  mockSelect,
  mockLimit,
  mockRecordAudit,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockAssertAppPermission: vi.fn(),
  mockRevokeRelease: vi.fn(),
  mockSelect: vi.fn(),
  mockLimit: vi.fn(),
  mockRecordAudit: vi.fn(),
}))

vi.mock('@sim/db', () => ({ db: { select: mockSelect } }))
vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/apps/permissions', () => ({ assertAppPermission: mockAssertAppPermission }))
vi.mock('@/lib/apps/publish', () => ({ revokeRelease: mockRevokeRelease }))
vi.mock('@sim/audit', () => ({
  AuditAction: { APP_REVOKED: 'app.revoked' },
  AuditResourceType: { APP: 'app' },
  recordAudit: mockRecordAudit,
}))

import { POST } from '@/app/api/apps/[projectId]/releases/revoke/route'

function request() {
  return new NextRequest('http://localhost/api/apps/project-1/releases/revoke', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ releaseId: 'release-1' }),
  })
}

function callPost() {
  return POST(request(), { params: Promise.resolve({ projectId: 'project-1' }) })
}

describe('POST /api/apps/[projectId]/releases/revoke', () => {
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
    mockRevokeRelease.mockResolvedValue({
      success: true,
      clearedPointer: true,
      event: {
        type: 'app.release.revoked',
        payload: { projectId: 'project-1', releaseId: 'release-1', reason: 'manual' },
      },
    })
  })

  it('returns 401 without a session', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const response = await callPost()

    expect(response.status).toBe(401)
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it('returns permission denial before revoking', async () => {
    mockAssertAppPermission.mockResolvedValueOnce({
      ok: false,
      status: 403,
      message: 'Revoke access denied',
    })

    const response = await callPost()

    expect(response.status).toBe(403)
    expect(mockRevokeRelease).not.toHaveBeenCalled()
  })

  it('revokes the release and returns a tombstone for the current pointer', async () => {
    const response = await callPost()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      revoked: true,
      clearedPointer: true,
      tombstone: true,
    })
    expect(mockRevokeRelease).toHaveBeenCalledWith({
      projectId: 'project-1',
      releaseId: 'release-1',
    })
  })
})
