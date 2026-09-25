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

  it('runs saved draft state as a scoped Copilot actor without substituting the owner', async () => {
    const delegated = {
      kind: 'delegated' as const,
      serviceId: 'copilot' as const,
      subjectUserId: 'copilot-actor',
      workspaceId: context.workspaceId,
      audience: 'sim:workflows',
      delegationId: 'cli-call',
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    }
    await executeManualWorkflowOperation.execute({
      principal: delegated,
      input: { ...baseInput, useMockPayload: false, triggerBlockId: 'trigger-1' },
    })
    expect(mocks.executeService).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: delegated,
        userId: 'copilot-actor',
        workflowId: context.workflowId,
        useDraftState: true,
        triggerBlockId: 'trigger-1',
      })
    )
    const sourceSnapshot = {
      blockStates: {},
      executedBlocks: [],
      blockLogs: [],
      decisions: {},
      completedLoops: [],
      activeExecutionPath: [],
    }
    mocks.loadSourceState.mockResolvedValue(sourceSnapshot)
    await executeManualWorkflowFromBlockOperation.execute({
      principal: delegated,
      input: { ...baseInput, blockId: 'agent-1', sourceRunId: 'source-run' },
    })
    expect(mocks.loadSourceState).toHaveBeenCalledWith('source-run', context.workflowId)
    expect(mocks.executeService).toHaveBeenLastCalledWith(
      expect.objectContaining({
        principal: delegated,
        userId: 'copilot-actor',
        runFromBlock: { startBlockId: 'agent-1', sourceSnapshot, sourceExecutionId: 'source-run' },
      })
    )
  })

  it('rejects wrong workspace, audience, expired delegation, and non-Copilot service', async () => {
    const base = {
      kind: 'delegated',
      serviceId: 'copilot',
      subjectUserId: 'actor',
      workspaceId: context.workspaceId,
      audience: 'sim:workflows',
      delegationId: 'call',
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    } as const
    for (const principal of [
      { ...base, workspaceId: 'foreign' },
      { ...base, audience: 'sim:settings' },
      { ...base, expiresAt: new Date(0) },
      { ...base, serviceId: 'executor' },
    ]) {
      await expect(
        executeManualWorkflowOperation.execute({
          principal: principal as never,
          input: { ...baseInput, useMockPayload: false },
        })
      ).rejects.toThrow()
      await expect(
        executeManualWorkflowFromBlockOperation.execute({
          principal: principal as never,
          input: { ...baseInput, blockId: 'agent-1', sourceRunId: 'source-run' },
        })
      ).rejects.toThrow()
    }
    expect(mocks.executeService).not.toHaveBeenCalled()
    expect(mocks.loadManualState).not.toHaveBeenCalled()
  })

  it('requires current write access for delegated manual execution', async () => {
    const principal = {
      kind: 'delegated',
      serviceId: 'copilot',
      subjectUserId: 'actor',
      workspaceId: context.workspaceId,
      audience: 'sim:workflows',
      delegationId: 'call',
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    } as const
    mocks.permission.mockResolvedValue('read')
    await expect(
      executeManualWorkflowOperation.execute({
        principal,
        input: { ...baseInput, useMockPayload: false },
      })
    ).rejects.toThrow()
    expect(mocks.executeService).not.toHaveBeenCalled()
  })

  it('still refuses workspace API keys for manual block entry', async () => {
    await expect(
      executeManualWorkflowFromBlockOperation.execute({
        principal: {
          kind: 'workspace_api_key',
          workspaceId: context.workspaceId,
          keyId: 'workspace-key',
        } as never,
        input: { ...baseInput, blockId: 'agent-1', sourceRunId: 'source-run' },
      })
    ).rejects.toThrow()
    expect(mocks.resolveContext).not.toHaveBeenCalled()
    expect(mocks.executeService).not.toHaveBeenCalled()
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
})
