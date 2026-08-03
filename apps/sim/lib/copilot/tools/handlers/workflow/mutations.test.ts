/**
 * @vitest-environment node
 */
import {
  dbChainMock,
  requestUtilsMockFns,
  resetEnvMock,
  schemaMock,
  setEnv,
  workflowAuthzMockFns,
} from '@sim/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

beforeAll(() => {
  setEnv({ INTERNAL_API_SECRET: 'secret', SOCKET_SERVER_URL: 'http://socket.test' })
  requestUtilsMockFns.mockGenerateRequestId.mockReturnValue('request-1')
})

afterAll(() => {
  resetEnvMock()
  requestUtilsMockFns.mockGenerateRequestId.mockReset()
})

import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import type { ExecutionContext } from '@/lib/copilot/request/types'
import {
  ANONYMOUS_SECRET_TRACE_REPLACEMENT,
  ResolvedSecretTraceRegistry,
} from '@/executor/utils/resolved-secret-trace-registry'

const {
  ensureWorkflowAccessMock,
  ensureWorkspaceAccessMock,
  setWorkflowVariablesMock,
  recordAuditMock,
  performCreateWorkflowMock,
  executeWorkflowMock,
  getExecutionStateForWorkflowMock,
  getLatestExecutionStateWithExecutionIdMock,
  loadWorkflowFromNormalizedTablesMock,
  resolveBillingAttributionMock,
  resolveTriggerRunOptionsMock,
  checkAttributedUsageLimitsMock,
  reserveExecutionSlotMock,
  releaseExecutionSlotMock,
  decryptSecretMock,
} = vi.hoisted(() => ({
  ensureWorkflowAccessMock: vi.fn(),
  ensureWorkspaceAccessMock: vi.fn(),
  setWorkflowVariablesMock: vi.fn(),
  recordAuditMock: vi.fn(),
  performCreateWorkflowMock: vi.fn(),
  executeWorkflowMock: vi.fn(),
  getExecutionStateForWorkflowMock: vi.fn(),
  getLatestExecutionStateWithExecutionIdMock: vi.fn(),
  loadWorkflowFromNormalizedTablesMock: vi.fn(),
  resolveBillingAttributionMock: vi.fn(),
  resolveTriggerRunOptionsMock: vi.fn(),
  checkAttributedUsageLimitsMock: vi.fn(),
  reserveExecutionSlotMock: vi.fn(),
  releaseExecutionSlotMock: vi.fn(),
  decryptSecretMock: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { WORKFLOW_VARIABLES_UPDATED: 'WORKFLOW_VARIABLES_UPDATED' },
  AuditResourceType: { WORKFLOW: 'WORKFLOW' },
  recordAudit: recordAuditMock,
}))

vi.mock('@sim/db', () => ({ ...dbChainMock, ...schemaMock }))

vi.mock('@/lib/api-key/orchestration', () => ({
  performCreateWorkspaceApiKey: vi.fn(),
}))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  checkAttributedUsageLimits: checkAttributedUsageLimitsMock,
  resolveBillingAttribution: resolveBillingAttributionMock,
}))

vi.mock('@/lib/billing/calculations/usage-reservation', () => ({
  releaseExecutionSlot: releaseExecutionSlotMock,
  reserveExecutionSlot: reserveExecutionSlotMock,
  UsageReservationUnavailableError: class UsageReservationUnavailableError extends Error {},
}))

vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: decryptSecretMock,
  encryptSecret: vi.fn(),
}))

vi.mock('@/lib/workflows/executor/execute-workflow', () => ({
  executeWorkflow: executeWorkflowMock,
}))

vi.mock('@/lib/workflows/executor/execution-state', () => ({
  getExecutionStateForWorkflow: getExecutionStateForWorkflowMock,
  getLatestExecutionStateWithExecutionId: getLatestExecutionStateWithExecutionIdMock,
}))

vi.mock('@/lib/workflows/orchestration', () => ({
  performCreateFolder: vi.fn(),
  performCreateWorkflow: performCreateWorkflowMock,
  performDeleteFolder: vi.fn(),
  performDeleteWorkflow: vi.fn(),
  performUpdateFolder: vi.fn(),
  performUpdateWorkflow: vi.fn(),
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadWorkflowFromNormalizedTables: loadWorkflowFromNormalizedTablesMock,
  saveWorkflowToNormalizedTables: vi.fn(),
}))

vi.mock('@/lib/workflows/sanitization/json-sanitizer', () => ({
  sanitizeForCopilot: vi.fn((state) => state),
}))

vi.mock('@/lib/workflows/triggers/run-options', () => ({
  resolveTriggerRunOptions: resolveTriggerRunOptionsMock,
  validateTriggerInput: vi.fn(),
}))

