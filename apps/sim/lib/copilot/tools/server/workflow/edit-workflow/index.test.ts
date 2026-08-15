/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  authorizeWorkflowByWorkspacePermissionMock,
  applyOperationsToWorkflowStateMock,
  saveWorkflowToNormalizedTablesMock,
  assertWorkflowMutableMock,
  validateWorkflowStateMock,
  dbUpdateMock,
  dbSetMock,
  dbWhereMock,
} = vi.hoisted(() => {
  const dbWhereMock = vi.fn()
  const dbSetMock = vi.fn(() => ({ where: dbWhereMock }))
  const dbUpdateMock = vi.fn(() => ({ set: dbSetMock }))
  return {
    authorizeWorkflowByWorkspacePermissionMock: vi.fn(),
    applyOperationsToWorkflowStateMock: vi.fn(),
    saveWorkflowToNormalizedTablesMock: vi.fn(),
    assertWorkflowMutableMock: vi.fn(),
    validateWorkflowStateMock: vi.fn(),
    dbUpdateMock,
    dbSetMock,
    dbWhereMock,
  }
})

vi.mock('@sim/db', () => ({ db: { update: dbUpdateMock } }))
vi.mock('@sim/db/schema', () => ({
  workflow: { id: 'id', lastSynced: 'lastSynced', updatedAt: 'updatedAt' },
}))
vi.mock('drizzle-orm', () => ({ eq: vi.fn((left, right) => [left, right]) }))
vi.mock('@sim/platform-authz/workflow', () => ({
  assertWorkflowMutable: assertWorkflowMutableMock,
  authorizeWorkflowByWorkspacePermission: authorizeWorkflowByWorkspacePermissionMock,
}))
vi.mock('@/lib/billing/core/subscription', () => ({
  hasWorkspaceSandboxAccess: vi.fn(async () => true),
}))
vi.mock('@/lib/copilot/block-visibility', () => ({
  getBlockVisibilityForCopilot: vi.fn(async () => null),
}))
vi.mock('@/lib/copilot/sim-sandbox-projection', () => ({
  operationsReferenceSimSandbox: vi.fn(() => false),
}))
vi.mock('@/lib/core/config/env', () => ({ env: { INTERNAL_API_SECRET: 'internal-secret' } }))
vi.mock('@/lib/core/utils/urls', () => ({ getSocketServerUrl: () => 'http://socket.test' }))
vi.mock('@/lib/execution/remote-sandbox/workspace-sandboxes', () => ({
  MAX_PLAN_REQUIRED: 'Upgrade required',
}))
vi.mock('@/lib/workflows/autolayout', () => ({
  applyTargetedLayout: vi.fn((blocks) => blocks),
  getTargetedLayoutImpact: vi.fn(() => ({
    layoutBlockIds: [],
    resizedBlockIds: [],
    shiftSourceBlockIds: [],
  })),
  transferBlockHeights: vi.fn(),
}))
vi.mock('@/lib/workflows/persistence/custom-tools-persistence', () => ({
  extractAndPersistCustomTools: vi.fn(async () => ({ saved: 0, errors: [] })),
}))
vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadWorkflowFromNormalizedTables: vi.fn(),
  saveWorkflowToNormalizedTables: saveWorkflowToNormalizedTablesMock,
}))
vi.mock('@/lib/workflows/sanitization/validation', () => ({
  validateWorkflowState: validateWorkflowStateMock,
}))
vi.mock('@/blocks/visibility/server-context', () => ({
  withBlockVisibility: vi.fn(async (_visibility, execute) => execute()),
}))
vi.mock('@/ee/access-control/utils/permission-check', () => ({
  getUserPermissionConfig: vi.fn(async () => null),
}))
vi.mock('@/stores/workflows/workflow/utils', () => ({
  generateLoopBlocks: vi.fn(() => ({})),
  generateParallelBlocks: vi.fn(() => ({})),
}))
vi.mock('@/stores/workflows/workflow/validation', () => ({ normalizeWorkflowState: vi.fn() }))
vi.mock('./engine', () => ({
  applyOperationsToWorkflowState: applyOperationsToWorkflowStateMock,
}))
vi.mock('./lint', () => ({
  collectWorkflowFieldIssues: vi.fn(() => []),
  formatWorkflowLintMessage: vi.fn(() => ''),
  hasWorkflowLintIssues: vi.fn(() => false),
  lintEditedWorkflowState: vi.fn(() => ({
    sources: [],
    sinks: [],
    orphanBlocks: [],
    emptyOutgoingPorts: [],
    invalidBranchPorts: [],
    invalidConnectionTargets: [],
  })),
}))
vi.mock('./validation', () => ({
  collectUnresolvedAgentToolReferences: vi.fn(async () => []),
  collectUnresolvedReferences: vi.fn(async () => []),
  preValidateCredentialInputs: vi.fn(async (operations) => ({
    filteredOperations: operations,
    errors: [],
  })),
  UNRESOLVABLE_AT_LINT_NOTE: 'unresolvable',
}))

vi.unmock('@/blocks/registry')

import { editWorkflowServerTool } from './index'

const workflowState = {
  blocks: {
    request: {
      id: 'request',
      type: 'unknown-integration',
      name: 'Request',
      enabled: true,
      subBlocks: {
        apiKey: { id: 'apiKey', type: 'short-input', value: 'SENTINEL_API_KEY' },
        path: { id: 'path', type: 'short-input', value: '/users' },
      },
    },
  },
  edges: [],
  loops: {},
  parallels: {},
}

describe('editWorkflowServerTool secretless projection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 })) as typeof fetch
    authorizeWorkflowByWorkspacePermissionMock.mockResolvedValue({
      allowed: true,
      workflow: { id: 'workflow-1', name: 'Workflow', workspaceId: 'workspace-1' },
    })
    assertWorkflowMutableMock.mockResolvedValue(undefined)
    applyOperationsToWorkflowStateMock.mockImplementation((state) => ({
      state,
      validationErrors: [],
      skippedItems: [],
    }))
    validateWorkflowStateMock.mockImplementation((state) => ({
      valid: true,
      errors: [],
      warnings: [],
      sanitizedState: state,
    }))
    saveWorkflowToNormalizedTablesMock.mockResolvedValue({ success: true })
    dbWhereMock.mockResolvedValue(undefined)
  })

  async function execute(secretActorUserId?: string | null) {
    return editWorkflowServerTool.execute(
      {
        workflowId: 'workflow-1',
        currentUserWorkflow: JSON.stringify(workflowState),
        operations: [{ operation_type: 'edit', block_id: 'request', params: {} }],
      },
      {
        userId: 'key-creator',
        workspaceId: 'workspace-1',
        secretActorUserId,
      }
    ) as Promise<Record<string, any>>
  }

  it('redacts credentials from the returned state in secretless mode', async () => {
    const result = await execute(null)

    expect(result.workflowState.blocks.request.subBlocks.apiKey.value).toBeNull()
    expect(result.workflowState.blocks.request.subBlocks.path.value).toBe('/users')
    expect(JSON.stringify(result)).not.toContain('SENTINEL_API_KEY')
  })

  it('preserves the existing returned state for a user-backed chat', async () => {
    const result = await execute('user-1')

    expect(result.workflowState.blocks.request.subBlocks.apiKey.value).toBe('SENTINEL_API_KEY')
  })
})
