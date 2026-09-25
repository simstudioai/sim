/**
 * `logs.cost` is a PROJECTION, not a gate — a group withholds the figure from
 * the response rather than refusing the read, which is why `workflows.listRuns`
 * correctly declares `capability: 'none'`.
 *
 * This listing carries the same per-run total every other log surface withholds,
 * and applied none of it: an enterprise member whose group hides spend read it
 * in full here through a personal API key. These run the real use case against
 * the real `resolveLogFieldProjection`, so they fail if this surface stops
 * projecting.
 */
import {
  permissionGroupScopeMock,
  permissionGroupScopeMockFns,
  resetPermissionGroupScopeMock,
} from '@sim/testing'
import { createWorkspaceApiKeyPrincipal } from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import {
  workflowContextMock,
  workflowContextMockFns,
} from '@sim/testing/mocks/workflow-context.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listExecutions: vi.fn(),
}))

vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)

vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/workflows/application/context', () => workflowContextMock)

vi.mock('@/lib/workflows/executor/execution-queries', () => ({
  listWorkflowExecutions: mocks.listExecutions,
}))

vi.mock('@sim/audit', () => auditMock)

import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { listWorkflowRuns } from '@/lib/workflows/application/list-workflow-runs'

const mockLoadWorkspace = workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext
const mockResolvePermission = workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission
const mockRecordAudit = auditMockFns.mockRecordAudit

const WORKSPACE_ID = 'workspace-1'
const WORKFLOW_ID = 'workflow-1'

const sessionPrincipal = { kind: 'session' as const, userId: 'user-1' }
const workspaceKeyPrincipal = createWorkspaceApiKeyPrincipal({ workspaceId: WORKSPACE_ID })

const input = { workflowId: WORKFLOW_ID, limit: 10, order: 'desc' as const }

function runRow(costTotal: string | null) {
  return { rowId: 1, executionId: 'run-1', startedAt: new Date(), status: 'success', costTotal }
}

beforeEach(() => {
  resetPermissionGroupScopeMock()
  mockLoadWorkspace.mockResolvedValue({
    workspaceId: WORKSPACE_ID,
    workspaceOrganizationId: 'organization-1',
    allowPersonalApiKeys: true,
    billedAccountUserId: 'billing-owner-1',
  })
  mockResolvePermission.mockResolvedValue('admin')
  workflowContextMockFns.mockResolveActiveWorkflowApplicationContext.mockResolvedValue({
    workspaceId: WORKSPACE_ID,
    workspaceOrganizationId: 'organization-1',
    allowPersonalApiKeys: true,
    billedAccountUserId: 'billing-owner-1',
    workflowId: WORKFLOW_ID,
  })
  mocks.listExecutions.mockResolvedValue({ data: [runRow('0.75')], nextCursor: null })
  permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue(null)
})

describe('listWorkflowRuns cost projection', () => {
  it('blanks the per-run total when the group hides cost', async () => {
    permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      hideCostInfo: true,
    })

    const result = await listWorkflowRuns.execute({ principal: sessionPrincipal, input })

    expect(result.data[0].costTotal).toBeNull()
  })

  it('withholds nothing from a workspace API key, and never resolves a group', async () => {
    const result = await listWorkflowRuns.execute({ principal: workspaceKeyPrincipal, input })

    expect(result.data[0].costTotal).toBe('0.75')
    expect(permissionGroupScopeMockFns.mockResolvePermissionGroupConfig).not.toHaveBeenCalled()
  })
})
