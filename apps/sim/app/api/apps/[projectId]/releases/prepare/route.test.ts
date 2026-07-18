/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockPrepareProjectRelease } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockPrepareProjectRelease: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/apps/prepare-release', () => ({
  prepareProjectRelease: mockPrepareProjectRelease,
}))

import { POST } from '@/app/api/apps/[projectId]/releases/prepare/route'

function request() {
  return new NextRequest('http://localhost/api/apps/project-1/releases/prepare', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ revisionId: 'revision-1', buildId: 'build-1' }),
  })
}

function callPost() {
  return POST(request(), { params: Promise.resolve({ projectId: 'project-1' }) })
}

describe('POST /api/apps/[projectId]/releases/prepare', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockPrepareProjectRelease.mockResolvedValue({ ok: true, releaseId: 'release-1' })
  })

  it('returns 401 without a session', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const response = await callPost()

    expect(response.status).toBe(401)
    expect(mockPrepareProjectRelease).not.toHaveBeenCalled()
  })

  it('returns the permission denial from release preparation', async () => {
    mockPrepareProjectRelease.mockResolvedValueOnce({
      ok: false,
      error: 'Publish access denied',
      code: 'PERMISSION_DENIED',
      status: 403,
    })

    const response = await callPost()

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: 'Publish access denied',
      code: 'PERMISSION_DENIED',
    })
  })

  it('prepares a release from the requested revision and build', async () => {
    const response = await callPost()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ releaseId: 'release-1', state: 'prepared' })
    expect(mockPrepareProjectRelease).toHaveBeenCalledWith({
      projectId: 'project-1',
      revisionId: 'revision-1',
      buildId: 'build-1',
      userId: 'user-1',
    })
  })
})
