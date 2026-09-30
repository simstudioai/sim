/**
 * @vitest-environment node
 */
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

const mocks = vi.hoisted(() => ({
  loadSourceDeployedStates: vi.fn(),
  loadTargetDraftState: vi.fn(),
  loadForkBlockMap: vi.fn(),
  computeForkPromotePlan: vi.fn(),
}))

vi.mock('@/lib/core/application/workspace-authorization', () => workspaceAuthorizationMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/ee/workspace-forking/lib/lineage/authz', () => workspaceForkingAuthzMock)
vi.mock('@/ee/workspace-forking/lib/lineage/lineage', () => workspaceForkingLineageMock)
vi.mock('@/ee/workspace-forking/lib/copy/deploy-bridge', () => ({
  loadSourceDeployedStates: mocks.loadSourceDeployedStates,
  loadTargetDraftState: mocks.loadTargetDraftState,
}))
vi.mock('@/ee/workspace-forking/lib/mapping/block-map-store', () => ({
  loadForkBlockMap: mocks.loadForkBlockMap,
}))
vi.mock('@/ee/workspace-forking/lib/promote/promote-plan', () => ({
  computeForkPromotePlan: mocks.computeForkPromotePlan,
}))

import { GET } from '@/app/api/workspaces/[id]/fork/workflow-diff/route'

const { mockAuthorizeWorkspaceOperation } = workspaceAuthorizationMockFns
const mockGetSession = authMockFns.mockGetSession
permissionsMockFns.mockGetWorkspaceWithOwner.mockImplementation(async (id: string) => ({
  id,
  name: id,
  organizationId: null,
  allowPersonalApiKeys: true,
}))

const WORKSPACE_ID = 'child'
const routeContext = createRouteContext({ id: WORKSPACE_ID })
const BASE_URL = `http://localhost/api/workspaces/${WORKSPACE_ID}/fork/workflow-diff`

const emptyState = { blocks: {}, edges: [], loops: {}, parallels: {}, variables: {} }

function request(query: Record<string, string>) {
  const url = `${BASE_URL}?${new URLSearchParams(query).toString()}`
  return createMockRequest('GET', undefined, undefined, url)
}

describe('fork workflow-diff route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' }, session: { id: 'session-1' } })
    mockAuthorizeWorkspaceOperation.mockResolvedValue(undefined)
    workspaceForkingLineageMockFns.mockResolveForkEdge.mockResolvedValue({
      parentWorkspaceId: 'parent',
      childWorkspaceId: 'child',
    })
    mocks.loadForkBlockMap.mockResolvedValue({ parentToChild: new Map(), childToParent: new Map() })
    mocks.loadSourceDeployedStates.mockResolvedValue({
      deployedWorkflows: [{ id: 'wf-src' }],
      sourceStates: new Map([['wf-src', emptyState]]),
    })
    mocks.computeForkPromotePlan.mockResolvedValue({
      items: [
        {
          sourceWorkflowId: 'wf-src',
          targetWorkflowId: 'wf-tgt',
          mode: 'create',
          sourceMeta: { name: 'Ask Biz' },
        },
      ],
      archivedTargets: [],
    })
  })

  it('does not read any state when workspace authorization is refused', async () => {
    mockAuthorizeWorkspaceOperation.mockRejectedValue(
      new OrchestrationError('forbidden', 'Admin access required')
    )

    const response = await GET(
      request({ otherWorkspaceId: 'parent', direction: 'push', sourceWorkflowId: 'wf-src' }),
      routeContext
    )

    expect(response.status).toBe(403)
    expect(mocks.loadSourceDeployedStates).not.toHaveBeenCalled()
  })

  it('rejects a request without the source workflow id', async () => {
    const response = await GET(
      request({ otherWorkspaceId: 'parent', direction: 'push' }),
      routeContext
    )

    expect(response.status).toBe(400)
    expect(mocks.loadSourceDeployedStates).not.toHaveBeenCalled()
  })

  it('rejects workspaces that are not a direct fork edge without reading state', async () => {
    workspaceForkingLineageMockFns.mockResolveForkEdge.mockResolvedValue(null)

    const response = await GET(
      request({ otherWorkspaceId: 'parent', direction: 'push', sourceWorkflowId: 'wf-src' }),
      routeContext
    )

    expect(response.status).toBe(400)
    expect(mocks.loadSourceDeployedStates).not.toHaveBeenCalled()
  })

  it('maps a workflow outside the sync plan to 404', async () => {
    const response = await GET(
      request({ otherWorkspaceId: 'parent', direction: 'push', sourceWorkflowId: 'foreign' }),
      routeContext
    )

    expect(response.status).toBe(404)
  })

  it('returns the before and after states with their labels', async () => {
    const response = await GET(
      request({ otherWorkspaceId: 'parent', direction: 'push', sourceWorkflowId: 'wf-src' }),
      routeContext
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      targetWorkflowId: null,
      before: null,
      after: emptyState,
      beforeLabel: 'Ask Biz (current)',
      afterLabel: 'Ask Biz (deployed)',
    })
  })
})
