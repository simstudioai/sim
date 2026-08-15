/**
 * @vitest-environment node
 */
import { authMockFns, createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAssertWorkspaceAdminAccess, mockGetForkForest, mockGetManageableWorkspaces } =
  vi.hoisted(() => ({
    mockAssertWorkspaceAdminAccess: vi.fn(),
    mockGetForkForest: vi.fn(),
    mockGetManageableWorkspaces: vi.fn(),
  }))

vi.mock('@/ee/workspace-forking/lib/lineage/authz', () => ({
  assertWorkspaceAdminAccess: mockAssertWorkspaceAdminAccess,
}))

vi.mock('@/ee/workspace-forking/lib/lineage/forest', () => ({
  getForkForest: mockGetForkForest,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getManageableWorkspaces: mockGetManageableWorkspaces,
}))

import { GET } from '@/app/api/workspaces/[id]/fork/forest/route'

const mockGetSession = authMockFns.mockGetSession

const WORKSPACE_ID = 'workspace-1'
const VIEWER_ID = 'user-1'
const routeContext = { params: Promise.resolve({ id: WORKSPACE_ID }) }

const node = (id: string, parentId: string | null) => ({
  id,
  name: `Workspace ${id}`,
  color: '#33C482',
  logoUrl: null,
  organizationId: 'org-1',
  parentId,
  createdAt: '2026-01-02T03:04:05.000Z',
  viewerAccessible: true,
  viewerCanAdmin: true,
  deployedWorkflowCount: 2,
  edge: parentId
    ? { mapped: 3, unmapped: 1, lastSyncAt: '2026-01-03T00:00:00.000Z', undoableRun: null }
    : null,
})

describe('fork forest route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: VIEWER_ID } })
    mockAssertWorkspaceAdminAccess.mockResolvedValue({ id: WORKSPACE_ID })
    mockGetManageableWorkspaces.mockResolvedValue([{ id: WORKSPACE_ID }, { id: 'workspace-2' }])
    mockGetForkForest.mockResolvedValue([])
  })

  it('returns 401 when there is no session', async () => {
    mockGetSession.mockResolvedValue(null)

    const res = await GET(createMockRequest('GET'), routeContext)

    expect(res.status).toBe(401)
    expect(mockAssertWorkspaceAdminAccess).not.toHaveBeenCalled()
  })

  it('requires admin on the anchor workspace before loading the forest', async () => {
    await GET(createMockRequest('GET'), routeContext)

    expect(mockAssertWorkspaceAdminAccess).toHaveBeenCalledWith(WORKSPACE_ID, VIEWER_ID)
  })

  it('seeds the walk from every workspace the viewer administers', async () => {
    await GET(createMockRequest('GET'), routeContext)

    expect(mockGetForkForest).toHaveBeenCalledWith({
      anchorWorkspaceId: WORKSPACE_ID,
      viewerId: VIEWER_ID,
      manageableWorkspaceIds: [WORKSPACE_ID, 'workspace-2'],
    })
  })

  it('returns the forest nodes verbatim alongside the anchor id', async () => {
    const nodes = [node(WORKSPACE_ID, null), node('fork-1', WORKSPACE_ID)]
    mockGetForkForest.mockResolvedValue(nodes)

    const res = await GET(createMockRequest('GET'), routeContext)

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ workspaceId: WORKSPACE_ID, nodes })
  })
})
