/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockAssertWorkspaceAdminAccess,
  mockGetForkParent,
  mockGetForkChildren,
  mockGetUndoableRunForTarget,
  mockGetEffectiveWorkspacePermission,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockAssertWorkspaceAdminAccess: vi.fn(),
  mockGetForkParent: vi.fn(),
  mockGetForkChildren: vi.fn(),
  mockGetUndoableRunForTarget: vi.fn(),
  mockGetEffectiveWorkspacePermission: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))

vi.mock('@/ee/workspace-forking/lib/lineage/authz', () => ({
  assertWorkspaceAdminAccess: mockAssertWorkspaceAdminAccess,
}))

vi.mock('@/ee/workspace-forking/lib/lineage/lineage', () => ({
  getForkParent: mockGetForkParent,
  getForkChildren: mockGetForkChildren,
}))

vi.mock('@/ee/workspace-forking/lib/promote/promote-run-store', () => ({
  getUndoableRunForTarget: mockGetUndoableRunForTarget,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getEffectiveWorkspacePermission: mockGetEffectiveWorkspacePermission,
}))

import { GET } from '@/app/api/workspaces/[id]/fork/lineage/route'

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
    mockGetSession.mockResolvedValue({ user: { id: VIEWER_ID } })
    mockAssertWorkspaceAdminAccess.mockResolvedValue({ id: WORKSPACE_ID })
    mockGetForkParent.mockResolvedValue(null)
    mockGetForkChildren.mockResolvedValue([])
    mockGetUndoableRunForTarget.mockResolvedValue(null)
    mockGetEffectiveWorkspacePermission.mockResolvedValue(null)
  })

  it('returns 401 when there is no session', async () => {
    mockGetSession.mockResolvedValue(null)

    const res = await GET(createMockRequest('GET'), routeContext)

    expect(res.status).toBe(401)
    expect(mockAssertWorkspaceAdminAccess).not.toHaveBeenCalled()
  })

  it('requires admin on the current workspace before loading lineage', async () => {
    await GET(createMockRequest('GET'), routeContext)

    expect(mockAssertWorkspaceAdminAccess).toHaveBeenCalledWith(WORKSPACE_ID, VIEWER_ID)
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
