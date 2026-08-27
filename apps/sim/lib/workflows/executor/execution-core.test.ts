import {
  environmentUtilsMockFns,
  loggerMock,
  resetEnvironmentUtilsMock,
  workflowsPersistenceUtilsMock,
  workflowsPersistenceUtilsMockFns,
  workflowsUtilsMock,
  workflowsUtilsMockFns,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mergeSubblockStateWithValuesMock,
  safeStartMock,
  safeCompleteMock,
  safeCompleteWithErrorMock,
  safeCompleteWithCancellationMock,
  safeCompleteWithPauseMock,
  hasCompletedMock,
  getPersistedCompletionStatusMock,
  clearExecutionCancellationMock,
  buildTraceSpansMock,
  serializeWorkflowMock,
  executorExecuteMock,
  onBlockStartPersistenceMock,
  executorConstructorMock,
  findStartBlockMock,
  setResolvedSecretTraceRegistryMock,
  setTraceLargeValueAccessMock,
  setExecutionDeadlineAtMock,
  projectDisplayContentMock,
  projectDiagnosticErrorMock,
  decryptSecretMock,
} = vi.hoisted(() => ({
  mergeSubblockStateWithValuesMock: vi.fn(),
  safeStartMock: vi.fn(),
  safeCompleteMock: vi.fn(),
  safeCompleteWithErrorMock: vi.fn(),
  safeCompleteWithCancellationMock: vi.fn(),
  safeCompleteWithPauseMock: vi.fn(),
  hasCompletedMock: vi.fn(),
  getPersistedCompletionStatusMock: vi.fn(),
  clearExecutionCancellationMock: vi.fn(),
  buildTraceSpansMock: vi.fn(),
  serializeWorkflowMock: vi.fn(),
  executorExecuteMock: vi.fn(),
  onBlockStartPersistenceMock: vi.fn(),
  executorConstructorMock: vi.fn(),
  findStartBlockMock: vi.fn(),
  setResolvedSecretTraceRegistryMock: vi.fn(),
  setTraceLargeValueAccessMock: vi.fn(),
  setExecutionDeadlineAtMock: vi.fn(),
  projectDisplayContentMock: vi.fn(),
  projectDiagnosticErrorMock: vi.fn(),
  decryptSecretMock: vi.fn(),
}))

const getPersonalAndWorkspaceEnvMock = environmentUtilsMockFns.mockGetPersonalAndWorkspaceEnv

afterAll(resetEnvironmentUtilsMock)

const loadWorkflowFromNormalizedTablesMock =
  workflowsPersistenceUtilsMockFns.mockLoadWorkflowFromNormalizedTables
const loadDeployedWorkflowStateMock = workflowsPersistenceUtilsMockFns.mockLoadDeployedWorkflowState
const loadWorkflowDeploymentVersionStateMock =
  workflowsPersistenceUtilsMockFns.mockLoadWorkflowDeploymentVersionState
const updateWorkflowRunCountsMock = workflowsUtilsMockFns.mockUpdateWorkflowRunCounts

vi.mock('@/lib/execution/cancellation', () => ({
  clearExecutionCancellation: clearExecutionCancellationMock,
}))

vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: decryptSecretMock,
}))

vi.mock('@/lib/logs/execution/trace-spans/trace-spans', () => ({
  buildTraceSpans: buildTraceSpansMock,
}))

vi.mock('@/lib/workflows/persistence/utils', () => workflowsPersistenceUtilsMock)

vi.mock('@/lib/workflows/custom-blocks/operations', () => ({
  getCustomBlockRowsForWorkspace: vi.fn().mockResolvedValue([]),
}))

vi.mock('@sim/workflow-persistence/subblocks', () => ({
  mergeSubblockStateWithValues: mergeSubblockStateWithValuesMock,
}))

vi.mock('@/lib/workflows/triggers/triggers', () => ({
  TriggerUtils: {
    findStartBlock: findStartBlockMock,
  },
}))

vi.mock('@/lib/workflows/utils', () => workflowsUtilsMock)

vi.mock('@/executor', () => ({
  Executor: class {
    constructor(args: unknown) {
      executorConstructorMock(args)
      // biome-ignore lint/correctness/noConstructorReturn: returning the instance overrides `new Executor(...)` so consumers get the mocked methods
      return {
        execute: executorExecuteMock,
        executeFromBlock: executorExecuteMock,
      }
    }
  },
}))

vi.mock('@/serializer', () => ({
  Serializer: class {
    serializeWorkflow = serializeWorkflowMock
  },
}))

import {
  executeWorkflowCore,
  FINALIZED_EXECUTION_ID_TTL_MS,
  wasExecutionFinalizedByCore,
} from './execution-core'

const executionCoreLoggerCallIndex = loggerMock.createLogger.mock.calls.findIndex(
  ([name]) => name === 'ExecutionCore'
)
const executionCoreLogger =
  loggerMock.createLogger.mock.results[executionCoreLoggerCallIndex]?.value
if (!executionCoreLogger) throw new Error('ExecutionCore logger mock was not initialized')

