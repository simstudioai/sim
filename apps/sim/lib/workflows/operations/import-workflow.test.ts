import { queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import {
  permissionGroupsResolveMock,
  permissionGroupsResolveMockFns,
} from '@sim/testing/mocks/permission-groups-resolve.mock'
import {
  workflowsOrchestrationMock,
  workflowsOrchestrationMockFns,
} from '@sim/testing/mocks/workflows-orchestration.mock'
import {
  workflowsPersistenceUtilsMock,
  workflowsPersistenceUtilsMockFns,
} from '@sim/testing/mocks/workflows-persistence-utils.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  extractAndPersistCustomTools: vi.fn(),
}))

vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)
vi.mock('@/lib/workflows/orchestration', () => workflowsOrchestrationMock)
vi.mock('@/lib/workflows/persistence/utils', () => workflowsPersistenceUtilsMock)
vi.mock('@/lib/workflows/persistence/custom-tools-persistence', () => ({
  extractAndPersistCustomTools: hoisted.extractAndPersistCustomTools,
}))

import { importWorkflowIntoWorkspace } from '@/lib/workflows/operations/import-workflow'

const mocks = {
  ...hoisted,
  performCreateWorkflow: workflowsOrchestrationMockFns.mockPerformCreateWorkflow,
  performCreateWorkflowTransition:
    workflowsOrchestrationMockFns.mockPerformCreateWorkflowTransition,
}

const mockGetUserPermissionConfig = permissionGroupsResolveMockFns.mockGetUserPermissionConfig
const mockSaveWorkflowToNormalizedTables =
  workflowsPersistenceUtilsMockFns.mockSaveWorkflowToNormalizedTables

function block(id: string, type: string) {
  return {
    id,
    type,
    name: id,
    position: { x: 0, y: 0 },
    subBlocks: {},
    outputs: {},
    enabled: true,
  }
}

function payload(...blocks: ReturnType<typeof block>[]) {
  return {
    blocks: Object.fromEntries(blocks.map((entry) => [entry.id, entry])),
    edges: [],
    loops: {},
    parallels: {},
  }
}

function params(workflowPayload: Record<string, unknown>) {
  return {
    workspaceId: 'workspace-1',
    userId: 'user-1',
    capabilityUserId: 'user-1',
    requestId: 'request-1',
    workflow: workflowPayload,
  }
}

describe('importWorkflowIntoWorkspace block access', () => {
  beforeEach(() => {
    resetDbChainMock()
    queueTableRows(schemaMock.workspace, [{ id: 'workspace-1' }])
    mockGetUserPermissionConfig.mockResolvedValue(null)
    mocks.performCreateWorkflow.mockResolvedValue({
      success: true,
      workflow: {
        id: 'workflow-1',
        name: 'Imported Workflow',
        description: null,
        folderId: null,
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    })
    mockSaveWorkflowToNormalizedTables.mockResolvedValue({ success: true })
    mocks.extractAndPersistCustomTools.mockResolvedValue({ saved: 0, errors: [] })
  })

  /**
   * The bypass this closes: import never went through the editing operations,
   * so a denied integration reached the normalized tables and was refused only
   * at run time, if ever.
   */
  it('refuses a payload carrying a block type the permission group withholds', async () => {
    mockGetUserPermissionConfig.mockResolvedValue({ allowedIntegrations: ['slack'] })

    const result = await importWorkflowIntoWorkspace(
      params(payload(block('b1', 'slack'), block('b2', 'gmail')))
    )

    expect(result).toMatchObject({ success: false, status: 403 })
    expect(result.success === false && result.error).toContain('gmail')
  })

  /** Nothing may be written before the refusal, or the caller is left an orphan. */
  it('refuses before any workflow row is created', async () => {
    mockGetUserPermissionConfig.mockResolvedValue({ allowedIntegrations: ['slack'] })

    await importWorkflowIntoWorkspace(params(payload(block('b1', 'gmail'))))

    expect(mocks.performCreateWorkflow).not.toHaveBeenCalled()
    expect(mockSaveWorkflowToNormalizedTables).not.toHaveBeenCalled()
  })

  /**
   * `workflows.import` allows a workspace API key, which has no user and so no
   * permission group. The attribution field still names someone — the billing
   * owner, or the key's creator — and judging the payload against that
   * bystander's allowlist is what this separates.
   */
  it('judges no allowlist for a caller no permission group governs', async () => {
    mockGetUserPermissionConfig.mockResolvedValue({ allowedIntegrations: ['slack'] })

    const result = await importWorkflowIntoWorkspace({
      ...params(payload(block('b1', 'gmail'))),
      capabilityUserId: null,
    })

    expect(result.success).toBe(true)
    expect(mockGetUserPermissionConfig).not.toHaveBeenCalled()
  })
})
