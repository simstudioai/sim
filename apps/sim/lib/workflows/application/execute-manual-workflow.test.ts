/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  executeService: vi.fn(),
  loadManualState: vi.fn(),
  loadSourceState: vi.fn(),
  permission: vi.fn(),
  resolveContext: vi.fn(),
  resolveOptions: vi.fn(),
  validateInput: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: mocks.permission,
}))

vi.mock('@sim/workflow-persistence/subblocks', () => ({
  mergeSubblockStateWithValues: vi.fn((blocks) => blocks),
}))

vi.mock('@/lib/workflows/application/context', () => ({
  resolveActiveWorkflowApplicationContext: mocks.resolveContext,
}))

vi.mock('@/lib/workflows/executor/execute-service', () => ({
  executeWorkflowService: mocks.executeService,
}))

vi.mock('@/lib/workflows/executor/execution-state', () => ({
  getExecutionStateForWorkflow: mocks.loadSourceState,
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadWorkflowFromNormalizedTables: mocks.loadManualState,
}))

vi.mock('@/lib/workflows/triggers/run-options', () => ({
  resolveTriggerRunOptions: mocks.resolveOptions,
  validateTriggerInput: mocks.validateInput,
}))

import {
  executeManualWorkflowFromBlockOperation,
  executeManualWorkflowOperation,
} from '@/lib/workflows/application/execute-manual-workflow'

const principal = {
  kind: 'personal_api_key' as const,
  userId: 'user-1',
  keyId: 'personal-key-1',
}

const context = {
  workflowId: 'workflow-1',
  workflow: {
    id: 'workflow-1',
    userId: 'owner-1',
    workspaceId: 'workspace-1',
    variables: {},
  },
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}

const baseInput = {
  workflowId: 'workflow-1',
  requestId: 'request-1',
  input: { event: 'created' },
  mode: 'sync' as const,
  requestHeaders: new Headers(),
}

const triggerOption = {
  triggerBlockId: 'trigger-1',
  blockName: 'Slack Trigger',
  triggerType: 'slack_webhook',
  mockPayload: { event: 'mock' },
}

describe('manual workflow execution application operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContext.mockResolvedValue(context)
    mocks.permission.mockResolvedValue('write')
    mocks.loadManualState.mockResolvedValue({
      blocks: { 'trigger-1': {}, 'agent-1': {} },
      edges: [],
    })
    mocks.resolveOptions.mockReturnValue([triggerOption])
    mocks.validateInput.mockReturnValue({ ok: true })
    mocks.executeService.mockResolvedValue({
      ok: true,
      executionId: 'run-1',
      workflowId: 'workflow-1',
      status: 'completed',
      aborted: null,
      output: {},
      error: null,
      hasResponseBlock: false,
    })
  })

  it('selects the only manual trigger and sends trusted saved-state controls to the service', async () => {
    await executeManualWorkflowOperation.execute({
      principal,
      input: { ...baseInput, useMockPayload: false },
    })

    expect(mocks.executeService).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'workflow-1',
        principal,
        userId: 'user-1',
        input: { event: 'created' },
        triggerType: 'manual',
        triggerBlockId: 'trigger-1',
        useDraftState: true,
        mode: 'sync',
        useAuthenticatedUserAsActor: true,
      })
    )
  })

  it('requires an explicit block id when the workflow has multiple runnable triggers', async () => {
    mocks.resolveOptions.mockReturnValue([
      triggerOption,
      { ...triggerOption, triggerBlockId: 'trigger-2', blockName: 'API Trigger' },
    ])

    await expect(
      executeManualWorkflowOperation.execute({
        principal,
        input: { ...baseInput, triggerBlockId: undefined, useMockPayload: false },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.executeService).not.toHaveBeenCalled()
  })

  it('uses only the server-derived mock payload when requested', async () => {
    await executeManualWorkflowOperation.execute({
      principal,
      input: {
        ...baseInput,
        input: undefined,
        useMockPayload: true,
      },
    })

    expect(mocks.validateInput).toHaveBeenCalledWith(triggerOption, { event: 'mock' })
    expect(mocks.executeService).toHaveBeenCalledWith(
      expect.objectContaining({ input: { event: 'mock' } })
    )
  })

  it('rejects input combined with a mock payload before loading saved state', async () => {
    await expect(
      executeManualWorkflowOperation.execute({
        principal,
        input: { ...baseInput, useMockPayload: true },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.loadManualState).not.toHaveBeenCalled()
    expect(mocks.executeService).not.toHaveBeenCalled()
  })

  it('fails before execution when trigger input is invalid', async () => {
    mocks.validateInput.mockReturnValueOnce({ ok: false, error: 'event payload is required' })

    await expect(
      executeManualWorkflowOperation.execute({
        principal,
        input: { ...baseInput, input: undefined, useMockPayload: false },
      })
    ).rejects.toMatchObject({ code: 'validation', message: 'event payload is required' })
    expect(mocks.executeService).not.toHaveBeenCalled()
  })

  it('resolves the exact same-workflow source snapshot for a block entry', async () => {
    const sourceSnapshot = {
      blockStates: {},
      executedBlocks: [],
      blockLogs: [],
      decisions: {},
      completedLoops: [],
      activeExecutionPath: [],
    }
    mocks.loadSourceState.mockResolvedValueOnce(sourceSnapshot)

    await executeManualWorkflowFromBlockOperation.execute({
      principal,
      input: { ...baseInput, blockId: 'agent-1', sourceRunId: 'source-run-1' },
    })

    expect(mocks.loadSourceState).toHaveBeenCalledWith('source-run-1', 'workflow-1')
    expect(mocks.executeService).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerType: 'manual',
        useDraftState: true,
        runFromBlock: {
          startBlockId: 'agent-1',
          sourceSnapshot,
          sourceExecutionId: 'source-run-1',
        },
      })
    )
  })

  it('rejects a block that is not in the current saved workflow before reading source state', async () => {
    await expect(
      executeManualWorkflowFromBlockOperation.execute({
        principal,
        input: { ...baseInput, blockId: 'missing', sourceRunId: 'source-run-1' },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.loadSourceState).not.toHaveBeenCalled()
  })

  it('rejects a source run without persisted state for this workflow', async () => {
    mocks.loadSourceState.mockResolvedValueOnce(null)

    await expect(
      executeManualWorkflowFromBlockOperation.execute({
        principal,
        input: { ...baseInput, blockId: 'agent-1', sourceRunId: 'source-run-1' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.executeService).not.toHaveBeenCalled()
  })

  it('rejects workspace keys before canonical workflow loading', async () => {
    await expect(
      executeManualWorkflowOperation.execute({
        principal: {
          kind: 'workspace_api_key',
          workspaceId: 'workspace-1',
          keyId: 'workspace-key-1',
        },
        input: { ...baseInput, useMockPayload: false },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.resolveContext).not.toHaveBeenCalled()
  })

  it('requires current write permission before loading saved state', async () => {
    mocks.permission.mockResolvedValueOnce('read')

    await expect(
      executeManualWorkflowOperation.execute({
        principal,
        input: { ...baseInput, useMockPayload: false },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.loadManualState).not.toHaveBeenCalled()
  })
})
