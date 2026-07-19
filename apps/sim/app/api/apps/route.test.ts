/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockAssertAppPermission,
  mockCreateAppProject,
  mockListAppProjects,
  mockGetAppOriginStatus,
  mockRecordAudit,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockAssertAppPermission: vi.fn(),
  mockCreateAppProject: vi.fn(),
  mockListAppProjects: vi.fn(),
  mockGetAppOriginStatus: vi.fn(),
  mockRecordAudit: vi.fn(),
}))

vi.mock('@sim/db', () => ({ db: { select: vi.fn() } }))
vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/apps/permissions', () => ({ assertAppPermission: mockAssertAppPermission }))
vi.mock('@/lib/apps/projects', () => ({
  createAppProject: mockCreateAppProject,
  listAppProjects: mockListAppProjects,
}))
vi.mock('@/lib/apps/origin', () => ({ getAppOriginStatus: mockGetAppOriginStatus }))
vi.mock('@sim/audit', () => ({
  AuditAction: { APP_CREATED: 'app.created' },
  AuditResourceType: { APP: 'app' },
  recordAudit: mockRecordAudit,
}))

import { GET, POST } from '@/app/api/apps/route'

function createRequest() {
  return new NextRequest('http://localhost/api/apps', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workspaceId: 'ws-1', name: 'Example App', slug: 'example-app' }),
  })
}

describe('POST /api/apps', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetAppOriginStatus.mockReturnValue({
      enabled: true,
      appPublicOrigin: 'https://apps.test',
    })
    mockAssertAppPermission.mockResolvedValue({ ok: true })
    mockCreateAppProject.mockResolvedValue({
      success: true,
      project: { id: 'project-1', name: 'Example App', workspaceId: 'ws-1' },
    })
  })

  it('returns 401 without a session', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const response = await POST(createRequest(), undefined as never)

    expect(response.status).toBe(401)
    expect(mockAssertAppPermission).not.toHaveBeenCalled()
  })

  it('returns permission denial before creating a project', async () => {
    mockAssertAppPermission.mockResolvedValueOnce({
      ok: false,
      status: 403,
      message: 'Workspace access denied',
    })

    const response = await POST(createRequest(), undefined as never)

    expect(response.status).toBe(403)
    expect(mockCreateAppProject).not.toHaveBeenCalled()
  })

  it('creates a project for a workspace editor', async () => {
    const response = await POST(createRequest(), undefined as never)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      project: { id: 'project-1', name: 'Example App', workspaceId: 'ws-1' },
    })
    expect(mockCreateAppProject).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      name: 'Example App',
      slug: 'example-app',
      userId: 'user-1',
      createdFromChatId: undefined,
    })
  })
})

describe('GET /api/apps', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockAssertAppPermission.mockResolvedValue({ ok: true })
    mockListAppProjects.mockResolvedValue([
      {
        id: 'project-1',
        name: 'Example App',
        interfaceStatus: 'ready',
        thumbnailUrl: '/api/apps/project-1/thumbnail',
      },
    ])
  })

  it('returns enriched gallery list items after workspace permission check', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/apps?workspaceId=ws-1'),
      undefined as never
    )

    expect(response.status).toBe(200)
    expect(mockAssertAppPermission).toHaveBeenCalledWith('user-1', 'ws-1', 'edit')
    expect(mockListAppProjects).toHaveBeenCalledWith('ws-1')
    expect(await response.json()).toEqual({
      projects: [
        {
          id: 'project-1',
          name: 'Example App',
          interfaceStatus: 'ready',
          thumbnailUrl: '/api/apps/project-1/thumbnail',
        },
      ],
    })
  })
})
