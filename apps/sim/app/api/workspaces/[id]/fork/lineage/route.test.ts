import { authMockFns, createMockRequest } from '@sim/testing'
import { createRouteContext } from '@sim/testing/helpers/http'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import {
  workspaceAuthorizationMock,
  workspaceAuthorizationMockFns,
} from '@sim/testing/mocks/workspace-authorization.mock'
import { workspaceForkingAuthzMock } from '@sim/testing/mocks/workspace-forking-authz.mock'
import {
  workspaceForkingLineageMock,
  workspaceForkingLineageMockFns,
} from '@sim/testing/mocks/workspace-forking-lineage.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const { mockGetUndoableRunForTarget } = vi.hoisted(() => ({
  mockGetUndoableRunForTarget: vi.fn(),
}))

vi.mock('@/ee/workspace-forking/lib/lineage/authz', () => workspaceForkingAuthzMock)

vi.mock('@/ee/workspace-forking/lib/lineage/lineage', () => workspaceForkingLineageMock)

vi.mock('@/ee/workspace-forking/lib/promote/promote-run-store', () => ({
  getUndoableRunForTarget: mockGetUndoableRunForTarget,
}))

vi.mock('@/lib/core/application/workspace-authorization', () => workspaceAuthorizationMock)

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

import { GET } from '@/app/api/workspaces/[id]/fork/lineage/route'

const { mockGetForkParent, mockGetForkChildren } = workspaceForkingLineageMockFns

const mockGetSession = authMockFns.mockGetSession
const mockAuthorizeWorkspaceOperation =
  workspaceAuthorizationMockFns.mockAuthorizeWorkspaceOperation
const { mockGetEffectiveWorkspacePermission } = permissionsMockFns
permissionsMockFns.mockGetWorkspaceWithOwner.mockImplementation(async (id: string) => ({
  id,
  organizationId: null,
  allowPersonalApiKeys: true,
}))

const WORKSPACE_ID = 'workspace-1'
const VIEWER_ID = 'user-1'
const routeContext = createRouteContext({ id: WORKSPACE_ID })

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
    mockGetSession.mockResolvedValue({ user: { id: VIEWER_ID }, session: { id: 'session-1' } })
    mockAuthorizeWorkspaceOperation.mockResolvedValue(undefined)
    mockGetForkParent.mockResolvedValue(null)
    mockGetForkChildren.mockResolvedValue([])
    mockGetUndoableRunForTarget.mockResolvedValue(null)
    mockGetEffectiveWorkspacePermission.mockResolvedValue(null)
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
})