vi.mock('@/lib/workflows/utils', () => ({
  listFolders: vi.fn(),
  setWorkflowVariables: setWorkflowVariablesMock,
  verifyFolderWorkspace: vi.fn(),
}))

vi.mock('@/executor/utils/errors', () => ({
  hasExecutionResult: vi.fn(() => false),
}))

vi.mock('../access', () => ({
  ensureWorkflowAccess: ensureWorkflowAccessMock,
  ensureWorkspaceAccess: ensureWorkspaceAccessMock,
  getDefaultWorkspaceId: vi.fn(),
}))

import { projectToolResultForCopilot } from '@/lib/copilot/request/tools/resolved-secret-result'
import { applyCreateWorkflowOutputToContext } from '@/lib/copilot/request/tools/workflow-context'
import { performUpdateWorkflow } from '@/lib/workflows/orchestration'
import { listFolders, verifyFolderWorkspace } from '@/lib/workflows/utils'
import {
  executeCreateWorkflow,
  executeMoveWorkflow,
  executeRunBlock,
  executeRunFromBlock,
  executeRunWorkflow,
  executeRunWorkflowUntilBlock,
  executeSetGlobalWorkflowVariables,
} from './mutations'

const performUpdateWorkflowMock = vi.mocked(performUpdateWorkflow)
const listFoldersMock = vi.mocked(listFolders)
const verifyFolderWorkspaceMock = vi.mocked(verifyFolderWorkspace)
const billingAttribution: BillingAttributionSnapshot = {
  actorUserId: 'user-1',
  workspaceId: 'workspace-1',
  organizationId: null,
  billedAccountUserId: 'owner-1',
  billingEntity: { type: 'user', id: 'owner-1' },
  billingPeriod: {
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-08-01T00:00:00.000Z',
  },
  payerSubscription: null,
}
const childBillingAttribution: BillingAttributionSnapshot = Object.freeze({
  actorUserId: 'user-1',
  workspaceId: 'workspace-2',
  organizationId: 'organization-2',
  billedAccountUserId: 'owner-2',
  billingEntity: { type: 'organization', id: 'organization-2' },
  billingPeriod: {
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-08-01T00:00:00.000Z',
  },
  payerSubscription: null,
})
const executionContext: ExecutionContext = {
  userId: 'user-1',
  workflowId: 'workflow-1',
  workspaceId: 'workspace-1',
  billingAttribution,
}

describe('executeSetGlobalWorkflowVariables', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 })) as typeof fetch
    ensureWorkflowAccessMock.mockResolvedValue({
      workflow: {
        id: 'workflow-1',
        variables: {},
      },
    })
    setWorkflowVariablesMock.mockResolvedValue(undefined)
  })

  it('persists variable changes and notifies clients that workflow state changed', async () => {
    const result = await executeSetGlobalWorkflowVariables(
      {
        workflowId: 'workflow-1',
        operations: [{ operation: 'add', name: 'threshold', type: 'number', value: '5' }],
      },
      { userId: 'user-1' } as any
    )

    expect(result.success).toBe(true)
    const [, variables] = setWorkflowVariablesMock.mock.calls[0]
    expect(Object.values(variables)).toEqual([
      expect.objectContaining({
        workflowId: 'workflow-1',
        name: 'threshold',
        type: 'number',
        value: 5,
      }),
    ])
    expect(global.fetch).toHaveBeenCalledWith('http://socket.test/api/workflow-updated', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'secret',
      },
      body: JSON.stringify({ workflowId: 'workflow-1' }),
    })
    expect(recordAuditMock).toHaveBeenCalled()
  })
})

describe('lock enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 })) as typeof fetch
    workflowAuthzMockFns.mockAssertWorkflowMutable.mockResolvedValue(undefined)
    workflowAuthzMockFns.mockAssertFolderMutable.mockResolvedValue(undefined)
  })

  it('does not persist variable changes when the workflow is locked', async () => {
    ensureWorkflowAccessMock.mockResolvedValue({
      workflow: { id: 'workflow-1', variables: {} },
    })
    workflowAuthzMockFns.mockAssertWorkflowMutable.mockRejectedValueOnce(
      new Error('Workflow is locked')
    )

    const result = await executeSetGlobalWorkflowVariables(
      {
        workflowId: 'workflow-1',
        operations: [{ operation: 'add', name: 'threshold', type: 'number', value: '5' }],
      },
      { userId: 'user-1' } as any
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe('Workflow is locked')
    expect(setWorkflowVariablesMock).not.toHaveBeenCalled()
  })

  it('does not move a workflow into a locked target folder', async () => {
    ensureWorkflowAccessMock.mockResolvedValue({
      workspaceId: 'workspace-1',
      workflow: { id: 'workflow-1', name: 'WF', folderId: null },
    })
    verifyFolderWorkspaceMock.mockResolvedValue(true)
    workflowAuthzMockFns.mockAssertFolderMutable.mockRejectedValueOnce(
      new Error('Folder is locked')
    )

    const result = await executeMoveWorkflow(
      { workflowIds: ['workflow-1'], folderId: 'locked-folder' },
      { userId: 'user-1' } as any
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe('Folder is locked')
    expect(performUpdateWorkflowMock).not.toHaveBeenCalled()
  })
})

