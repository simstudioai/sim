/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockAssertAppPermission,
  mockActivatePreviewPins,
  mockGetAppOriginStatus,
  mockSelect,
  mockLimit,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockAssertAppPermission: vi.fn(),
  mockActivatePreviewPins: vi.fn(),
  mockGetAppOriginStatus: vi.fn(),
  mockSelect: vi.fn(),
  mockLimit: vi.fn(),
}))

vi.mock('@sim/db', () => ({ db: { select: mockSelect } }))
vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/apps/permissions', () => ({ assertAppPermission: mockAssertAppPermission }))
vi.mock('@/lib/apps/pins', () => ({ activatePreviewPins: mockActivatePreviewPins }))
vi.mock('@/lib/apps/origin', () => ({ getAppOriginStatus: mockGetAppOriginStatus }))

import { POST } from '@/app/api/apps/[projectId]/preview/session/route'

function request() {
  return new NextRequest('http://localhost/api/apps/project-1/preview/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ revisionId: 'revision-1' }),
  })
}

function callPost() {
  return POST(request(), { params: Promise.resolve({ projectId: 'project-1' }) })
}

describe('POST /api/apps/[projectId]/preview/session', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: mockLimit }),
      }),
    })
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetAppOriginStatus.mockReturnValue({
      enabled: true,
      appPublicOrigin: 'https://apps.test',
    })
    mockAssertAppPermission.mockResolvedValue({ ok: true })
    mockActivatePreviewPins.mockResolvedValue({
      sessionId: 'session-1',
      channelNonce: 'nonce-1',
      expiresAt: new Date('2026-01-01T00:30:00Z'),
      buildId: 'build-1',
      artifactManifestHash: 'hash-1',
      artifactPreview: true,
      event: {
        type: 'app.preview.ready',
        payload: { projectId: 'project-1', sessionId: 'session-1' },
      },
    })
  })

  it('returns 401 without a session', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const response = await callPost()

    expect(response.status).toBe(401)
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it('returns permission denial for a project viewer', async () => {
    mockLimit.mockResolvedValueOnce([{ id: 'project-1', workspaceId: 'ws-1' }])
    mockAssertAppPermission.mockResolvedValueOnce({
      ok: false,
      status: 403,
      message: 'Preview access denied',
    })

    const response = await callPost()

    expect(response.status).toBe(403)
    expect(mockActivatePreviewPins).not.toHaveBeenCalled()
  })

  it('activates preview pins for an existing revision', async () => {
    mockLimit
      .mockResolvedValueOnce([{ id: 'project-1', workspaceId: 'ws-1' }])
      .mockResolvedValueOnce([{ id: 'revision-1', projectId: 'project-1' }])

    const response = await callPost()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      sessionId: 'session-1',
      channelNonce: 'nonce-1',
      expiresAt: '2026-01-01T00:30:00.000Z',
      appPublicOrigin: 'https://apps.test',
      buildId: 'build-1',
      artifactManifestHash: 'hash-1',
      artifactPreview: true,
    })
    expect(mockActivatePreviewPins).toHaveBeenCalledWith({
      projectId: 'project-1',
      revisionId: 'revision-1',
      userId: 'user-1',
    })
  })
})
