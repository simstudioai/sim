/**
 * @vitest-environment node
 */
import { queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUserPermissionConfig: vi.fn(),
  performCreateWorkflow: vi.fn(),
  performCreateWorkflowTransition: vi.fn(),
  saveWorkflowToNormalizedTables: vi.fn(),
  extractAndPersistCustomTools: vi.fn(),
}))

vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfig: mocks.getUserPermissionConfig,
}))
vi.mock('@/lib/workflows/orchestration', () => ({
  performCreateWorkflow: mocks.performCreateWorkflow,
  performCreateWorkflowTransition: mocks.performCreateWorkflowTransition,
}))
vi.mock('@/lib/workflows/persistence/utils', () => ({
  saveWorkflowToNormalizedTables: mocks.saveWorkflowToNormalizedTables,
}))
vi.mock('@/lib/workflows/persistence/custom-tools-persistence', () => ({
  extractAndPersistCustomTools: mocks.extractAndPersistCustomTools,
}))

import { importWorkflowIntoWorkspace } from '@/lib/workflows/operations/import-workflow'

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
    requestId: 'request-1',
    workflow: workflowPayload,
  }
}

describe('importWorkflowIntoWorkspace block access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    queueTableRows(schemaMock.workspace, [{ id: 'workspace-1' }])
    mocks.getUserPermissionConfig.mockResolvedValue(null)
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
    mocks.saveWorkflowToNormalizedTables.mockResolvedValue({ success: true })
    mocks.extractAndPersistCustomTools.mockResolvedValue({ saved: 0, errors: [] })
  })

  /**
   * The bypass this closes: import never went through the editing operations,
   * so a denied integration reached the normalized tables and was refused only
   * at run time, if ever.
   */
  it('refuses a payload carrying a block type the permission group withholds', async () => {
    mocks.getUserPermissionConfig.mockResolvedValue({ allowedIntegrations: ['slack'] })

    const result = await importWorkflowIntoWorkspace(
      params(payload(block('b1', 'slack'), block('b2', 'gmail')))
    )

    expect(result).toMatchObject({ success: false, status: 403 })
    expect(result.success === false && result.error).toContain('gmail')
  })

  /** Nothing may be written before the refusal, or the caller is left an orphan. */
  it('refuses before any workflow row is created', async () => {
    mocks.getUserPermissionConfig.mockResolvedValue({ allowedIntegrations: ['slack'] })

    await importWorkflowIntoWorkspace(params(payload(block('b1', 'gmail'))))

    expect(mocks.performCreateWorkflow).not.toHaveBeenCalled()
    expect(mocks.saveWorkflowToNormalizedTables).not.toHaveBeenCalled()
  })

  it('imports a payload whose block types the allowlist names', async () => {
    mocks.getUserPermissionConfig.mockResolvedValue({ allowedIntegrations: ['slack'] })

    const result = await importWorkflowIntoWorkspace(params(payload(block('b1', 'slack'))))

    expect(result.success).toBe(true)
    expect(mocks.performCreateWorkflow).toHaveBeenCalledOnce()
  })
})