describe('executeCreateWorkflow billing attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ensureWorkspaceAccessMock.mockResolvedValue(undefined)
    workflowAuthzMockFns.mockAssertFolderMutable.mockResolvedValue(undefined)
    loadWorkflowFromNormalizedTablesMock.mockResolvedValue({
      blocks: {},
      edges: [],
      loops: {},
      parallels: {},
    })
    resolveTriggerRunOptionsMock.mockReturnValue([
      {
        triggerBlockId: 'trigger-1',
        blockName: 'Start',
        mockPayload: { source: 'copilot' },
      },
    ])
    executeWorkflowMock.mockResolvedValue({
      success: true,
      output: {},
      logs: [],
      metadata: { executionId: 'new-execution-1' },
    })
    checkAttributedUsageLimitsMock.mockResolvedValue({
      isExceeded: false,
      payerUsage: { currentUsage: 1, limit: 10 },
    })
    reserveExecutionSlotMock.mockResolvedValue({ reserved: true, created: true })
    decryptSecretMock.mockResolvedValue({ decrypted: 'secret-value' })
    listFoldersMock.mockResolvedValue([])
  })

  it('ignores legacy description input instead of persisting it', async () => {
    performCreateWorkflowMock.mockResolvedValue({
      success: true,
      workflow: {
        id: 'created-workflow',
        name: 'Created Workflow',
        workspaceId: 'workspace-1',
        folderId: null,
      },
    })
    const legacyParams = {
      name: 'Created Workflow',
      workspaceId: 'workspace-1',
      description: 'PRIVATE WORKFLOW DESCRIPTION',
    } as Parameters<typeof executeCreateWorkflow>[0]

    const result = await executeCreateWorkflow(legacyParams, executionContext)

    expect(result.success).toBe(true)
    expect(performCreateWorkflowMock).toHaveBeenCalledWith({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      name: 'Created Workflow',
      folderId: null,
    })
  })

  it('canonicalizes a workflow-folder VFS path and resolves its internal ID', async () => {
    listFoldersMock.mockResolvedValue([
      { folderId: 'folder-dream', folderName: 'Dream', parentId: null },
      {
        folderId: 'folder-launch-plans',
        folderName: 'Launch Plans',
        parentId: 'folder-dream',
      },
    ])
    performCreateWorkflowMock.mockResolvedValue({
      success: true,
      workflow: {
        id: 'created-workflow',
        name: 'Created Workflow',
        workspaceId: 'workspace-1',
        folderId: 'folder-launch-plans',
      },
    })

    const result = await executeCreateWorkflow(
      {
        name: 'Created Workflow',
        workspaceId: 'workspace-1',
        folderPath: 'workflows/Dream/Launch%20Plans',
      },
      executionContext
    )

    expect(result.success).toBe(true)
    expect(performCreateWorkflowMock).toHaveBeenCalledWith({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      name: 'Created Workflow',
      folderId: 'folder-launch-plans',
    })
    expect(workflowAuthzMockFns.mockAssertFolderMutable).toHaveBeenCalledWith('folder-launch-plans')
  })

  it('fails clearly when a workflow-folder VFS path does not exist', async () => {
    listFoldersMock.mockResolvedValue([
      { folderId: 'folder-existing', folderName: 'Existing', parentId: null },
    ])

    const result = await executeCreateWorkflow(
      {
        name: 'Created Workflow',
        workspaceId: 'workspace-1',
        folderPath: 'workflows/Dream',
      },
      executionContext
    )

    expect(result).toEqual({
      success: false,
      error: 'Folder not found at workflows/Dream',
    })
    expect(performCreateWorkflowMock).not.toHaveBeenCalled()
  })

  it('rejects canonically ambiguous workflow-folder VFS paths', async () => {
    listFoldersMock.mockResolvedValue([
      { folderId: 'folder-cafe-nfc', folderName: 'Caf\u00e9', parentId: null },
      { folderId: 'folder-cafe-nfd', folderName: 'Cafe\u0301', parentId: null },
    ])

    const result = await executeCreateWorkflow(
      {
        name: 'Created Workflow',
        workspaceId: 'workspace-1',
        folderPath: 'workflows/Caf%C3%A9',
      },
      executionContext
    )

    expect(result).toEqual({
      success: false,
      error:
        'Folder path is ambiguous after canonicalization: workflows/Caf%C3%A9. Rename one of the conflicting folders and retry.',
    })
    expect(performCreateWorkflowMock).not.toHaveBeenCalled()
    expect(workflowAuthzMockFns.mockAssertFolderMutable).not.toHaveBeenCalled()
  })

  it('keeps same-workspace creation and subsequent execution on the immutable payer', async () => {
    const context: ExecutionContext = { ...executionContext, workflowId: '' }
    performCreateWorkflowMock.mockResolvedValue({
      success: true,
      workflow: {
        id: 'created-workflow',
        name: 'Created Workflow',
        workspaceId: 'workspace-1',
        folderId: null,
      },
    })
    ensureWorkflowAccessMock.mockResolvedValue({
      workflow: {
        id: 'created-workflow',
        userId: 'owner-1',
        workspaceId: 'workspace-1',
        variables: {},
      },
    })

    const createResult = await executeCreateWorkflow(
      { name: 'Created Workflow', workspaceId: 'workspace-1' },
      context
    )

    expect(createResult.success).toBe(true)
    applyCreateWorkflowOutputToContext(createResult.output, context)
    expect(context).toMatchObject({
      userId: 'user-1',
      workflowId: 'created-workflow',
      workspaceId: 'workspace-1',
      billingAttribution,
    })
    expect(context.billingAttribution).toBe(billingAttribution)
    expect(performCreateWorkflowMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', workspaceId: 'workspace-1' })
    )

    const runResult = await executeRunWorkflow({ useMockPayload: true }, context)

    expect(runResult.success).toBe(true)
    expect(executeWorkflowMock.mock.calls[0]?.[3]).toBe('user-1')
    expect(executeWorkflowMock.mock.calls[0]?.[4]).toEqual(
      expect.objectContaining({ billingAttribution })
    )
    expect(checkAttributedUsageLimitsMock).not.toHaveBeenCalled()
    expect(reserveExecutionSlotMock).not.toHaveBeenCalled()
    expect(resolveBillingAttributionMock).not.toHaveBeenCalled()
  })

  it('keeps cross-workspace creation scoped while allowing explicit subsequent execution', async () => {
    const context: ExecutionContext = { ...executionContext, workflowId: '' }
    performCreateWorkflowMock.mockResolvedValue({
      success: true,
      workflow: {
        id: 'created-workflow',
        name: 'Other Workspace Workflow',
        workspaceId: 'workspace-2',
        folderId: null,
      },
    })
    ensureWorkflowAccessMock.mockResolvedValue({
      workflow: {
        id: 'created-workflow',
        userId: 'owner-2',
        workspaceId: 'workspace-2',
        variables: {},
      },
    })
    resolveBillingAttributionMock.mockResolvedValue(childBillingAttribution)

    const createResult = await executeCreateWorkflow(
      { name: 'Other Workspace Workflow', workspaceId: 'workspace-2' },
      context
    )

    expect(createResult.success).toBe(true)
    applyCreateWorkflowOutputToContext(createResult.output, context)
    expect(ensureWorkspaceAccessMock).toHaveBeenCalledWith('workspace-2', 'user-1', 'write')
    expect(performCreateWorkflowMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', workspaceId: 'workspace-2' })
    )
    expect(context).toMatchObject({
      userId: 'user-1',
      workflowId: '',
      workspaceId: 'workspace-1',
      billingAttribution,
    })
    expect(context.billingAttribution).toBe(billingAttribution)
    const createOutput = createResult.output as { workflowId: string; workspaceId: string }
    expect(createOutput).toEqual(
      expect.objectContaining({ workflowId: 'created-workflow', workspaceId: 'workspace-2' })
    )

    const runResult = await executeRunWorkflow(
      { workflowId: createOutput.workflowId, useMockPayload: true },
      context
    )

    expect(runResult.success).toBe(true)
    expect(resolveBillingAttributionMock).toHaveBeenCalledOnce()
    expect(resolveBillingAttributionMock).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      workspaceId: 'workspace-2',
    })
    expect(executeWorkflowMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ id: 'created-workflow', workspaceId: 'workspace-2' })
    )
    expect(executeWorkflowMock.mock.calls[0]?.[3]).toBe('user-1')
    expect(executeWorkflowMock.mock.calls[0]?.[4]).toEqual(
      expect.objectContaining({ billingAttribution: childBillingAttribution })
    )
    expect(checkAttributedUsageLimitsMock).toHaveBeenCalledOnce()
    expect(checkAttributedUsageLimitsMock).toHaveBeenCalledWith(childBillingAttribution)
    expect(reserveExecutionSlotMock).toHaveBeenCalledOnce()
    expect(reserveExecutionSlotMock).toHaveBeenCalledWith(
      expect.objectContaining({
        billingEntity: childBillingAttribution.billingEntity,
        executionId: executeWorkflowMock.mock.calls[0]?.[5],
      })
    )
    expect(context.billingAttribution).toBe(billingAttribution)
  })
})

