/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockBuildProjectRevision } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockBuildProjectRevision: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/apps/build/project-build', () => ({
  buildProjectRevision: mockBuildProjectRevision,
}))

import { POST } from '@/app/api/apps/[projectId]/build/route'

function request() {
  return new NextRequest('http://localhost/api/apps/project-1/build', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      revisionId: 'revision-1',
      expectedRevisionId: 'revision-1',
    }),
  })
}

describe('POST /api/apps/[projectId]/build', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockBuildProjectRevision.mockResolvedValue({
      ok: true,
      buildId: 'build-1',
      artifactManifestHash: 'sha256:abc',
      buildImageDigest: 'e2b-build:test',
      diagnostics: {},
    })
  })

  it('passes the optimistic draft expectation into the normal build path', async () => {
    const response = await POST(request(), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(response.status).toBe(200)
    expect(mockBuildProjectRevision).toHaveBeenCalledWith({
      projectId: 'project-1',
      revisionId: 'revision-1',
      userId: 'user-1',
      expectedRevisionId: 'revision-1',
    })
  })

  it('returns the typed draft conflict as HTTP 409', async () => {
    mockBuildProjectRevision.mockResolvedValueOnce({
      ok: false,
      error: 'Draft revision changed; reload before continuing',
      code: 'DRAFT_REVISION_CONFLICT',
      status: 409,
    })

    const response = await POST(request(), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'DRAFT_REVISION_CONFLICT' })
  })
})