describe('executeWorkflowCore terminal finalization sequencing', () => {
  const loggingSession = {
    safeStart: safeStartMock,
    safeComplete: safeCompleteMock,
    safeCompleteWithError: safeCompleteWithErrorMock,
    safeCompleteWithCancellation: safeCompleteWithCancellationMock,
    safeCompleteWithPause: safeCompleteWithPauseMock,
    hasCompleted: hasCompletedMock,
    getPersistedCompletionStatus: getPersistedCompletionStatusMock,
    onBlockStart: onBlockStartPersistenceMock,
    onBlockComplete: vi.fn(),
    projectDisplayContent: projectDisplayContentMock,
    projectDiagnosticError: projectDiagnosticErrorMock,
    setResolvedSecretTraceRegistry: setResolvedSecretTraceRegistryMock,
    setTraceLargeValueAccess: setTraceLargeValueAccessMock,
    setExecutionDeadlineAt: setExecutionDeadlineAtMock,
    setPostExecutionPromise: vi.fn(),
    waitForPostExecution: vi.fn().mockResolvedValue(undefined),
  }

  const createSnapshot = () => ({
    metadata: {
      requestId: 'req-1',
      workflowId: 'workflow-1',
      userId: 'user-1',
      workflowUserId: 'workflow-owner',
      workspaceId: 'workspace-1',
      principal: {
        kind: 'session' as const,
        userId: 'user-1',
        sessionId: 'session-1',
      },
      triggerType: 'api',
      executionId: 'execution-1',
      triggerBlockId: undefined,
      useDraftState: true,
      isClientSession: false,
      enforceCredentialAccess: false,
      startTime: new Date().toISOString(),
    },
    workflow: {
      id: 'workflow-1',
      userId: 'workflow-owner',
      variables: {},
    },
    input: { hello: 'world' },
    workflowVariables: {},
    selectedOutputs: [],
    state: undefined,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()

    loadWorkflowFromNormalizedTablesMock.mockResolvedValue({
      blocks: {
        'start-block': {
          id: 'start-block',
          type: 'start_trigger',
          subBlocks: {},
          name: 'Start',
        },
      },
      edges: [],
      loops: {},
      parallels: {},
    })

    loadDeployedWorkflowStateMock.mockResolvedValue({
      blocks: {},
      edges: [],
      loops: {},
      parallels: {},
      deploymentVersionId: 'dep-1',
    })
    loadWorkflowDeploymentVersionStateMock.mockResolvedValue({
      blocks: {},
      edges: [],
      loops: {},
      parallels: {},
      deploymentVersionId: 'dep-historical',
    })

    getPersonalAndWorkspaceEnvMock.mockResolvedValue({
      personalEncrypted: {},
      workspaceEncrypted: {},
      personalDecrypted: {},
      workspaceDecrypted: {},
    })

    mergeSubblockStateWithValuesMock.mockImplementation((blocks) => blocks)
    serializeWorkflowMock.mockReturnValue({ blocks: [], loops: {}, parallels: {} })
    buildTraceSpansMock.mockReturnValue({ traceSpans: [{ id: 'span-1' }], totalDuration: 123 })
    findStartBlockMock.mockReturnValue({
      blockId: 'start-block',
      block: { type: 'start_trigger' },
      path: ['start-block'],
    })
    safeStartMock.mockResolvedValue(true)
    safeCompleteMock.mockResolvedValue(undefined)
    safeCompleteWithErrorMock.mockResolvedValue(undefined)
    safeCompleteWithCancellationMock.mockResolvedValue(undefined)
    safeCompleteWithPauseMock.mockResolvedValue(undefined)
    hasCompletedMock.mockReturnValue(true)
    getPersistedCompletionStatusMock.mockReturnValue('pending')
    onBlockStartPersistenceMock.mockResolvedValue(undefined)
    projectDisplayContentMock.mockImplementation(async (content) => content)
    projectDiagnosticErrorMock.mockImplementation(
      (_error: unknown, details: Record<string, unknown> = {}) => details
    )
    updateWorkflowRunCountsMock.mockResolvedValue(undefined)
    clearExecutionCancellationMock.mockResolvedValue(undefined)
    decryptSecretMock.mockImplementation(async (encryptedValue: string) => ({
      decrypted:
        encryptedValue === 'webhook-ciphertext'
          ? 'webhook-secret-value'
          : encryptedValue === 'old-secret-ciphertext'
            ? 'old-secret-value'
            : encryptedValue,
    }))
  })

  it('loads workflow state and env vars concurrently, then starts logging before constructing the executor', async () => {
    const callOrder: string[] = []

    let releaseWorkflowLoad: (() => void) | undefined
    let releaseEnvLoad: (() => void) | undefined
    const workflowLoadGate = new Promise<void>((resolve) => {
      releaseWorkflowLoad = resolve
    })
    const envLoadGate = new Promise<void>((resolve) => {
      releaseEnvLoad = resolve
    })

    loadWorkflowFromNormalizedTablesMock.mockImplementation(async () => {
      callOrder.push('load-workflow:start')
      await workflowLoadGate
      callOrder.push('load-workflow:end')
      return {
        blocks: {
          'start-block': {
            id: 'start-block',
            type: 'start_trigger',
            subBlocks: {},
            name: 'Start',
          },
        },
        edges: [],
        loops: {},
        parallels: {},
      }
    })

    getPersonalAndWorkspaceEnvMock.mockImplementation(async () => {
      callOrder.push('load-env:start')
      await envLoadGate
      callOrder.push('load-env:end')
      return {
        personalEncrypted: {},
        workspaceEncrypted: {},
        personalDecrypted: {},
        workspaceDecrypted: {},
      }
    })

    safeStartMock.mockImplementation(async () => {
      callOrder.push('safeStart')
      return true
    })

    executorConstructorMock.mockImplementation(() => {
      callOrder.push('executor-construct')
    })

    executorExecuteMock.mockResolvedValue({
      success: true,
      status: 'completed',
      output: { done: true },
      logs: [],
      metadata: { duration: 123, startTime: 'start', endTime: 'end' },
    })

    const executionPromise = executeWorkflowCore({
      snapshot: createSnapshot() as any,
      callbacks: {},
      loggingSession: loggingSession as any,
    })

    await Promise.resolve()

    expect(callOrder).toContain('load-workflow:start')
    expect(callOrder).toContain('load-env:start')
    expect(callOrder).not.toContain('safeStart')
    expect(callOrder).not.toContain('executor-construct')

    releaseWorkflowLoad?.()
    releaseEnvLoad?.()

    await executionPromise

    /**
     * The default snapshot is a server-side run, so its personal and workspace
     * identities differ and the environment resolves once per identity. Both
     * lookups still overlap the workflow load, which is what this pins.
     */
    expect(callOrder).toEqual([
      'load-workflow:start',
      'load-env:start',
      'load-env:start',
      'load-workflow:end',
      'load-env:end',
      'load-env:end',
      'safeStart',
      'executor-construct',
    ])
    expect(safeStartMock).toHaveBeenCalledTimes(1)
    expect(executorConstructorMock).toHaveBeenCalledTimes(1)
  })

  it('routes onBlockStart through logging session persistence path', async () => {
    executorExecuteMock.mockResolvedValue({
      success: true,
      status: 'completed',
      output: { done: true },
      logs: [],
      metadata: { duration: 123, startTime: 'start', endTime: 'end' },
    })

    await executeWorkflowCore({
      snapshot: createSnapshot() as any,
      callbacks: {
        onBlockStart: async (blockId) => {
          expect(blockId).toBe('block-1')
        },
      },
      loggingSession: loggingSession as any,
    })

    const contextExtensions = executorConstructorMock.mock.calls[0]?.[0]?.contextExtensions
    await contextExtensions.onBlockStart('block-1', 'Fetch', 'api', 1)

    expect(onBlockStartPersistenceMock).toHaveBeenCalledWith(
      'block-1',
      'Fetch',
      'api',
      expect.any(String)
    )
  })

  it.each([
    {
      name: 'personal API key manual draft execution',
      principal: {
        kind: 'personal_api_key' as const,
        userId: 'user-1',
        keyId: 'personal-key-1',
      },
      triggerType: 'manual',
      useDraftState: true,
      expectedIsDeployedContext: false,
    },
    {
      name: 'deployed schedule background execution',
      principal: {
        kind: 'system' as const,
        serviceId: 'schedule' as const,
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
      },
      triggerType: 'schedule',
      useDraftState: false,
      expectedIsDeployedContext: true,
    },
  ])(
    'derives deployed context from canonical state for $name',
    async ({ principal, triggerType, useDraftState, expectedIsDeployedContext }) => {
      executorExecuteMock.mockResolvedValue({
        success: true,
        status: 'completed',
        output: { done: true },
        logs: [],
        metadata: { duration: 123, startTime: 'start', endTime: 'end' },
      })

      const snapshot = createSnapshot()
      await executeWorkflowCore({
        snapshot: {
          ...snapshot,
          metadata: {
            ...snapshot.metadata,
            principal,
            triggerType,
            useDraftState,
            isClientSession: false,
          },
        } as any,
        callbacks: {},
        loggingSession: loggingSession as any,
      })

      expect(executorConstructorMock.mock.calls[0]?.[0]?.contextExtensions?.isDeployedContext).toBe(
        expectedIsDeployedContext
      )
    }
  )

  it('starts logging with the workflow state that will be executed', async () => {
    const executedWorkflowState = {
      blocks: {
        loop: { id: 'loop', type: 'loop', name: 'Loop', subBlocks: {} },
        parallel: {
          id: 'parallel',
          type: 'parallel',
          name: 'Parallel',
          subBlocks: {},
          data: { parentId: 'loop', extent: 'parent' },
        },
      },
      edges: [],
      loops: { loop: { id: 'loop', nodes: ['parallel'], iterations: 1, loopType: 'for' } },
      parallels: { parallel: { id: 'parallel', nodes: [], count: 1 } },
    }
    executorExecuteMock.mockResolvedValue({
      success: true,
      status: 'completed',
      output: { done: true },
      logs: [],
      metadata: { duration: 123, startTime: 'start', endTime: 'end' },
    })

    await executeWorkflowCore({
      snapshot: {
        ...createSnapshot(),
        metadata: {
          ...createSnapshot().metadata,
          workflowStateOverride: executedWorkflowState,
        },
      } as any,
      callbacks: {},
      loggingSession: loggingSession as any,
    })

    expect(safeStartMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowState: executedWorkflowState,
      })
    )
  })

  it('uses external trigger selection for webhook executions without an explicit triggerBlockId', async () => {
    executorExecuteMock.mockResolvedValue({
      success: true,
      status: 'completed',
      output: { done: true },
      logs: [],
      metadata: { duration: 123, startTime: 'start', endTime: 'end' },
    })

    await executeWorkflowCore({
      snapshot: {
        ...createSnapshot(),
        metadata: {
          ...createSnapshot().metadata,
          triggerType: 'webhook',
        },
      } as any,
      callbacks: {},
      loggingSession: loggingSession as any,
    })

    expect(findStartBlockMock).toHaveBeenCalledWith(expect.anything(), 'external', false)
  })

  it('preserves manifest-backed workflow variables during execution setup', async () => {
    const manifest = {
      __simLargeArrayManifest: true,
      version: 2,
      kind: 'array',
      totalCount: 1,
      chunkCount: 1,
      byteSize: 16,
      chunks: [
        {
          ref: {
            __simLargeValueRef: true,
            version: 1,
            id: 'lv_ABCDEFGHIJKL',
            kind: 'array',
            size: 16,
            executionId: 'execution-1',
          },
          count: 1,
          byteSize: 16,
        },
      ],
      preview: [{ id: 1 }],
    }
    executorExecuteMock.mockResolvedValue({
      success: true,
      status: 'completed',
      output: { done: true },
      logs: [],
      metadata: { duration: 123, startTime: 'start', endTime: 'end' },
    })

    await executeWorkflowCore({
      snapshot: {
        ...createSnapshot(),
        workflowVariables: {
          'var-1': { id: 'var-1', name: 'issues', type: 'array', value: manifest },
        },
      } as any,
      callbacks: {},
      loggingSession: loggingSession as any,
    })

    expect(executorConstructorMock.mock.calls[0]?.[0]?.workflowVariables['var-1'].value).toEqual(
      manifest
    )
  })

  it('does not await user block start callback after persistence completes', async () => {
    let releaseCallback: (() => void) | undefined
    const callbackPromise = new Promise<void>((resolve) => {
      releaseCallback = resolve
    })

    executorExecuteMock.mockResolvedValue({
      success: true,
      status: 'completed',
      output: { done: true },
      logs: [],
      metadata: { duration: 123, startTime: 'start', endTime: 'end' },
    })

    await executeWorkflowCore({
      snapshot: createSnapshot() as any,
      callbacks: {
        onBlockStart: vi.fn(() => callbackPromise),
      },
      loggingSession: loggingSession as any,
    })

    const contextExtensions = executorConstructorMock.mock.calls[0]?.[0]?.contextExtensions

    await expect(
      contextExtensions.onBlockStart('block-1', 'Fetch', 'api', 1)
    ).resolves.toBeUndefined()

    releaseCallback?.()
  })

  it('awaits terminal completion before updating run counts and returning', async () => {
    const callOrder: string[] = []

    executorExecuteMock.mockResolvedValue({
      success: true,
      status: 'completed',
      output: { done: true },
      logs: [],
      metadata: { duration: 123, startTime: 'start', endTime: 'end' },
    })

    safeCompleteMock.mockImplementation(async () => {
      callOrder.push('safeComplete:start')
      await Promise.resolve()
      callOrder.push('safeComplete:end')
    })

    clearExecutionCancellationMock.mockImplementation(async () => {
      callOrder.push('clearCancellation')
    })

    updateWorkflowRunCountsMock.mockImplementation(async () => {
      callOrder.push('updateRunCounts')
    })

    const result = await executeWorkflowCore({
      snapshot: createSnapshot() as any,
      callbacks: {},
      loggingSession: loggingSession as any,
    })

    await loggingSession.setPostExecutionPromise.mock.calls[0][0]

    expect(result.status).toBe('completed')
    expect(callOrder).toEqual([
      'safeComplete:start',
      'safeComplete:end',
      'clearCancellation',
      'updateRunCounts',
    ])
  })

  it('registers an inert resolution-scoped registry while preserving raw runtime output', async () => {
    const secret = 'sk-demo-core-7f3a91'
    const runtimeOutput = {
      keyWasResolved: true,
      echoedKey: secret,
      ordinary: 'us-east-1',
    }

    getPersonalAndWorkspaceEnvMock.mockResolvedValue({
      personalEncrypted: {},
      workspaceEncrypted: { OPENAI_API_KEY: 'encrypted' },
      personalDecrypted: {},
      workspaceDecrypted: {
        OPENAI_API_KEY: secret,
        UNREFERENCED_REGION: 'us-east-1',
      },
    })
    serializeWorkflowMock.mockReturnValue({
      blocks: [
        {
          id: 'function-1',
          config: {
            tool: 'function',
            params: { code: 'return "{{OPENAI_API_KEY}}"' },
          },
        },
      ],
      connections: [],
      loops: {},
      parallels: {},
    })
    executorExecuteMock.mockResolvedValue({
      success: true,
      status: 'completed',
      output: runtimeOutput,
      logs: [],
      metadata: { duration: 123, startTime: 'start', endTime: 'end' },
    })

    const result = await executeWorkflowCore({
      snapshot: createSnapshot() as any,
      callbacks: {},
      loggingSession: loggingSession as any,
    })
    await loggingSession.setPostExecutionPromise.mock.calls[0][0]

    const registry = setResolvedSecretTraceRegistryMock.mock.calls[0]?.[0]
    expect(registry.getActiveMatches()).toEqual([])
    expect(registry.recordResolved('OPENAI_API_KEY', secret)).toBe(true)
    expect(registry.getActiveMatches()).toEqual([
      { plaintext: secret, replacement: '{{OPENAI_API_KEY}}' },
    ])
    expect(result.output).toEqual(runtimeOutput)
    expect(result.output.echoedKey).toBe(secret)
    expect(safeCompleteMock).toHaveBeenCalledWith(
      expect.objectContaining({ finalOutput: runtimeOutput })
    )
  })

  it('activates trusted pre-execution provenance on the installed execution registry', async () => {
    executorExecuteMock.mockResolvedValue({
      success: true,
      status: 'completed',
      output: {},
      logs: [],
      metadata: { duration: 1, startTime: 'start', endTime: 'end' },
    })

    await executeWorkflowCore({
      snapshot: createSnapshot() as any,
      callbacks: {},
      loggingSession: loggingSession as any,
      trustedInitialResolvedSecretTraceProvenance: {
        version: 1,
        complete: true,
        entries: [{ name: 'WEBHOOK_SECRET', encryptedValue: 'webhook-ciphertext' }],
        scope: { userId: 'workflow-owner', workspaceId: 'workspace-1' },
      },
    })
    await loggingSession.setPostExecutionPromise.mock.calls[0][0]

    const registry = setResolvedSecretTraceRegistryMock.mock.calls[0]?.[0]
    expect(registry.getActiveMatches()).toEqual([
      { plaintext: 'webhook-secret-value', replacement: '{{WEBHOOK_SECRET}}' },
    ])
  })

  it('keeps configured secrets inert for a trusted legacy resume without a provenance checkpoint', async () => {
    getPersonalAndWorkspaceEnvMock.mockResolvedValue({
      personalEncrypted: {},
      workspaceEncrypted: { LEGACY_SECRET: 'old-secret-ciphertext' },
      personalDecrypted: {},
      workspaceDecrypted: { LEGACY_SECRET: 'old-secret-value' },
    })
    executorExecuteMock.mockResolvedValue({
      success: true,
      status: 'completed',
      output: { done: true },
      logs: [],
      metadata: { duration: 1, startTime: 'start', endTime: 'end' },
    })
    const resumedSnapshot = createSnapshot()
    resumedSnapshot.metadata = {
      ...resumedSnapshot.metadata,
      executionId: 'execution-resumed',
      resumeFromSnapshot: true,
      resumeTerminalNoop: true,
    } as any
    ;(resumedSnapshot as any).state = {
      blockStates: { previous: { output: { value: 'Bearer old-secret-value' } } },
      executedBlocks: ['previous'],
      blockLogs: [],
      decisions: { router: {}, condition: {} },
      completedLoops: [],
      activeExecutionPath: [],
    }

    await executeWorkflowCore({
      snapshot: resumedSnapshot as any,
      callbacks: {},
      loggingSession: loggingSession as any,
      skipLogCreation: true,
    })
    await loggingSession.setPostExecutionPromise.mock.calls[0][0]

    const registry = setResolvedSecretTraceRegistryMock.mock.calls[0]?.[0]
    expect(registry.isComplete()).toBe(true)
    expect(registry.getActiveMatches()).toEqual([])
  })

  it('accepts an empty trusted legacy resume after bounded reconstruction', async () => {
    executorExecuteMock.mockResolvedValue({
      success: true,
      status: 'completed',
      output: { done: true },
      logs: [],
      metadata: { duration: 1, startTime: 'start', endTime: 'end' },
    })
    const resumedSnapshot = createSnapshot()
    resumedSnapshot.metadata = {
      ...resumedSnapshot.metadata,
      executionId: 'execution-resumed',
      resumeFromSnapshot: true,
      resumeTerminalNoop: true,
    } as any
    ;(resumedSnapshot as any).state = {
      blockStates: {},
      executedBlocks: [],
      blockLogs: [],
      decisions: { router: {}, condition: {} },
      completedLoops: [],
      activeExecutionPath: [],
    }

    await executeWorkflowCore({
      snapshot: resumedSnapshot as any,
      callbacks: {},
      loggingSession: loggingSession as any,
      skipLogCreation: true,
    })
    await loggingSession.setPostExecutionPromise.mock.calls[0][0]

    const registry = setResolvedSecretTraceRegistryMock.mock.calls[0]?.[0]
    expect(registry.isComplete()).toBe(true)
    expect(registry.getActiveMatches()).toEqual([])
  })

  it('resumes a deployed run from its admitted historical version after deployment changes', async () => {
    executorExecuteMock.mockResolvedValue({
      success: true,
      status: 'completed',
      output: { done: true },
      logs: [],
      metadata: { duration: 1, startTime: 'start', endTime: 'end' },
    })
    const resumedSnapshot = createSnapshot()
    resumedSnapshot.metadata = {
      ...resumedSnapshot.metadata,
      executionId: 'execution-resumed',
      useDraftState: false,
      resumeFromSnapshot: true,
      resumeTerminalNoop: true,
      workflowStateOverride: {
        blocks: {},
        edges: [],
        loops: {},
        parallels: {},
        deploymentVersionId: 'dep-active-now',
      },
    } as any
    ;(resumedSnapshot as any).state = {
      blockStates: {},
      executedBlocks: [],
      blockLogs: [],
      decisions: { router: {}, condition: {} },
      completedLoops: [],
      activeExecutionPath: [],
    }

    await executeWorkflowCore({
      snapshot: resumedSnapshot as any,
      callbacks: {},
      loggingSession: loggingSession as any,
      skipLogCreation: true,
      resumeDeploymentVersionId: 'dep-historical',
    })

    expect(loadWorkflowDeploymentVersionStateMock).toHaveBeenCalledWith(
      'workflow-1',
      'dep-historical',
      'workspace-1'
    )
    expect(loadDeployedWorkflowStateMock).not.toHaveBeenCalled()
    expect(safeStartMock).toHaveBeenCalledWith(
      expect.objectContaining({ deploymentVersionId: 'dep-historical' })
    )
    expect(executorConstructorMock.mock.calls[0]?.[0]?.contextExtensions).toMatchObject({
      executorDelegationOrigin: {
        currentWorkflow: {
          workflowId: 'workflow-1',
          mode: 'deployment',
          deploymentVersionId: 'dep-historical',
        },
      },
    })
  })

  it('fails instead of loading the latest deployment for a deployed resume without authority', async () => {
    const resumedSnapshot = createSnapshot()
    resumedSnapshot.metadata = {
      ...resumedSnapshot.metadata,
      useDraftState: false,
      resumeFromSnapshot: true,
    } as any

    await expect(
      executeWorkflowCore({
        snapshot: resumedSnapshot as any,
        callbacks: {},
        loggingSession: loggingSession as any,
        skipLogCreation: true,
      })
    ).rejects.toThrow('Deployed resume requires its admitted deployment version')
    expect(loadDeployedWorkflowStateMock).not.toHaveBeenCalled()
    expect(loadWorkflowDeploymentVersionStateMock).not.toHaveBeenCalled()
  })

  it('rejects deployment authority on a draft resume', async () => {
    const resumedSnapshot = createSnapshot()
    resumedSnapshot.metadata = {
      ...resumedSnapshot.metadata,
      resumeFromSnapshot: true,
    } as any

    await expect(
      executeWorkflowCore({
        snapshot: resumedSnapshot as any,
        callbacks: {},
        loggingSession: loggingSession as any,
        skipLogCreation: true,
        resumeDeploymentVersionId: 'dep-historical',
      })
    ).rejects.toThrow('Draft resume cannot carry deployment version authority')
    expect(loadWorkflowFromNormalizedTablesMock).not.toHaveBeenCalled()
    expect(loadWorkflowDeploymentVersionStateMock).not.toHaveBeenCalled()
  })

  it('marks inherited client run-from-block provenance incomplete', async () => {
    executorExecuteMock.mockResolvedValue({
      success: true,
      status: 'completed',
      output: { done: true },
      logs: [],
      metadata: { duration: 1, startTime: 'start', endTime: 'end' },
    })

    await executeWorkflowCore({
      snapshot: createSnapshot() as any,
      callbacks: {},
      loggingSession: loggingSession as any,
      runFromBlock: {
        startBlockId: 'start-block',
        sourceSnapshot: {
          blockStates: { previous: { output: { value: 'cached' } } },
          executedBlocks: ['previous'],
          blockLogs: [],
          decisions: { router: {}, condition: {} },
          completedLoops: [],
          activeExecutionPath: [],
          resolvedSecretTraceProvenance: {
            version: 1,
            complete: true,
            entries: [{ name: 'FORGED_SECRET', encryptedValue: 'old-secret-ciphertext' }],
            scope: { userId: 'workflow-owner', workspaceId: 'workspace-1' },
          },
        },
      },
    })
    await loggingSession.setPostExecutionPromise.mock.calls[0][0]

    const registry = setResolvedSecretTraceRegistryMock.mock.calls[0]?.[0]
    expect(registry.isComplete()).toBe(false)
    expect(registry.getActiveMatches()).toEqual([])
  })

  it('restores provenance from a server-loaded run-from-block execution', async () => {
    executorExecuteMock.mockResolvedValue({
      success: true,
      status: 'completed',
      output: { done: true },
      logs: [],
      metadata: { duration: 1, startTime: 'start', endTime: 'end' },
    })

    await executeWorkflowCore({
      snapshot: createSnapshot() as any,
      callbacks: {},
      loggingSession: loggingSession as any,
      runFromBlock: {
        startBlockId: 'start-block',
        sourceExecutionId: 'source-execution',
        sourceSnapshot: {
          blockStates: { previous: { output: { value: 'cached' } } },
          executedBlocks: ['previous'],
          blockLogs: [],
          decisions: { router: {}, condition: {} },
          completedLoops: [],
          activeExecutionPath: [],
          resolvedSecretTraceProvenance: {
            version: 1,
            complete: true,
            entries: [{ name: 'RESTORED_SECRET', encryptedValue: 'old-secret-ciphertext' }],
            scope: { userId: 'workflow-owner', workspaceId: 'workspace-1' },
          },
        },
      },
    })
    await loggingSession.setPostExecutionPromise.mock.calls[0][0]

    const registry = setResolvedSecretTraceRegistryMock.mock.calls[0]?.[0]
    expect(registry.isComplete()).toBe(true)
    expect(registry.getActiveMatches()).toEqual([
      { plaintext: 'old-secret-value', replacement: '{{RESTORED_SECRET}}' },
    ])
  })

  it.each([
    {
      scenario: 'rotation',
      workspaceEncrypted: { ROTATED_SECRET: 'new-secret-ciphertext' },
      workspaceDecrypted: { ROTATED_SECRET: 'new-secret-value' },
    },
    {
      scenario: 'deletion',
      workspaceEncrypted: {},
      workspaceDecrypted: {},
    },
  ])(
    'preserves pre-pause secret provenance after $scenario',
    async ({ workspaceEncrypted, workspaceDecrypted }) => {
      getPersonalAndWorkspaceEnvMock.mockResolvedValue({
        personalEncrypted: {},
        workspaceEncrypted,
        personalDecrypted: {},
        workspaceDecrypted,
      })
      executorExecuteMock.mockResolvedValue({
        success: true,
        status: 'completed',
        output: { done: true },
        logs: [],
        metadata: { duration: 1, startTime: 'start', endTime: 'end' },
      })
      const resumedSnapshot = createSnapshot()
      resumedSnapshot.metadata = {
        ...resumedSnapshot.metadata,
        executionId: 'execution-resumed',
        resumeFromSnapshot: true,
        resumeTerminalNoop: true,
      } as any
      ;(resumedSnapshot as any).state = {
        blockStates: {},
        executedBlocks: [],
        blockLogs: [],
        decisions: { router: {}, condition: {} },
        completedLoops: [],
        activeExecutionPath: [],
        resolvedSecretTraceProvenance: {
          version: 1,
          complete: true,
          entries: [{ name: 'ROTATED_SECRET', encryptedValue: 'old-secret-ciphertext' }],
          scope: { userId: 'workflow-owner', workspaceId: 'workspace-1' },
        },
      }

      await executeWorkflowCore({
        snapshot: resumedSnapshot as any,
        callbacks: {},
        loggingSession: loggingSession as any,
        skipLogCreation: true,
      })
      await loggingSession.setPostExecutionPromise.mock.calls[0][0]

      const registry = setResolvedSecretTraceRegistryMock.mock.calls[0]?.[0]
      expect(registry.isComplete()).toBe(true)
      expect(registry.getActiveMatches()).toEqual([
        { plaintext: 'old-secret-value', replacement: '{{ROTATED_SECRET}}' },
      ])
    }
  )

  it('awaits wrapped lifecycle persistence before terminal finalization returns', async () => {
    let releaseBlockStart: (() => void) | undefined
    const blockStartPromise = new Promise<void>((resolve) => {
      releaseBlockStart = resolve
    })
    const callOrder: string[] = []

    onBlockStartPersistenceMock.mockImplementation(async () => {
      callOrder.push('persist:start')
      await blockStartPromise
      callOrder.push('persist:end')
    })

    safeCompleteMock.mockImplementation(async () => {
      callOrder.push('safeComplete')
    })

    executorExecuteMock.mockImplementation(async () => {
      const contextExtensions = executorConstructorMock.mock.calls[0]?.[0]?.contextExtensions
      const startLifecycle = contextExtensions.onBlockStart('block-1', 'Fetch', 'api', 1)
      await Promise.resolve()
      callOrder.push('executor:before-release')
      releaseBlockStart?.()
      await startLifecycle
      callOrder.push('executor:after-start')

      return {
        success: true,
        status: 'completed',
        output: { done: true },
        logs: [],
        metadata: { duration: 123, startTime: 'start', endTime: 'end' },
      }
    })

    await executeWorkflowCore({
      snapshot: createSnapshot() as any,
      callbacks: {},
      loggingSession: loggingSession as any,
    })

    expect(callOrder).toEqual([
      'persist:start',
      'executor:before-release',
      'persist:end',
      'executor:after-start',
      'safeComplete',
    ])
  })

  it('awaits fire-and-forget block callbacks before returning terminal result', async () => {
    let releaseBlockComplete: (() => void) | undefined
    let markCallbackStarted: (() => void) | undefined
    const blockCompletePromise = new Promise<void>((resolve) => {
      releaseBlockComplete = resolve
    })
    const callbackStartedPromise = new Promise<void>((resolve) => {
      markCallbackStarted = resolve
    })
    const callOrder: string[] = []
    let hasReturned = false

    executorExecuteMock.mockImplementation(async () => {
      const contextExtensions = executorConstructorMock.mock.calls[0]?.[0]?.contextExtensions
      void contextExtensions.onBlockComplete('block-1', 'Fetch', 'api', {
        input: {},
        output: { done: true },
        executionTime: 10,
        startedAt: new Date().toISOString(),
        executionOrder: 1,
        endedAt: new Date().toISOString(),
      })
      callOrder.push('executor:return')

      return {
        success: true,
        status: 'completed',
        output: { done: true },
        logs: [],
        metadata: { duration: 123, startTime: 'start', endTime: 'end' },
      }
    })

    const executionPromise = executeWorkflowCore({
      snapshot: createSnapshot() as any,
      callbacks: {
        onBlockComplete: async () => {
          callOrder.push('callback:start')
          markCallbackStarted?.()
          await blockCompletePromise
          callOrder.push('callback:end')
        },
      },
      loggingSession: loggingSession as any,
    }).then((result) => {
      hasReturned = true
      callOrder.push('core:return')
      return result
    })

    await callbackStartedPromise

    expect(callOrder).toEqual(['executor:return', 'callback:start'])
    expect(hasReturned).toBe(false)

    releaseBlockComplete?.()
    const result = await executionPromise

    expect(result.status).toBe('completed')
    expect(callOrder).toEqual(['executor:return', 'callback:start', 'callback:end', 'core:return'])
  })

  it('preserves the exact block callback payload shape', async () => {
    const rawInput = { code: 'return 1234' }
    const rawOutput = { error: 'Syntax error near 1234' }
    const rawCallbackData = {
      input: rawInput,
      output: rawOutput,
      executionTime: 10,
      startedAt: 'start',
      executionOrder: 1,
      endedAt: 'end',
    }
    const onBlockComplete = vi.fn()
    executorExecuteMock.mockImplementation(async () => {
      const contextExtensions = executorConstructorMock.mock.calls[0]?.[0]?.contextExtensions
      void contextExtensions.onBlockComplete('block-1', 'Function 1', 'function', rawCallbackData)
      return {
        success: false,
        status: 'completed',
        output: rawOutput,
        logs: [],
        metadata: { duration: 10, startTime: 'start', endTime: 'end' },
      }
    })

    await executeWorkflowCore({
      snapshot: createSnapshot() as any,
      callbacks: { onBlockComplete },
      loggingSession: loggingSession as any,
    })

    expect(projectDisplayContentMock).not.toHaveBeenCalled()
    expect(onBlockComplete.mock.calls[0]?.[3]).toBe(rawCallbackData)
  })

  it('does not invoke display projection at the functional callback boundary', async () => {
    const onBlockComplete = vi.fn()
    executorExecuteMock.mockImplementation(async () => {
      const contextExtensions = executorConstructorMock.mock.calls[0]?.[0]?.contextExtensions
      void contextExtensions.onBlockComplete('block-1', 'Function 1', 'function', {
        output: { ok: true },
        executionTime: 1,
        startedAt: 'start',
        executionOrder: 1,
        endedAt: 'end',
      })
      return {
        success: true,
        status: 'completed',
        output: { ok: true },
        logs: [],
        metadata: { duration: 1, startTime: 'start', endTime: 'end' },
      }
    })

    await executeWorkflowCore({
      snapshot: createSnapshot() as any,
      callbacks: { onBlockComplete },
      loggingSession: loggingSession as any,
    })

    expect(projectDisplayContentMock).not.toHaveBeenCalled()
    expect(onBlockComplete.mock.calls[0]?.[3]).toEqual(
      expect.objectContaining({ output: { ok: true } })
    )
    expect(onBlockComplete.mock.calls[0]?.[3]).not.toHaveProperty('display')
  })

  it('preserves successful execution when success finalization throws', async () => {
    executorExecuteMock.mockResolvedValue({
      success: true,
      status: 'completed',
      output: { done: true },
      logs: [],
      metadata: { duration: 123, startTime: 'start', endTime: 'end' },
    })

    const completionError = new Error('completion failed')
    safeCompleteMock.mockRejectedValue(completionError)

    const result = await executeWorkflowCore({
      snapshot: createSnapshot() as any,
      callbacks: {},
      loggingSession: loggingSession as any,
    })

    await loggingSession.setPostExecutionPromise.mock.calls[0][0]

    expect(result.status).toBe('completed')
    expect(clearExecutionCancellationMock).not.toHaveBeenCalled()
    expect(updateWorkflowRunCountsMock).toHaveBeenCalledWith('workflow-1')
  })

  it('retains cancellation intent when completion does not persist a terminal row', async () => {
    executorExecuteMock.mockResolvedValue({
      success: true,
      status: 'completed',
      output: { done: true },
      logs: [],
      metadata: { duration: 123, startTime: 'start', endTime: 'end' },
    })
    hasCompletedMock.mockReturnValue(false)

    const result = await executeWorkflowCore({
      snapshot: createSnapshot() as any,
      callbacks: {},
      loggingSession: loggingSession as any,
    })

    await loggingSession.setPostExecutionPromise.mock.calls[0][0]

    expect(result.status).toBe('completed')
    expect(safeCompleteMock).toHaveBeenCalledTimes(1)
    expect(clearExecutionCancellationMock).not.toHaveBeenCalled()
  })

  it('routes cancelled executions through safeCompleteWithCancellation', async () => {
    const executionState = {
      blockStates: { 'function-1': { output: { result: 'raw-secret-value' } } },
    }
    executorExecuteMock.mockResolvedValue({
      success: false,
      status: 'cancelled',
      output: {},
      logs: [],
      metadata: { duration: 123, startTime: 'start', endTime: 'end' },
      executionState,
    })

    const result = await executeWorkflowCore({
      snapshot: createSnapshot() as any,
      callbacks: {},
      loggingSession: loggingSession as any,
    })

    expect(result.status).toBe('cancelled')
    expect(safeCompleteWithCancellationMock).toHaveBeenCalledTimes(1)
    expect(safeCompleteWithCancellationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        totalDurationMs: 123,
        traceSpans: [{ id: 'span-1' }],
        executionState,
      })
    )
    expect(safeCompleteMock).not.toHaveBeenCalled()
    expect(safeCompleteWithPauseMock).not.toHaveBeenCalled()
    expect(updateWorkflowRunCountsMock).not.toHaveBeenCalled()
    expect(clearExecutionCancellationMock).toHaveBeenCalledWith('execution-1')
  })

  it('finalizes a cooperative timeout as failed without using cancellation finalization', async () => {
    const executionState = {
      blockStates: { 'function-1': { output: { partial: true } } },
    }
    const timeoutController = new AbortController()
    timeoutController.abort(new DOMException('timeout', 'AbortError'))
    executorExecuteMock.mockResolvedValue({
      success: false,
      status: 'cancelled',
      output: {},
      logs: [],
      metadata: { duration: 123, startTime: 'start', endTime: 'end' },
      executionState,
    })

    const result = await executeWorkflowCore({
      snapshot: createSnapshot() as any,
      callbacks: {},
      loggingSession: loggingSession as any,
      abortSignal: timeoutController.signal,
    })
    await loggingSession.setPostExecutionPromise.mock.calls[0][0]

    expect(result.status).toBe('cancelled')
    expect(safeCompleteWithErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        error: { message: 'Execution timed out' },
        totalDurationMs: 123,
        traceSpans: [{ id: 'span-1' }],
        executionState,
      })
    )
    expect(safeCompleteWithCancellationMock).not.toHaveBeenCalled()
    expect(clearExecutionCancellationMock).toHaveBeenCalledWith('execution-1')
  })

  /**
   * The population `runCount` actually counts. Cancelled and paused runs are
   * already pinned above; a plain failure is the case a caller is most likely to
   * assume is included, and the workflow contract's `runCount` description is
   * written against this.
   */
  it('leaves runCount untouched when the run fails', async () => {
    executorExecuteMock.mockResolvedValue({
      success: false,
      status: 'failed',
      output: {},
      logs: [],
      error: 'block threw',
      metadata: { duration: 123, startTime: 'start', endTime: 'end' },
    })

    await executeWorkflowCore({
      snapshot: createSnapshot() as any,
      callbacks: {},
      loggingSession: loggingSession as any,
    })

    await loggingSession.setPostExecutionPromise.mock.calls[0][0]

    expect(updateWorkflowRunCountsMock).not.toHaveBeenCalled()
  })

  it('routes paused executions through safeCompleteWithPause', async () => {
    const executionState = {
      blockStates: { 'function-1': { output: { result: 'raw-secret-value' } } },
    }
    executorExecuteMock.mockResolvedValue({
      success: true,
      status: 'paused',
      output: {},
      logs: [],
      metadata: { duration: 123, startTime: 'start', endTime: 'end' },
      executionState,
    })

    const result = await executeWorkflowCore({
      snapshot: createSnapshot() as any,
      callbacks: {},
      loggingSession: loggingSession as any,
    })

    expect(result.status).toBe('paused')
    expect(safeCompleteWithPauseMock).toHaveBeenCalledTimes(1)
    expect(safeCompleteWithPauseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        totalDurationMs: 123,
        traceSpans: [{ id: 'span-1' }],
        workflowInput: { hello: 'world' },
        executionState,
      })
    )
    expect(safeCompleteMock).not.toHaveBeenCalled()
    expect(safeCompleteWithCancellationMock).not.toHaveBeenCalled()
    expect(updateWorkflowRunCountsMock).not.toHaveBeenCalled()
    expect(clearExecutionCancellationMock).not.toHaveBeenCalled()
  })

  it('clears cancellation intent when pause finalization observes a persisted cancellation', async () => {
    executorExecuteMock.mockResolvedValue({
      success: true,
      status: 'paused',
      output: {},
      logs: [],
      metadata: { duration: 123, startTime: 'start', endTime: 'end' },
    })
    getPersistedCompletionStatusMock.mockReturnValue('cancelled')

    await executeWorkflowCore({
      snapshot: createSnapshot() as any,
      callbacks: {},
      loggingSession: loggingSession as any,
    })
    await loggingSession.setPostExecutionPromise.mock.calls[0][0]

    expect(clearExecutionCancellationMock).toHaveBeenCalledWith('execution-1')
  })

  it('swallows wrapped block start callback failures without breaking execution', async () => {
    onBlockStartPersistenceMock.mockRejectedValue(new Error('start persistence failed'))

    executorExecuteMock.mockImplementation(async () => {
      const contextExtensions = executorConstructorMock.mock.calls[0]?.[0]?.contextExtensions
      await contextExtensions.onBlockStart('block-1', 'Fetch', 'api', 1)

      return {
        success: true,
        status: 'completed',
        output: { done: true },
        logs: [],
        metadata: { duration: 123, startTime: 'start', endTime: 'end' },
      }
    })

    const result = await executeWorkflowCore({
      snapshot: createSnapshot() as any,
      callbacks: {},
      loggingSession: loggingSession as any,
    })

    expect(result.status).toBe('completed')
    expect(safeCompleteMock).toHaveBeenCalledTimes(1)
  })

  it('swallows wrapped block complete callback failures without blocking completion', async () => {
    const secret = 'callback-secret-7f3a91'
    const callbackError = new Error(
      `complete callback failed ${secret} __var_API_KEY __sim_code_2_binding_0`
    )
    const projectedError = 'complete callback failed {{API_KEY}} {{API_KEY}} [RUNTIME_BINDING]'
    projectDiagnosticErrorMock.mockReturnValueOnce({
      executionId: 'execution-1',
      blockId: 'block-1',
      blockType: 'api',
      error: projectedError,
    })
    executorExecuteMock.mockResolvedValue({
      success: true,
      status: 'completed',
      output: { done: true },
      logs: [],
      metadata: { duration: 123, startTime: 'start', endTime: 'end' },
    })

    await executeWorkflowCore({
      snapshot: createSnapshot() as any,
      callbacks: {
        onBlockComplete: vi.fn().mockRejectedValue(callbackError),
      },
      loggingSession: loggingSession as any,
    })

    const contextExtensions = executorConstructorMock.mock.calls[0]?.[0]?.contextExtensions

    await expect(
      contextExtensions.onBlockComplete('block-1', 'Fetch', 'api', {
        output: { ok: true },
        executionTime: 1,
        startedAt: 'start',
        endedAt: 'end',
      })
    ).resolves.toBeUndefined()
    expect(projectDiagnosticErrorMock).toHaveBeenCalledWith(callbackError, {
      executionId: 'execution-1',
      blockId: 'block-1',
      blockType: 'api',
    })
    const loggerPayload = JSON.stringify(executionCoreLogger.warn.mock.calls)
    expect(loggerPayload).toContain(projectedError)
    expect(loggerPayload).not.toContain(secret)
    expect(loggerPayload).not.toContain('__var_')
    expect(loggerPayload).not.toContain('__sim_')
    expect(callbackError.message).toContain(secret)
  })

  it('finalizes errors before rethrowing and marks them as core-finalized', async () => {
    const secret = 'core-error-secret-7f3a91'
    const rawError = `engine failed ${secret} __var_API_KEY __sim_code_1_binding_0`
    const error = new Error(rawError)
    getPersonalAndWorkspaceEnvMock.mockResolvedValue({
      personalEncrypted: {},
      workspaceEncrypted: { API_KEY: 'encrypted-api-key' },
      personalDecrypted: {},
      workspaceDecrypted: { API_KEY: secret },
    })
    const executionState = {
      blockStates: { 'function-1': { output: { result: 'raw-secret-value' } } },
    }
    const executionResult = {
      success: false,
      status: 'failed',
      output: {},
      error: rawError,
      logs: [],
      metadata: { duration: 55, startTime: 'start', endTime: 'end' },
      executionState,
    }

    Object.assign(error, { executionResult })
    executorExecuteMock.mockImplementation(async () => {
      const registry =
        executorConstructorMock.mock.calls.at(-1)?.[0]?.contextExtensions
          ?.resolvedSecretTraceRegistry
      expect(registry.recordResolved('API_KEY', secret)).toBe(true)
      throw error
    })

    await expect(
      executeWorkflowCore({
        snapshot: createSnapshot() as any,
        callbacks: {},
        loggingSession: loggingSession as any,
      })
    ).rejects.toBe(error)

    expect(safeCompleteWithErrorMock).toHaveBeenCalledTimes(1)
    expect(safeCompleteWithErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ executionState })
    )
    expect(clearExecutionCancellationMock).toHaveBeenCalledWith('execution-1')
    expect(wasExecutionFinalizedByCore(error, 'execution-1')).toBe(true)
    const loggerCalls = JSON.stringify(executionCoreLogger.error.mock.calls)
    expect(loggerCalls).toContain('{{API_KEY}}')
    expect(loggerCalls).not.toContain(secret)
    expect(loggerCalls).not.toContain('__var_')
    expect(loggerCalls).not.toContain('__sim_')
  })

  it('marks non-Error throws as core-finalized using executionId guard', async () => {
    executorExecuteMock.mockRejectedValue('engine failed')

    await expect(
      executeWorkflowCore({
        snapshot: createSnapshot() as any,
        callbacks: {},
        loggingSession: loggingSession as any,
      })
    ).rejects.toBe('engine failed')

    expect(safeCompleteWithErrorMock).toHaveBeenCalledTimes(1)
    expect(wasExecutionFinalizedByCore('engine failed', 'execution-1')).toBe(true)
    expect(wasExecutionFinalizedByCore('engine failed', 'execution-1')).toBe(true)
  })

  it('expires stale finalized execution ids for callers that never consume the guard', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-13T00:00:00.000Z'))

    executorExecuteMock.mockRejectedValue('engine failed')

    await expect(
      executeWorkflowCore({
        snapshot: {
          ...createSnapshot(),
          metadata: {
            ...createSnapshot().metadata,
            executionId: 'execution-stale',
          },
        } as any,
        callbacks: {},
        loggingSession: loggingSession as any,
      })
    ).rejects.toBe('engine failed')

    vi.setSystemTime(new Date(Date.now() + FINALIZED_EXECUTION_ID_TTL_MS + 1))

    await expect(
      executeWorkflowCore({
        snapshot: {
          ...createSnapshot(),
          metadata: {
            ...createSnapshot().metadata,
            executionId: 'execution-fresh',
          },
        } as any,
        callbacks: {},
        loggingSession: loggingSession as any,
      })
    ).rejects.toBe('engine failed')

    expect(wasExecutionFinalizedByCore('engine failed', 'execution-stale')).toBe(false)
    expect(wasExecutionFinalizedByCore('engine failed', 'execution-fresh')).toBe(true)
  })

  it('removes expired finalized ids even when a reused id stays earlier in map order', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-13T00:00:00.000Z'))

    executorExecuteMock.mockRejectedValue('engine failed')

    await expect(
      executeWorkflowCore({
        snapshot: {
          ...createSnapshot(),
          metadata: {
            ...createSnapshot().metadata,
            executionId: 'execution-a',
          },
        } as any,
        callbacks: {},
        loggingSession: loggingSession as any,
      })
    ).rejects.toBe('engine failed')

    vi.setSystemTime(new Date('2026-03-13T00:01:00.000Z'))

    await expect(
      executeWorkflowCore({
        snapshot: {
          ...createSnapshot(),
          metadata: {
            ...createSnapshot().metadata,
            executionId: 'execution-b',
          },
        } as any,
        callbacks: {},
        loggingSession: loggingSession as any,
      })
    ).rejects.toBe('engine failed')

    vi.setSystemTime(new Date('2026-03-13T00:02:00.000Z'))

    await expect(
      executeWorkflowCore({
        snapshot: {
          ...createSnapshot(),
          metadata: {
            ...createSnapshot().metadata,
            executionId: 'execution-a',
          },
        } as any,
        callbacks: {},
        loggingSession: loggingSession as any,
      })
    ).rejects.toBe('engine failed')

    vi.setSystemTime(new Date('2026-03-13T00:06:01.000Z'))

    expect(wasExecutionFinalizedByCore('engine failed', 'execution-b')).toBe(false)
    expect(wasExecutionFinalizedByCore('engine failed', 'execution-a')).toBe(true)
  })

  it('does not replace a successful outcome when success finalization rejects', async () => {
    executorExecuteMock.mockResolvedValue({
      success: true,
      status: 'completed',
      output: { done: true },
      logs: [],
      metadata: { duration: 123, startTime: 'start', endTime: 'end' },
    })

    safeCompleteMock.mockRejectedValue(new Error('completion failed'))

    const result = await executeWorkflowCore({
      snapshot: createSnapshot() as any,
      callbacks: {},
      loggingSession: loggingSession as any,
    })

    await loggingSession.setPostExecutionPromise.mock.calls[0][0]

    expect(result).toMatchObject({ status: 'completed', success: true })
    expect(clearExecutionCancellationMock).not.toHaveBeenCalled()
    expect(safeCompleteWithErrorMock).not.toHaveBeenCalled()
  })

  it('does not replace a successful outcome when cancellation cleanup fails', async () => {
    executorExecuteMock.mockResolvedValue({
      success: true,
      status: 'completed',
      output: { done: true },
      logs: [],
      metadata: { duration: 123, startTime: 'start', endTime: 'end' },
    })

    clearExecutionCancellationMock.mockRejectedValue(new Error('cleanup failed'))

    await expect(
      executeWorkflowCore({
        snapshot: createSnapshot() as any,
        callbacks: {},
        loggingSession: loggingSession as any,
      })
    ).resolves.toMatchObject({ status: 'completed', success: true })

    expect(safeCompleteWithErrorMock).not.toHaveBeenCalled()
  })

  it('does not replace the original error when cancellation cleanup fails', async () => {
    const error = new Error('engine failed')
    executorExecuteMock.mockRejectedValue(error)
    clearExecutionCancellationMock.mockRejectedValue(new Error('cleanup failed'))

    await expect(
      executeWorkflowCore({
        snapshot: createSnapshot() as any,
        callbacks: {},
        loggingSession: loggingSession as any,
      })
    ).rejects.toBe(error)

    expect(safeCompleteWithErrorMock).toHaveBeenCalledTimes(1)
  })

  it('does not mark core finalization when error completion never persists a log row', async () => {
    const error = new Error('engine failed')
    executorExecuteMock.mockRejectedValue(error)
    hasCompletedMock.mockReturnValue(false)
    const snapshot = {
      ...createSnapshot(),
      metadata: {
        ...createSnapshot().metadata,
        executionId: 'execution-unfinalized',
      },
    }

    await expect(
      executeWorkflowCore({
        snapshot: snapshot as any,
        callbacks: {},
        loggingSession: loggingSession as any,
      })
    ).rejects.toBe(error)

    expect(safeCompleteWithErrorMock).toHaveBeenCalledTimes(1)
    expect(wasExecutionFinalizedByCore(error, 'execution-unfinalized')).toBe(false)
    expect(clearExecutionCancellationMock).not.toHaveBeenCalled()
  })

  it('starts a minimal log session before error completion when setup fails early', async () => {
    const envError = new Error('env lookup failed')
    getPersonalAndWorkspaceEnvMock.mockRejectedValue(envError)

    await expect(
      executeWorkflowCore({
        snapshot: createSnapshot() as any,
        callbacks: {},
        loggingSession: loggingSession as any,
      })
    ).rejects.toBe(envError)

    expect(safeStartMock).toHaveBeenCalledTimes(1)
    expect(safeStartMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        variables: {},
      })
    )
    expect(safeCompleteWithErrorMock).toHaveBeenCalledTimes(1)
    expect(wasExecutionFinalizedByCore(envError, 'execution-1')).toBe(true)
  })

  it('skips core finalization when minimal error logging cannot start', async () => {
    const envError = new Error('env lookup failed')
    getPersonalAndWorkspaceEnvMock.mockRejectedValue(envError)
    safeStartMock.mockResolvedValue(false)
    const snapshot = {
      ...createSnapshot(),
      metadata: {
        ...createSnapshot().metadata,
        executionId: 'execution-no-log-start',
      },
    }

    await expect(
      executeWorkflowCore({
        snapshot: snapshot as any,
        callbacks: {},
        loggingSession: loggingSession as any,
      })
    ).rejects.toBe(envError)

    expect(safeStartMock).toHaveBeenCalledTimes(1)
    expect(safeCompleteWithErrorMock).not.toHaveBeenCalled()
    expect(wasExecutionFinalizedByCore(envError, 'execution-no-log-start')).toBe(false)
  })

  it('uses sessionUserId for env resolution when isClientSession is true', async () => {
    const snapshot = {
      ...createSnapshot(),
      metadata: {
        ...createSnapshot().metadata,
        isClientSession: true,
        sessionUserId: 'session-user',
        userId: 'session-user',
        workflowUserId: 'workflow-owner',
      },
    }

    getPersonalAndWorkspaceEnvMock.mockResolvedValue({
      personalEncrypted: {},
      workspaceEncrypted: {},
      personalDecrypted: {},
      workspaceDecrypted: {},
    })
    safeStartMock.mockResolvedValue(true)
    executorExecuteMock.mockResolvedValue({
      output: { done: true },
      logs: [],
      metadata: { duration: 123, startTime: 'start', endTime: 'end' },
    })

    await executeWorkflowCore({
      snapshot: snapshot as any,
      callbacks: {},
      loggingSession: loggingSession as any,
    })

    expect(getPersonalAndWorkspaceEnvMock).toHaveBeenCalledWith('session-user', 'workspace-1')
    expect(getPersonalAndWorkspaceEnvMock).not.toHaveBeenCalledWith('workflow-owner', 'workspace-1')
  })

  it('resolves personal vars as the workflow owner and workspace vars as the actor', async () => {
    const snapshot = {
      ...createSnapshot(),
      metadata: {
        ...createSnapshot().metadata,
        isClientSession: false,
        sessionUserId: undefined,
        workflowUserId: 'workflow-owner',
        userId: 'billing-actor',
      },
    }

    getPersonalAndWorkspaceEnvMock.mockImplementation(async (userId: string) => ({
      personalEncrypted: { PERSONAL: `enc-personal-${userId}` },
      workspaceEncrypted: { WORKSPACE: `enc-workspace-${userId}` },
      personalDecrypted: { PERSONAL: `personal-${userId}` },
      workspaceDecrypted: { WORKSPACE: `workspace-${userId}` },
      personalOwners: {},
      conflicts: [],
      decryptionFailures: [],
    }))
    safeStartMock.mockResolvedValue(true)
    executorExecuteMock.mockResolvedValue({
      output: { done: true },
      logs: [],
      metadata: { duration: 123, startTime: 'start', endTime: 'end' },
    })

    await executeWorkflowCore({
      snapshot: snapshot as any,
      callbacks: {},
      loggingSession: loggingSession as any,
    })

    expect(getPersonalAndWorkspaceEnvMock).toHaveBeenCalledWith('workflow-owner', 'workspace-1')
    expect(getPersonalAndWorkspaceEnvMock).toHaveBeenCalledWith('billing-actor', 'workspace-1')
    expect(executorConstructorMock.mock.calls[0]?.[0]?.envVarValues).toEqual({
      PERSONAL: 'personal-workflow-owner',
      WORKSPACE: 'workspace-billing-actor',
    })
  })

  it('resolves no personal vars and workspace vars as the billing account on a public-API run', async () => {
    const snapshot = {
      ...createSnapshot(),
      metadata: {
        ...createSnapshot().metadata,
        isClientSession: false,
        sessionUserId: undefined,
        enforceCredentialAccess: false,
        isPublicApiAccess: true,
        workflowUserId: 'workflow-owner',
        userId: 'billing-account',
      },
    }

    getPersonalAndWorkspaceEnvMock.mockImplementation(async (userId: string) => ({
      personalEncrypted: { PERSONAL: `enc-personal-${userId}` },
      workspaceEncrypted: { WORKSPACE: `enc-workspace-${userId}` },
      personalDecrypted: { PERSONAL: `personal-${userId}` },
      workspaceDecrypted: { WORKSPACE: `workspace-${userId}` },
      personalOwners: {},
      conflicts: [],
      decryptionFailures: [],
    }))
    safeStartMock.mockResolvedValue(true)
    executorExecuteMock.mockResolvedValue({
      output: { done: true },
      logs: [],
      metadata: { duration: 123, startTime: 'start', endTime: 'end' },
    })

    await executeWorkflowCore({
      snapshot: snapshot as any,
      callbacks: {},
      loggingSession: loggingSession as any,
    })

    expect(getPersonalAndWorkspaceEnvMock).toHaveBeenCalledWith('billing-account', 'workspace-1')
    expect(getPersonalAndWorkspaceEnvMock).not.toHaveBeenCalledWith('workflow-owner', 'workspace-1')
    expect(executorConstructorMock.mock.calls[0]?.[0]?.envVarValues).toEqual({
      WORKSPACE: 'workspace-billing-account',
    })
  })

  it('resolves both slices as the caller when the run has an identifiable one', async () => {
    const snapshot = {
      ...createSnapshot(),
      metadata: {
        ...createSnapshot().metadata,
        isClientSession: false,
        sessionUserId: undefined,
        enforceCredentialAccess: true,
        workflowUserId: 'workflow-owner',
        userId: 'api-key-caller',
      },
    }

    getPersonalAndWorkspaceEnvMock.mockImplementation(async (userId: string) => ({
      personalEncrypted: { PERSONAL: `enc-personal-${userId}` },
      workspaceEncrypted: {},
      personalDecrypted: { PERSONAL: `personal-${userId}` },
      workspaceDecrypted: {},
      personalOwners: {},
      conflicts: [],
      decryptionFailures: [],
    }))
    safeStartMock.mockResolvedValue(true)
    executorExecuteMock.mockResolvedValue({
      output: { done: true },
      logs: [],
      metadata: { duration: 123, startTime: 'start', endTime: 'end' },
    })

    await executeWorkflowCore({
      snapshot: snapshot as any,
      callbacks: {},
      loggingSession: loggingSession as any,
    })

    expect(getPersonalAndWorkspaceEnvMock).toHaveBeenCalledWith('api-key-caller', 'workspace-1')
    expect(getPersonalAndWorkspaceEnvMock).not.toHaveBeenCalledWith('workflow-owner', 'workspace-1')
    expect(executorConstructorMock.mock.calls[0]?.[0]?.envVarValues).toEqual({
      PERSONAL: 'personal-api-key-caller',
    })
  })

  it('throws when workflowUserId is missing in server-side execution', async () => {
    const snapshot = {
      ...createSnapshot(),
      metadata: {
        ...createSnapshot().metadata,
        isClientSession: false,
        sessionUserId: undefined,
        workflowUserId: undefined,
        userId: 'billing-actor',
      },
    }

    await expect(
      executeWorkflowCore({
        snapshot: snapshot as any,
        callbacks: {},
        loggingSession: loggingSession as any,
      })
    ).rejects.toThrow('Missing workflowUserId in execution metadata')
  })
})