describe('Copilot workflow execution billing attribution', () => {
  const sourceSnapshot = {
    blockStates: {},
    executedBlocks: [],
    blockLogs: [],
    decisions: {},
    completedLoops: [],
    activeExecutionPath: [],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    ensureWorkflowAccessMock.mockResolvedValue({
      workflow: {
        id: 'workflow-1',
        userId: 'owner-1',
        workspaceId: 'workspace-1',
        variables: {},
      },
    })
    loadWorkflowFromNormalizedTablesMock.mockResolvedValue({
      blocks: {},
      edges: [],
      loops: {},
      parallels: {},
    })
    resolveTriggerRunOptionsMock.mockReturnValue([
      {
        triggerBlockId: 'trigger-1',
        blockName: 'Start',
        mockPayload: { source: 'copilot' },
      },
    ])
    getExecutionStateForWorkflowMock.mockResolvedValue(sourceSnapshot)
    executeWorkflowMock.mockResolvedValue({
      success: true,
      output: {},
      logs: [],
      metadata: { executionId: 'new-execution-1' },
    })
    checkAttributedUsageLimitsMock.mockResolvedValue({
      isExceeded: false,
      payerUsage: { currentUsage: 1, limit: 10 },
    })
    reserveExecutionSlotMock.mockResolvedValue({ reserved: true, created: true })
    decryptSecretMock.mockResolvedValue({ decrypted: 'secret-value' })
  })

  async function expectBillingAttributionForwarded(
    run: () => Promise<{ success: boolean }>
  ): Promise<void> {
    const result = await run()

    expect(result.success).toBe(true)
    expect(executeWorkflowMock).toHaveBeenCalledTimes(1)
    expect(executeWorkflowMock.mock.calls[0]?.[4]).toEqual(
      expect.objectContaining({ billingAttribution })
    )
    expect(checkAttributedUsageLimitsMock).not.toHaveBeenCalled()
    expect(reserveExecutionSlotMock).not.toHaveBeenCalled()
  }

  it('passes immutable attribution when running a workflow', async () => {
    await expectBillingAttributionForwarded(() =>
      executeRunWorkflow({ workflowId: 'workflow-1', useMockPayload: true }, executionContext)
    )
  })

  it('passes only input-crossing parent provenance to the child execution', async () => {
    const registry = new ResolvedSecretTraceRegistry(
      [
        {
          name: 'INPUT_SECRET',
          plaintext: 'input-secret',
          encryptedValue: 'input-ciphertext',
        },
        {
          name: 'UNRELATED_SECRET',
          plaintext: 'unrelated-secret',
          encryptedValue: 'unrelated-ciphertext',
        },
      ],
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )
    registry.recordResolved('INPUT_SECRET', 'input-secret')
    registry.recordResolved('UNRELATED_SECRET', 'unrelated-secret')
    resolveTriggerRunOptionsMock.mockReturnValueOnce([
      {
        triggerBlockId: 'trigger-1',
        blockName: 'Start',
        mockPayload: { value: 'input-secret' },
      },
    ])
    executeWorkflowMock.mockResolvedValueOnce({
      success: true,
      output: { ok: true },
      logs: [],
      metadata: { executionId: 'new-execution-1' },
      executionState: {
        resolvedSecretTraceProvenance: {
          version: 1,
          complete: true,
          entries: [],
          scope: { userId: 'user-1', workspaceId: 'workspace-1' },
        },
      },
    })

    const result = await executeRunWorkflow(
      { workflowId: 'workflow-1', useMockPayload: true },
      { ...executionContext, resolvedSecretTraceRegistry: registry }
    )

    expect(result.success).toBe(true)
    expect(executeWorkflowMock.mock.calls[0]?.[2]).toEqual({ value: 'input-secret' })
    expect(executeWorkflowMock.mock.calls[0]?.[4]).toEqual(
      expect.objectContaining({
        trustedInitialResolvedSecretTraceProvenance: {
          version: 1,
          complete: true,
          entries: [{ name: 'INPUT_SECRET', encryptedValue: 'input-ciphertext' }],
          scope: { userId: 'user-1', workspaceId: 'workspace-1' },
        },
      })
    )
    expect(JSON.stringify(result)).not.toContain('input-ciphertext')
    expect(JSON.stringify(result)).not.toContain('unrelated-ciphertext')
  })

  it('imports child provenance without returning private metadata to the model', async () => {
    const registry = new ResolvedSecretTraceRegistry([], {
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })
    const context: ExecutionContext = {
      ...executionContext,
      resolvedSecretTraceRegistry: registry,
    }
    executeWorkflowMock.mockResolvedValueOnce({
      success: true,
      output: { value: 'secret-value' },
      logs: [],
      metadata: { executionId: 'new-execution-1' },
      executionState: {
        resolvedSecretTraceProvenance: {
          version: 1,
          complete: true,
          entries: [{ name: 'API_KEY', encryptedValue: 'encrypted-secret' }],
          scope: { userId: 'user-1', workspaceId: 'workspace-1' },
        },
      },
    })

    const result = await executeRunWorkflow(
      { workflowId: 'workflow-1', useMockPayload: true },
      context
    )

    expect(result).toMatchObject({
      success: true,
      output: { output: { value: 'secret-value' } },
    })
    expect(registry.getActiveMatches()).toEqual([
      { plaintext: 'secret-value', replacement: '{{API_KEY}}' },
    ])
    expect(JSON.stringify(result)).not.toContain('__resolvedSecretTraceProvenance')
    expect(JSON.stringify(result)).not.toContain('encrypted-secret')
  })

  it('fails concurrent tool-result projection closed until child provenance is imported', async () => {
    const registry = new ResolvedSecretTraceRegistry([], {
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })
    const context: ExecutionContext = {
      ...executionContext,
      resolvedSecretTraceRegistry: registry,
    }
    let resolveExecution!: (value: unknown) => void
    let markExecutionStarted!: () => void
    const executionStarted = new Promise<void>((resolve) => {
      markExecutionStarted = resolve
    })
    executeWorkflowMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveExecution = resolve
          markExecutionStarted()
        })
    )

    const execution = executeRunWorkflow(
      { workflowId: 'workflow-1', useMockPayload: true },
      context
    )
    await executionStarted

    expect(registry.isComplete()).toBe(false)
    expect(
      projectToolResultForCopilot({ success: true, output: { value: 'secret-value' } }, registry)
    ).not.toHaveProperty('output')

    resolveExecution({
      success: true,
      output: { value: 'secret-value' },
      logs: [],
      metadata: { executionId: 'new-execution-1' },
      executionState: {
        resolvedSecretTraceProvenance: {
          version: 1,
          complete: true,
          entries: [{ name: 'API_KEY', encryptedValue: 'encrypted-secret' }],
          scope: { userId: 'user-1', workspaceId: 'workspace-1' },
        },
      },
    })

    await expect(execution).resolves.toMatchObject({ success: true })
    expect(registry.isComplete()).toBe(true)
    expect(
      projectToolResultForCopilot({ success: true, output: { value: 'secret-value' } }, registry)
    ).toMatchObject({ output: { value: '{{API_KEY}}' } })
  })

  it('marks provenance incomplete when child execution returns no trusted state', async () => {
    const registry = new ResolvedSecretTraceRegistry()
    const context: ExecutionContext = {
      ...executionContext,
      resolvedSecretTraceRegistry: registry,
    }

    const result = await executeRunWorkflow(
      { workflowId: 'workflow-1', useMockPayload: true },
      context
    )

    expect(result.success).toBe(true)
    expect(registry.isComplete()).toBe(false)
  })

  it('filters and anonymizes cross-workspace child provenance to values that cross back', async () => {
    const registry = new ResolvedSecretTraceRegistry([], {
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })
    const context: ExecutionContext = {
      ...executionContext,
      resolvedSecretTraceRegistry: registry,
    }
    ensureWorkflowAccessMock.mockResolvedValueOnce({
      workflow: {
        id: 'workflow-2',
        userId: 'owner-2',
        workspaceId: 'workspace-2',
        variables: {},
      },
    })
    resolveBillingAttributionMock.mockResolvedValueOnce(childBillingAttribution)
    decryptSecretMock.mockImplementation(async (encryptedValue: string) => ({
      decrypted: encryptedValue === 'used-ciphertext' ? 'used-secret' : 'workspace-only-secret',
    }))
    executeWorkflowMock.mockResolvedValueOnce({
      success: true,
      output: { value: 'used-secret' },
      logs: [],
      metadata: { executionId: 'child-execution' },
      executionState: {
        resolvedSecretTraceProvenance: {
          version: 1,
          complete: true,
          entries: [
            { name: 'USED', encryptedValue: 'used-ciphertext' },
            { name: 'WORKSPACE_ONLY', encryptedValue: 'workspace-only-ciphertext' },
          ],
          scope: { userId: 'user-1', workspaceId: 'workspace-2' },
        },
      },
    })

    const result = await executeRunWorkflow(
      { workflowId: 'workflow-2', useMockPayload: true },
      context
    )

    expect(result).toMatchObject({
      success: true,
      output: { output: { value: 'used-secret' } },
    })
    expect(registry.getActiveMatches()).toEqual([
      { plaintext: 'used-secret', replacement: ANONYMOUS_SECRET_TRACE_REPLACEMENT },
    ])
    expect(JSON.stringify(result)).not.toContain('workspace-only-ciphertext')
    expect(JSON.stringify(result)).not.toContain('__resolvedSecretTraceProvenance')
  })

  it('passes immutable attribution when running until a block', async () => {
    await expectBillingAttributionForwarded(() =>
      executeRunWorkflowUntilBlock(
        {
          workflowId: 'workflow-1',
          stopAfterBlockId: 'agent-1',
          useMockPayload: true,
        },
        executionContext
      )
    )
  })

  it('passes immutable attribution when running from a block', async () => {
    await expectBillingAttributionForwarded(() =>
      executeRunFromBlock(
        {
          workflowId: 'workflow-1',
          startBlockId: 'agent-1',
          executionId: 'source-execution-1',
        },
        executionContext
      )
    )
  })

  it('passes immutable attribution when running one block', async () => {
    await expectBillingAttributionForwarded(() =>
      executeRunBlock(
        {
          workflowId: 'workflow-1',
          blockId: 'agent-1',
          executionId: 'source-execution-1',
        },
        executionContext
      )
    )
  })

  it.each([
    {
      mode: 'a workflow',
      run: (context: ExecutionContext) =>
        executeRunWorkflow({ workflowId: 'workflow-2', useMockPayload: true }, context),
    },
    {
      mode: 'until a block',
      run: (context: ExecutionContext) =>
        executeRunWorkflowUntilBlock(
          {
            workflowId: 'workflow-2',
            stopAfterBlockId: 'agent-1',
            useMockPayload: true,
          },
          context
        ),
    },
    {
      mode: 'from a block',
      run: (context: ExecutionContext) =>
        executeRunFromBlock(
          {
            workflowId: 'workflow-2',
            startBlockId: 'agent-1',
            executionId: 'source-execution-1',
          },
          context
        ),
    },
    {
      mode: 'one block',
      run: (context: ExecutionContext) =>
        executeRunBlock(
          {
            workflowId: 'workflow-2',
            blockId: 'agent-1',
            executionId: 'source-execution-1',
          },
          context
        ),
    },
  ])('resolves a child snapshot when running $mode cross-workspace', async ({ run }) => {
    const context: ExecutionContext = {
      ...executionContext,
      workflowId: 'workflow-2',
      workspaceId: 'workspace-2',
    }
    ensureWorkflowAccessMock.mockResolvedValue({
      workflow: {
        id: 'workflow-2',
        userId: 'owner-2',
        workspaceId: 'workspace-2',
        variables: {},
      },
    })
    resolveBillingAttributionMock.mockResolvedValue(childBillingAttribution)

    const result = await run(context)

    expect(result.success).toBe(true)
    expect(resolveBillingAttributionMock).toHaveBeenCalledOnce()
    expect(resolveBillingAttributionMock).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      workspaceId: 'workspace-2',
    })
    expect(executeWorkflowMock.mock.calls[0]?.[4]).toEqual(
      expect.objectContaining({ billingAttribution: childBillingAttribution })
    )
    expect(checkAttributedUsageLimitsMock).toHaveBeenCalledOnce()
    expect(checkAttributedUsageLimitsMock).toHaveBeenCalledWith(childBillingAttribution)
    expect(reserveExecutionSlotMock).toHaveBeenCalledOnce()
    expect(reserveExecutionSlotMock).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: executeWorkflowMock.mock.calls[0]?.[5],
      })
    )
    expect(context.billingAttribution).toBe(billingAttribution)
  })

  it('blocks a cross-workspace run before execution when target usage is exhausted', async () => {
    const context: ExecutionContext = { ...executionContext, workspaceId: 'workspace-2' }
    ensureWorkflowAccessMock.mockResolvedValue({
      workflow: {
        id: 'workflow-2',
        userId: 'owner-2',
        workspaceId: 'workspace-2',
        variables: {},
      },
    })
    resolveBillingAttributionMock.mockResolvedValue(childBillingAttribution)
    checkAttributedUsageLimitsMock.mockResolvedValue({
      isExceeded: true,
      scope: 'member',
      message: 'Member limit reached',
      payerUsage: { currentUsage: 1, limit: 10 },
      memberUsage: { currentUsage: 2, limit: 2 },
    })

    const result = await executeRunWorkflow(
      { workflowId: 'workflow-2', useMockPayload: true },
      context
    )

    expect(result).toEqual({ success: false, error: 'Member limit reached' })
    expect(checkAttributedUsageLimitsMock).toHaveBeenCalledOnce()
    expect(reserveExecutionSlotMock).not.toHaveBeenCalled()
    expect(executeWorkflowMock).not.toHaveBeenCalled()
  })

  it('blocks a cross-workspace run when its atomic target reservation is full', async () => {
    const context: ExecutionContext = { ...executionContext, workspaceId: 'workspace-2' }
    ensureWorkflowAccessMock.mockResolvedValue({
      workflow: {
        id: 'workflow-2',
        userId: 'owner-2',
        workspaceId: 'workspace-2',
        variables: {},
      },
    })
    resolveBillingAttributionMock.mockResolvedValue(childBillingAttribution)
    reserveExecutionSlotMock.mockResolvedValue({
      reserved: false,
      reason: 'payer_concurrency',
    })

    const result = await executeRunWorkflow(
      { workflowId: 'workflow-2', useMockPayload: true },
      context
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('concurrency')
    expect(checkAttributedUsageLimitsMock).toHaveBeenCalledOnce()
    expect(reserveExecutionSlotMock).toHaveBeenCalledOnce()
    expect(executeWorkflowMock).not.toHaveBeenCalled()
  })

  it('releases the child reservation when direct target execution throws', async () => {
    const context: ExecutionContext = { ...executionContext, workspaceId: 'workspace-2' }
    ensureWorkflowAccessMock.mockResolvedValue({
      workflow: {
        id: 'workflow-2',
        userId: 'owner-2',
        workspaceId: 'workspace-2',
        variables: {},
      },
    })
    resolveBillingAttributionMock.mockResolvedValue(childBillingAttribution)
    executeWorkflowMock.mockRejectedValue(new Error('direct execution failed'))

    const result = await executeRunWorkflow(
      { workflowId: 'workflow-2', useMockPayload: true },
      context
    )

    const childExecutionId = executeWorkflowMock.mock.calls[0]?.[5]
    expect(result).toEqual({ success: false, error: 'direct execution failed' })
    expect(reserveExecutionSlotMock).toHaveBeenCalledWith(
      expect.objectContaining({ executionId: childExecutionId })
    )
    expect(releaseExecutionSlotMock).toHaveBeenCalledOnce()
    expect(releaseExecutionSlotMock).toHaveBeenCalledWith(childExecutionId)
  })

  it('leaves pause release to durable pause persistence', async () => {
    const context: ExecutionContext = { ...executionContext, workspaceId: 'workspace-2' }
    ensureWorkflowAccessMock.mockResolvedValue({
      workflow: {
        id: 'workflow-2',
        userId: 'owner-2',
        workspaceId: 'workspace-2',
        variables: {},
      },
    })
    resolveBillingAttributionMock.mockResolvedValue(childBillingAttribution)
    executeWorkflowMock.mockResolvedValue({
      success: true,
      status: 'paused',
      output: {},
      logs: [],
      metadata: { executionId: 'child-execution' },
    })

    const result = await executeRunWorkflow(
      { workflowId: 'workflow-2', useMockPayload: true },
      context
    )

    expect(result.success).toBe(true)
    expect(releaseExecutionSlotMock).not.toHaveBeenCalled()
  })
})

