import { authMockFns, createMockRequest } from '@sim/testing'
import { createRouteContext } from '@sim/testing/helpers/http'
import { customBlockOperationsMock } from '@sim/testing/mocks/custom-block-operations.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  createMockWorkspaceApplicationContext,
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)

vi.mock('@/lib/workflows/custom-blocks/operations', () => customBlockOperationsMock)

import { GET } from '@/app/api/custom-blocks/[id]/usages/route'

const mockGetSession = authMockFns.mockGetSession
const mockOperations = customBlockOperationsMock
const mockResolvePermission = workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission
workspaceContextMockFns.mockLoadWorkspaceApplicationContext.mockImplementation(
  async (workspaceId: string) =>
    createMockWorkspaceApplicationContext({ workspaceId, workspaceOrganizationId: 'org-1' })
)

const MANAGE_CONTEXT = {
  organizationId: 'org-1',
  sourceWorkspaceId: 'ws-1',
  type: 'custom_block_abc123',
  name: 'Invoice Parser',
}

const USAGE_COUNTS = { usageCount: 3, deployedUsageCount: 2 }

function callRoute(id = 'cb-1') {
  return GET(createMockRequest('GET'), createRouteContext({ id }))
}

describe('GET /api/custom-blocks/[id]/usages', () => {
  beforeEach(() => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' }, session: { id: 'session-1' } })
    mockResolvePermission.mockResolvedValue('admin')
    mockOperations.getCustomBlockManageContext.mockResolvedValue(MANAGE_CONTEXT)
    mockOperations.getCustomBlockUsageCounts.mockResolvedValue(USAGE_COUNTS)
    mockOperations.isCustomBlocksDeploymentEnabled.mockReturnValue(true)
  })

  it('conceals a block in an inaccessible workspace', async () => {
    mockResolvePermission.mockResolvedValue(null)
    const response = await callRoute()
    expect(response.status).toBe(404)
    expect(mockOperations.getCustomBlockUsageCounts).not.toHaveBeenCalled()
  })

  it('returns 403 for a non-admin of the source workspace', async () => {
    mockResolvePermission.mockResolvedValue('read')
    const response = await callRoute()
    expect(response.status).toBe(403)
    expect(mockOperations.getCustomBlockUsageCounts).not.toHaveBeenCalled()
  })

  it('conceals internal orchestration diagnostics', async () => {
    mockOperations.getCustomBlockUsageCounts.mockRejectedValue(
      new OrchestrationError('internal', 'Database driver diagnostic')
    )
    const response = await callRoute()
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Internal server error' })
  })
})
