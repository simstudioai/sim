/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckSessionOrInternalAuth, mockCheckWorkspaceAccess, mockListOpenCodeRepositories } =
  vi.hoisted(() => ({
    mockCheckSessionOrInternalAuth: vi.fn(),
    mockCheckWorkspaceAccess: vi.fn(),
    mockListOpenCodeRepositories: vi.fn(),
  }))

vi.mock('@/lib/auth/hybrid', () => ({
  AuthType: { SESSION: 'session', API_KEY: 'api_key', INTERNAL_JWT: 'internal_jwt' },
  checkSessionOrInternalAuth: mockCheckSessionOrInternalAuth,
}))

vi.mock('@/lib/core/utils/request', () => ({
  generateRequestId: vi.fn().mockReturnValue('test-request-id'),
}))

vi.mock('@/lib/opencode/service', () => ({
  listOpenCodeRepositories: mockListOpenCodeRepositories,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: mockCheckWorkspaceAccess,
}))

import { GET } from '@/app/api/opencode/repos/route'

describe('GET /api/opencode/repos', () => {
  function createRequest(query = ''): NextRequest {
    return new NextRequest(new URL(`http://localhost:3000/api/opencode/repos${query}`))
  }

  beforeEach(() => {
    vi.clearAllMocks()

    mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-123',
    })
    mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
    })
    mockListOpenCodeRepositories.mockResolvedValue([
      {
        id: 'repo-a',
        label: 'repo-a',
        directory: '/app/repos/repo-a',
        projectId: 'project-1',
      },
    ])
  })

  it('returns 401 when unauthenticated', async () => {
    mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: false,
      userId: null,
    })

    const response = await GET(createRequest('?workspaceId=ws-1'))
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toEqual({ error: 'Unauthorized' })
    expect(mockCheckWorkspaceAccess).not.toHaveBeenCalled()
    expect(mockListOpenCodeRepositories).not.toHaveBeenCalled()
  })

  it('returns 400 when workspaceId is missing', async () => {
    const response = await GET(createRequest())
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toEqual({ error: 'workspaceId is required' })
    expect(mockCheckWorkspaceAccess).not.toHaveBeenCalled()
  })

  it('returns 404 when workspace does not exist', async () => {
    mockCheckWorkspaceAccess.mockResolvedValue({
      exists: false,
      hasAccess: false,
    })

    const response = await GET(createRequest('?workspaceId=ws-404'))
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Workspace not found' })
    expect(mockListOpenCodeRepositories).not.toHaveBeenCalled()
  })

  it('returns 403 when the user does not have access to the workspace', async () => {
    mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: false,
    })

    const response = await GET(createRequest('?workspaceId=ws-1'))
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data).toEqual({ error: 'Access denied' })
    expect(mockListOpenCodeRepositories).not.toHaveBeenCalled()
  })

  it('returns repository options when the request is authorized', async () => {
    const response = await GET(createRequest('?workspaceId=ws-1'))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(mockCheckWorkspaceAccess).toHaveBeenCalledWith('ws-1', 'user-123')
    expect(data).toEqual({
      data: [
        {
          id: 'repo-a',
          label: 'repo-a',
          directory: '/app/repos/repo-a',
          projectId: 'project-1',
        },
      ],
    })
  })
})