describe('executeRunFromBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ensureWorkflowAccessMock.mockResolvedValue({
      workflow: {
        id: 'workflow-1',
        userId: 'owner-1',
        workspaceId: 'workspace-1',
        variables: {},
      },
    })
    executeWorkflowMock.mockResolvedValue({
      success: true,
      output: {},
      logs: [],
      metadata: { executionId: 'new-execution-1' },
    })
  })

  it('passes source execution lineage for stored run-from-block snapshots', async () => {
    const sourceSnapshot = {
      blockStates: {
        upstream: {
          output: {
            __simLargeValueRef: true,
            version: 1,
            id: 'lv_ABCDEFGHIJKL',
            kind: 'object',
            size: 10,
            key: 'execution/workspace-1/workflow-1/source-execution-1/large-value-lv_ABCDEFGHIJKL.json',
            executionId: 'source-execution-1',
          },
        },
      },
      executedBlocks: [],
      blockLogs: [],
      decisions: {},
      completedLoops: [],
      activeExecutionPath: [],
    }
    getExecutionStateForWorkflowMock.mockResolvedValue(sourceSnapshot)

    const result = await executeRunFromBlock(
      {
        workflowId: 'workflow-1',
        startBlockId: 'agent-1',
        executionId: 'source-execution-1',
      },
      { userId: 'user-1' } as any
    )

    expect(result.success).toBe(true)
    expect(executeWorkflowMock).toHaveBeenCalledWith(
      expect.any(Object),
      'request-1',
      undefined,
      'user-1',
      expect.objectContaining({
        runFromBlock: {
          startBlockId: 'agent-1',
          sourceSnapshot,
          sourceExecutionId: 'source-execution-1',
        },
      }),
      expect.any(String)
    )
  })
})
