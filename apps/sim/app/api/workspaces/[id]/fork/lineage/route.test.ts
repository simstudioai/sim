/**
 * @vitest-environment node
 */
import { authMockFns, createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const {
  mockAuthorizeWorkspaceOperation,
  mockGetForkParent,
  mockGetForkChildren,
  mockGetUndoableRunForTarget,
  mockGetEffectiveWorkspacePermission,
} = vi.hoisted(() => ({
  mockAuthorizeWorkspaceOperation: vi.fn(),
  mockGetForkParent: vi.fn(),
  mockGetForkChildren: vi.fn(),
  mockGetUndoableRunForTarget: vi.fn(),
  mockGetEffectiveWorkspacePermission: vi.fn(),
}))

vi.mock('@/ee/workspace-forking/lib/lineage/authz', () => ({
  assertForkingEnabled: vi.fn(),
  ForkError: class extends Error {},
}))

vi.mock('@/ee/workspace-forking/lib/lineage/lineage', () => ({
  getForkParent: mockGetForkParent,
  getForkChildren: mockGetForkChildren,
}))

vi.mock('@/ee/workspace-forking/lib/promote/promote-run-store', () => ({
  getUndoableRunForTarget: mockGetUndoableRunForTarget,
}))

vi.mock('@/lib/core/application/workspace-authorization', () => ({
  authorizeWorkspaceOperation: mockAuthorizeWorkspaceOperation,
  requireAllowedWorkspacePrincipal: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getWorkspaceWithOwner: vi.fn(async (id: string) => ({
    id,
    organizationId: null,
    allowPersonalApiKeys: true,
  })),
  getEffectiveWorkspacePermission: mockGetEffectiveWorkspacePermission,
}))

import { GET } from '@/app/api/workspaces/[id]/fork/lineage/route'

const mockGetSession = authMockFns.mockGetSession

const WORKSPACE_ID = 'workspace-1'
const VIEWER_ID = 'user-1'
const routeContext = { params: Promise.resolve({ id: WORKSPACE_ID }) }

const parentNode = { id: 'parent-1', name: 'Parent', organizationId: 'org-1' }
const childCreatedAt = new Date('2026-01-02T03:04:05.000Z')
const childNode = (id: string, name: string) => ({
  id,
  name,
  organizationId: 'org-1',
  createdAt: childCreatedAt,
})

describe('fork lineage route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: VIEWER_ID }, session: { id: 'session-1' } })
    mockAuthorizeWorkspaceOperation.mockResolvedValue(undefined)
    mockGetForkParent.mockResolvedValue(null)
    mockGetForkChildren.mockResolvedValue([])
    mockGetUndoableRunForTarget.mockResolvedValue(null)
    mockGetEffectiveWorkspacePermission.mockResolvedValue(null)
  })

  it('returns 401 when there is no session', async () => {
    mockGetSession.mockResolvedValue(null)

    const res = await GET(createMockRequest('GET'), routeContext)

    expect(res.status).toBe(401)
    expect(mockAuthorizeWorkspaceOperation).not.toHaveBeenCalled()
  })

  it('requires admin on the current workspace before loading lineage', async () => {
    await GET(createMockRequest('GET'), routeContext)

    expect(mockAuthorizeWorkspaceOperation).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'session', userId: VIEWER_ID }),
      expect.objectContaining({ id: 'workspaces.fork.discover', minimumRole: 'admin' }),
      expect.objectContaining({ workspaceId: WORKSPACE_ID }),
      {}
    )
    expect(mockAuthorizeWorkspaceOperation.mock.invocationCallOrder[0]).toBeLessThan(
      mockGetForkParent.mock.invocationCallOrder[0]
    )
  })

  it('does not read lineage when current workspace authorization is refused', async () => {
    mockAuthorizeWorkspaceOperation.mockRejectedValue(
      new OrchestrationError('forbidden', 'Admin access required')
    )

    const response = await GET(createMockRequest('GET'), routeContext)

    expect(response.status).toBe(403)
    expect(mockGetForkParent).not.toHaveBeenCalled()
    expect(mockGetForkChildren).not.toHaveBeenCalled()
    expect(mockGetUndoableRunForTarget).not.toHaveBeenCalled()
  })

  it('marks accessible and inaccessible nodes via the canonical permission resolver', async () => {
    mockGetForkParent.mockResolvedValue(parentNode)
    mockGetForkChildren.mockResolvedValue([
      childNode('fork-accessible', 'Accessible fork'),
      childNode('fork-hidden', 'Hidden fork'),
    ])
    mockGetEffectiveWorkspacePermission.mockImplementation(
      async (_userId: string, ws: { id: string }) => {
        if (ws.id === parentNode.id) return 'read'
        if (ws.id === 'fork-accessible') return 'admin'
        return null
      }
    )

    const res = await GET(createMockRequest('GET'), routeContext)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.parent).toEqual({ ...parentNode, viewerAccessible: true })
    expect(body.children).toEqual([
      {
        id: 'fork-accessible',
        name: 'Accessible fork',
        organizationId: 'org-1',
        createdAt: childCreatedAt.toISOString(),
        viewerAccessible: true,
      },
      {
        id: 'fork-hidden',
        name: 'Hidden fork',
        organizationId: 'org-1',
        createdAt: childCreatedAt.toISOString(),
        viewerAccessible: false,
      },
    ])
    expect(mockGetEffectiveWorkspacePermission).toHaveBeenCalledWith(
      VIEWER_ID,
      expect.objectContaining({ id: parentNode.id, organizationId: 'org-1' })
    )
  })

  it('marks the parent inaccessible when the viewer holds no permission on it', async () => {
    mockGetForkParent.mockResolvedValue(parentNode)
    mockGetEffectiveWorkspacePermission.mockResolvedValue(null)

    const res = await GET(createMockRequest('GET'), routeContext)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.parent).toEqual({ ...parentNode, viewerAccessible: false })
    expect(body.children).toEqual([])
  })

  it('keeps a null parent null without resolving permissions', async () => {
    const res = await GET(createMockRequest('GET'), routeContext)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.parent).toBeNull()
    expect(body.children).toEqual([])
    expect(body.undoableRun).toBeNull()
    expect(mockGetEffectiveWorkspacePermission).not.toHaveBeenCalled()
  })
})
