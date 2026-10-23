import {
  auditMock,
  authMockFns,
  createMockRequest,
  dbChainMockFns,
  resetDbChainMock,
} from '@sim/testing'
import { createRouteContext } from '@sim/testing/helpers/http'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import {
  workspaceAuthorizationMock,
  workspaceAuthorizationMockFns,
} from '@sim/testing/mocks/workspace-authorization.mock'
import {
  workspaceForkingAuthzMock,
  workspaceForkingAuthzMockFns,
} from '@sim/testing/mocks/workspace-forking-authz.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/ee/workspace-forking/lib/lineage/authz', () => workspaceForkingAuthzMock)

vi.mock('@/lib/core/application/workspace-authorization', () => workspaceAuthorizationMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/posthog/server', () => posthogServerMock)

import { PUT } from '@/app/api/workspaces/[id]/fork/excluded-workflows/route'

const { mockAuthorizeWorkspaceOperation } = workspaceAuthorizationMockFns
const { mockAssertForkingEnabled } = workspaceForkingAuthzMockFns

const mockGetSession = authMockFns.mockGetSession
permissionsMockFns.mockGetWorkspaceWithOwner.mockImplementation(async (id: string) => ({
  id,
  name: 'My Workspace',
  organizationId: null,
  allowPersonalApiKeys: true,
}))

const WORKSPACE_ID = 'workspace-1'
const ADMIN_ID = 'user-1'
const routeContext = createRouteContext({ id: WORKSPACE_ID })

function mockUpdateReturning(rows: Array<{ id: string; name: string }>) {
  dbChainMockFns.returning.mockResolvedValue(rows)
}

describe('fork excluded-workflows route', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockGetSession.mockResolvedValue({ user: { id: ADMIN_ID }, session: { id: 'session-1' } })
    mockAuthorizeWorkspaceOperation.mockResolvedValue(undefined)
    mockUpdateReturning([])
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('requires workspace admin (and the fork entitlement gate) before writing', async () => {
    mockUpdateReturning([{ id: 'wf-1', name: 'Alpha' }])

    await PUT(
      createMockRequest('PUT', { workflowIds: ['wf-1'], forkSyncExcluded: true }),
      routeContext
    )

    expect(mockAuthorizeWorkspaceOperation).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'session', userId: ADMIN_ID }),
      expect.objectContaining({ id: 'workspaces.fork.exclusions', minimumRole: 'admin' }),
      expect.objectContaining({ workspaceId: WORKSPACE_ID }),
      { delegation: { audience: 'sim:workspaces', isWithinScope: expect.any(Function) } }
    )
    expect(mockAssertForkingEnabled).toHaveBeenCalledWith(null)
    expect(mockAssertForkingEnabled.mock.invocationCallOrder[0]).toBeLessThan(
      dbChainMockFns.update.mock.invocationCallOrder[0]
    )
  })
})
