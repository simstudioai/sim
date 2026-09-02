/**
 * @vitest-environment node
 *
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
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadWorkspace: vi.fn(),
  resolvePermission: vi.fn(),
  resolveWorkflowContext: vi.fn(),
  listExecutions: vi.fn(),
  recordAudit: vi.fn(),
}))

vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)

vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadActiveWorkspaceApplicationContext: mocks.loadWorkspace,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (permission: string | null, required: string) =>
    permission === 'admin' || permission === 'write' || permission === required,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/workflows/application/context', () => ({
  resolveActiveWorkflowApplicationContext: mocks.resolveWorkflowContext,
}))

vi.mock('@/lib/workflows/executor/execution-queries', () => ({
  listWorkflowExecutions: mocks.listExecutions,
}))

vi.mock('@sim/audit', () => ({ recordAudit: mocks.recordAudit }))

import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { listWorkflowRuns } from '@/lib/workflows/application/list-workflow-runs'

const WORKSPACE_ID = 'workspace-1'
const WORKFLOW_ID = 'workflow-1'

const sessionPrincipal = { kind: 'session' as const, userId: 'user-1' }
const workspaceKeyPrincipal = {
  kind: 'workspace_api_key' as const,
  workspaceId: WORKSPACE_ID,
  keyId: 'key-1',
}

const input = { workflowId: WORKFLOW_ID, limit: 10, order: 'desc' as const }

function runRow(costTotal: string | null) {
  return { rowId: 1, executionId: 'run-1', startedAt: new Date(), status: 'success', costTotal }
}

beforeEach(() => {
  vi.clearAllMocks()
  resetPermissionGroupScopeMock()
  mocks.loadWorkspace.mockResolvedValue({
    workspaceId: WORKSPACE_ID,
    workspaceOrganizationId: 'organization-1',
    allowPersonalApiKeys: true,
    billedAccountUserId: 'billing-owner-1',
  })
  mocks.resolvePermission.mockResolvedValue('admin')
  mocks.resolveWorkflowContext.mockResolvedValue({
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

  it('returns the total when the group withholds nothing', async () => {
    permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
    })

    const result = await listWorkflowRuns.execute({ principal: sessionPrincipal, input })

    expect(result.data[0].costTotal).toBe('0.75')
  })

  it('returns the total when no group governs the caller', async () => {
    const result = await listWorkflowRuns.execute({ principal: sessionPrincipal, input })

    expect(result.data[0].costTotal).toBe('0.75')
  })

  it('withholds nothing from a workspace API key, and never resolves a group', async () => {
    const result = await listWorkflowRuns.execute({ principal: workspaceKeyPrincipal, input })

    expect(result.data[0].costTotal).toBe('0.75')
    expect(permissionGroupScopeMockFns.mockResolvePermissionGroupConfig).not.toHaveBeenCalled()
  })
})
