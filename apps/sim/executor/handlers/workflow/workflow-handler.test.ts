import { encryptionMockFns, environmentUtilsMockFns, resetEnvironmentUtilsMock } from '@sim/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { createTimeoutAbortController, getExecutionDeadlineAt } from '@/lib/core/execution-limits'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getBlock } from '@/blocks/registry'
import { BlockType } from '@/executor/constants'
import {
  findMissingRequiredCustomBlockInputs,
  remapCustomBlockInputKeys,
  WorkflowBlockHandler,
} from '@/executor/handlers/workflow/workflow-handler'
import type { ExecutionContext } from '@/executor/types'
import {
  ANONYMOUS_SECRET_TRACE_REPLACEMENT,
  ResolvedSecretTraceRegistry,
} from '@/executor/utils/resolved-secret-trace-registry'
import type { SerializedBlock } from '@/serializer/types'

const {
  mockExecutorExecute,
  mockCreateSnapshot,
  mockResolveBillingAttribution,
  mockGetCustomBlockAuthority,
  mockGetUserEmailById,
  mockAdmitCustomBlockChildExecution,
  mockTrackChildRun,
  mockBuildTraceSpans,
  mockSafeStart,
  mockSafeComplete,
  mockSafeCompleteWithError,
  mockSafeCompleteWithCancellation,
  mockSetResolvedSecretTraceRegistry,
  mockSetExecutionDeadlineAt,
  mockSetTraceLargeValueAccess,
  mockDispose,
  mockReadWorkflowDefinitionAsExecutor,
  mockCheckWorkspaceAccess,
  mockProjectTraceSpansForLiveDisplay,
  executorOptions,
  loggingSessionArgs,
} = vi.hoisted(() => ({
  mockExecutorExecute: vi.fn(),
  mockCreateSnapshot: vi.fn(),
  mockResolveBillingAttribution: vi.fn(),
  mockGetCustomBlockAuthority: vi.fn(),
  mockCheckWorkspaceAccess: vi.fn(),
  mockProjectTraceSpansForLiveDisplay: vi.fn(),
  mockGetUserEmailById: vi.fn(),
  mockAdmitCustomBlockChildExecution: vi.fn(),
  mockTrackChildRun: vi.fn(),
  mockBuildTraceSpans: vi.fn(),
  mockSafeStart: vi.fn(),
  mockSafeComplete: vi.fn(),
  mockSafeCompleteWithError: vi.fn(),
  mockSafeCompleteWithCancellation: vi.fn(),
  mockSetResolvedSecretTraceRegistry: vi.fn(),
  mockSetExecutionDeadlineAt: vi.fn(),
  mockSetTraceLargeValueAccess: vi.fn(),
  mockDispose: vi.fn(),
  mockReadWorkflowDefinitionAsExecutor: vi.fn(),
  executorOptions: [] as Array<Record<string, any>>,
  loggingSessionArgs: [] as Array<any[]>,
}))

vi.mock('@/lib/logs/execution/logging-session', () => ({
  LoggingSession: class {
    constructor(...args: any[]) {
      loggingSessionArgs.push(args)
    }
    safeStart = mockSafeStart
    safeComplete = mockSafeComplete
    safeCompleteWithError = mockSafeCompleteWithError
    safeCompleteWithCancellation = mockSafeCompleteWithCancellation
    setExecutionDeadlineAt = mockSetExecutionDeadlineAt
    setResolvedSecretTraceRegistry = mockSetResolvedSecretTraceRegistry
    setTraceLargeValueAccess = mockSetTraceLargeValueAccess
    projectTraceSpansForLiveDisplay = mockProjectTraceSpansForLiveDisplay
    onBlockStart = vi.fn()
    onBlockComplete = vi.fn()
  },
}))

vi.mock('@/lib/logs/execution/trace-spans/trace-spans', () => ({
  buildTraceSpans: mockBuildTraceSpans,
}))

vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: encryptionMockFns.mockDecryptSecret,
  encryptSecret: encryptionMockFns.mockEncryptSecret,
}))

vi.mock('@/lib/workflows/custom-blocks/child-execution', () => ({
  admitCustomBlockChildExecution: mockAdmitCustomBlockChildExecution,
  trackChildRun: mockTrackChildRun,
  buildCustomBlockCorrelation: (params: Record<string, any>) =>
    params.invokerExecutionId
      ? { source: 'custom_block', executionId: params.invokerExecutionId }
      : undefined,
  createChildCancellationSignal: () => ({
    signal: new AbortController().signal,
    dispose: mockDispose,
  }),
}))

vi.mock('@/executor', () => ({
  Executor: class {
    constructor(options: Record<string, any>) {
      executorOptions.push(options)
    }
    execute = mockExecutorExecute
  },
}))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  resolveBillingAttribution: mockResolveBillingAttribution,
}))

const mockGetPersonalAndWorkspaceEnv = environmentUtilsMockFns.mockGetPersonalAndWorkspaceEnv

vi.mock('@/lib/workflows/custom-blocks/operations', () => ({
  getCustomBlockAuthority: mockGetCustomBlockAuthority,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: mockCheckWorkspaceAccess,
}))

vi.mock('@/lib/users/queries', () => ({
  getUserEmailById: mockGetUserEmailById,
}))

vi.mock('@/lib/internal/workflows/read-definition', () => ({
  readWorkflowDefinitionAsExecutor: mockReadWorkflowDefinitionAsExecutor,
}))

/**
 * Overrides the global registry mock's getBlock so the Serializer can carry the
 * start block's runMetadata param through child deployed-state serialization.
 */
function getBlockOverride(type: string) {
  if (type === 'start_trigger') {
    return {
      name: 'Start',
      description: 'Unified workflow entry point',
      category: 'triggers',
      bgColor: '#34B5FF',
      icon: () => null,
      subBlocks: [
        { id: 'inputFormat', title: 'Inputs', type: 'input-format' },
        { id: 'runMetadata', title: 'Add run metadata', type: 'switch', defaultValue: false },
      ],
      inputs: {},
      outputs: {},
      tools: { access: [] },
      triggers: { enabled: true, available: ['chat', 'manual', 'api'] },
    }
  }
  return {
    name: 'Mock Block',
    description: 'Mock block description',
    icon: () => null,
    subBlocks: [],
    inputs: {},
    outputs: {},
    tools: { access: [] },
  }
}

const mockGetBlock = getBlock as Mock
const defaultGetBlockImpl = mockGetBlock.getMockImplementation()

beforeAll(() => {
  mockGetBlock.mockImplementation(getBlockOverride)
})

afterAll(() => {
  mockGetBlock.mockImplementation(defaultGetBlockImpl as () => unknown)
  resetEnvironmentUtilsMock()
})

vi.mock('@/lib/logs/execution/snapshot/service', () => ({
  snapshotService: { createSnapshotWithDeduplication: mockCreateSnapshot },
}))

vi.mock('@/lib/auth/internal', () => ({
  generateInternalToken: vi.fn().mockResolvedValue('test-token'),
}))

describe('WorkflowBlockHandler', () => {
  let handler: WorkflowBlockHandler
  let mockBlock: SerializedBlock
  let mockContext: ExecutionContext
  let mockFetch: Mock

  beforeEach(() => {
    // Mock window.location.origin for getBaseUrl(); stubGlobal so unstubGlobals cleans it up
    vi.stubGlobal('window', {
      location: {
        origin: 'http://localhost:3000',
      },
    })
    handler = new WorkflowBlockHandler()

    // unstubGlobals removes any module-scope fetch stub before each test, so stub fresh here
    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    mockBlock = {
      id: 'workflow-block-1',
      metadata: { id: BlockType.WORKFLOW, name: 'Test Workflow Block' },
      position: { x: 0, y: 0 },
      config: { tool: BlockType.WORKFLOW, params: {} },
      inputs: { workflowId: 'string' },
      outputs: {},
      enabled: true,
    }

    mockContext = {
      workflowId: 'parent-workflow-id',
      executionId: 'parent-execution-id',
      userId: 'user-1',
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      executorDelegationOrigin: {
        subjectUserId: 'user-1',
        workflowId: 'parent-workflow-id',
        executionId: 'parent-execution-id',
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        currentWorkflow: { workflowId: 'parent-workflow-id', mode: 'draft' },
      },
      blockStates: new Map(),
      blockLogs: [],
      metadata: {
        duration: 0,
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      },
      environmentVariables: {},
      decisions: { router: new Map(), condition: new Map() },
      loopExecutions: new Map(),
      executedBlocks: new Set(),
      activeExecutionPath: new Set(),
      completedLoops: new Set(),
      workflow: {
        version: '1.0',
        blocks: [],
        connections: [],
        loops: {},
      },
    }

    // Reset all mocks
    vi.clearAllMocks()
    executorOptions.length = 0
    loggingSessionArgs.length = 0
    mockSafeStart.mockResolvedValue(true)
    mockAdmitCustomBlockChildExecution.mockResolvedValue(undefined)
    mockBuildTraceSpans.mockReturnValue({ traceSpans: [], totalDuration: 0 })
    // Setup default fetch mock
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            name: 'Child Workflow',
            state: {
              blocks: [
                {
                  id: 'starter',
                  metadata: { id: BlockType.STARTER, name: 'Starter' },
                  position: { x: 0, y: 0 },
                  config: { tool: BlockType.STARTER, params: {} },
                  inputs: {},
                  outputs: {},
                  enabled: true,
                },
              ],
              edges: [],
              loops: {},
              parallels: {},
            },
          },
        }),
    })
    mockReadWorkflowDefinitionAsExecutor.mockImplementation(
      async ({ workflowId, state }: { workflowId: string; state: 'draft' | 'deployed' }) => {
        const response = await mockFetch(
          state === 'deployed'
            ? `http://localhost:3000/api/workflows/${workflowId}/deployed`
            : `http://localhost:3000/api/workflows/${workflowId}`
        )
        if (!response.ok) {
          if (response.status === 404) {
            throw new OrchestrationError('not_found', 'Workflow not found')
          }
          throw new Error(`Failed to read workflow: ${response.status} ${response.statusText}`)
        }

        const json = await response.json()
        if (state === 'draft') {
          const data = json.data
          return {
            workflow: {
              id: workflowId,
              name: data?.name,
              workspaceId: data?.workspaceId,
              variables: data?.variables ?? {},
            },
            workspaceId: data?.workspaceId,
            state: data?.state,
          }
        }

        const deployedState = json?.data?.deployedState ?? json?.deployedState ?? null
        if (!deployedState) {
          return {
            workflow: { id: workflowId, name: workflowId, variables: {} },
            workspaceId: undefined,
            state: null,
          }
        }

        const metadataResponse = await mockFetch(
          `http://localhost:3000/api/workflows/${workflowId}`
        )
        if (!metadataResponse.ok) {
          throw new Error(
            `Failed to read workflow metadata: ${metadataResponse.status} ${metadataResponse.statusText}`
          )
        }
        const metadata = (await metadataResponse.json())?.data
        return {
          workflow: {
            id: workflowId,
            name: metadata?.name,
            workspaceId: metadata?.workspaceId,
            variables: metadata?.variables ?? {},
          },
          workspaceId: metadata?.workspaceId,
          state: deployedState,
        }
      }
    )
  })

  describe('execute', () => {
    it('should enforce maximum call chain depth limit', async () => {
      const inputs = { workflowId: 'child-workflow-id' }

      const deepContext = {
        ...mockContext,
        callChain: Array.from({ length: 25 }, (_, i) => `wf-${i}`),
      }

      await expect(handler.execute(deepContext, mockBlock, inputs)).rejects.toThrow(
        'Maximum workflow call chain depth (25) exceeded'
      )
    })
  })

  describe('workspace containment', () => {
    const inputs = { workflowId: 'child-workflow-id' }

    it('should fail a cross-workspace child in the draft loader path', async () => {
      const ctx = {
        ...mockContext,
        workspaceId: 'workspace-parent',
        executionId: 'parent-execution-id',
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              name: 'Foreign Workflow',
              workspaceId: 'workspace-other',
              state: { blocks: {}, edges: [], loops: {}, parallels: {} },
            },
          }),
      })

      await expect(handler.execute(ctx, mockBlock, inputs)).rejects.toThrow(
        'Child workflow child-workflow-id belongs to a different workspace and cannot be executed'
      )
      expect(mockCreateSnapshot).not.toHaveBeenCalled()
      expect(mockExecutorExecute).not.toHaveBeenCalled()
      expect(mockReadWorkflowDefinitionAsExecutor).toHaveBeenCalledWith(
        expect.objectContaining({
          origin: {
            subjectUserId: 'user-1',
            workflowId: 'parent-workflow-id',
            executionId: 'parent-execution-id',
            principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
            currentWorkflow: { workflowId: 'parent-workflow-id', mode: 'draft' },
          },
        })
      )
    })

    it("runs a non-custom child under the parent's env and redaction policy", async () => {
      const piiBlockOutputRedaction = {
        enabled: true,
        entityTypes: ['EMAIL_ADDRESS'],
        language: 'en',
      }
      const ctx = {
        ...mockContext,
        workspaceId: 'workspace-parent',
        environmentVariables: { MY_API_KEY: 'parent-secret' },
        piiBlockOutputRedaction,
      } as unknown as ExecutionContext

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              name: 'Child Workflow',
              workspaceId: 'workspace-parent',
              state: { blocks: {}, edges: [], loops: {}, parallels: {} },
            },
          }),
      })
      mockCreateSnapshot.mockResolvedValue({ snapshot: { id: 'snapshot-1' } })
      mockExecutorExecute.mockResolvedValue({ success: true, output: { data: 'ok' } })

      await handler.execute(ctx, mockBlock, inputs)

      expect(executorOptions).toHaveLength(1)
      expect(executorOptions[0].envVarValues).toEqual({ MY_API_KEY: 'parent-secret' })
      expect(executorOptions[0].contextExtensions.piiBlockOutputRedaction).toBe(
        piiBlockOutputRedaction
      )
      expect(mockGetPersonalAndWorkspaceEnv).not.toHaveBeenCalled()
    })

    it('resolves a source-scoped billing attribution for custom block children', async () => {
      const consumerAttribution = { actorUserId: 'consumer-1', workspaceId: 'workspace-consumer' }
      const sourceAttribution = { actorUserId: 'owner-9', workspaceId: 'workspace-source' }
      const customBlock = {
        ...mockBlock,
        metadata: { id: 'custom_block_abc', name: 'Published Block' },
      }
      const ctx = {
        ...mockContext,
        workspaceId: 'workspace-consumer',
        metadata: { ...mockContext.metadata, billingAttribution: consumerAttribution },
      } as unknown as ExecutionContext

      mockGetCustomBlockAuthority.mockResolvedValue({
        workflowId: 'source-workflow-id',
        organizationId: 'org-1',
        ownerUserId: 'owner-9',
        exposedOutputs: [{ blockId: 'b1', path: 'content', name: 'answer' }],
        requiredInputIds: [],
      })
      mockGetPersonalAndWorkspaceEnv.mockResolvedValue({
        personalDecrypted: {},
        workspaceDecrypted: {},
      })
      mockResolveBillingAttribution.mockResolvedValue(sourceAttribution)
      mockFetch.mockImplementation(async (url: unknown) => {
        if (String(url).includes('/deployed')) {
          return {
            ok: true,
            json: () =>
              Promise.resolve({
                data: {
                  deployedState: {
                    blocks: {},
                    edges: [],
                    loops: {},
                    parallels: {},
                    deploymentVersionId: 'deployment-version-1',
                  },
                },
              }),
          }
        }
        return {
          ok: true,
          json: () =>
            Promise.resolve({
              data: {
                name: 'Source Workflow',
                workspaceId: 'workspace-source',
                variables: {},
              },
            }),
        }
      })
      mockCreateSnapshot.mockResolvedValue({ snapshot: { id: 'snapshot-1' } })
      mockExecutorExecute.mockResolvedValue({ success: true, output: { data: 'ok' } })

      await handler.execute(ctx, customBlock, {})

      expect(mockReadWorkflowDefinitionAsExecutor).toHaveBeenCalledWith(
        expect.objectContaining({
          origin: {
            subjectUserId: 'owner-9',
            workflowId: 'source-workflow-id',
          },
        })
      )
      expect(mockResolveBillingAttribution).toHaveBeenCalledWith({
        actorUserId: 'owner-9',
        workspaceId: 'workspace-source',
      })
      expect(executorOptions).toHaveLength(1)
      expect(executorOptions[0].contextExtensions.billingAttribution).toBe(sourceAttribution)
      expect(executorOptions[0].contextExtensions.userId).toBe('owner-9')
      expect(executorOptions[0].contextExtensions.workspaceId).toBe('workspace-source')
      expect(executorOptions[0].contextExtensions.executorDelegationOrigin).toEqual({
        workflowId: 'source-workflow-id',
        executionId: loggingSessionArgs[0][1],
        currentWorkflow: {
          workflowId: 'source-workflow-id',
          mode: 'deployment',
          deploymentVersionId: 'deployment-version-1',
        },
        principal: {
          kind: 'system',
          serviceId: 'internal',
          workspaceId: 'workspace-source',
          workflowId: 'source-workflow-id',
        },
      })
    })

    /**
     * A custom block's child is a deployed run of the source workflow, so it
     * must resolve secrets the way a schedule on that workflow does: personal
     * variables from the publisher, workspace variables authorized against the
     * source workspace's billing account. Reading both slices as the publisher
     * gave the child a narrower workspace selection than the same workflow got
     * on any other trigger, and failed outright once the publisher left.
     */
    it('resolves a custom block child under the publisher plus the source billing account', async () => {
      const customBlock = {
        ...mockBlock,
        metadata: { id: 'custom_block_abc', name: 'Published Block' },
      }
      const ctx = {
        ...mockContext,
        workspaceId: 'workspace-consumer',
      } as unknown as ExecutionContext

      mockGetCustomBlockAuthority.mockResolvedValue({
        workflowId: 'source-workflow-id',
        organizationId: 'org-1',
        ownerUserId: 'owner-9',
        exposedOutputs: [{ blockId: 'b1', path: 'content', name: 'answer' }],
        requiredInputIds: [],
      })
      mockResolveBillingAttribution.mockResolvedValue({
        actorUserId: 'owner-9',
        workspaceId: 'workspace-source',
        billedAccountUserId: 'billing-account-9',
      })
      mockFetch.mockImplementation(async (url: unknown) => {
        if (String(url).includes('/deployed')) {
          return {
            ok: true,
            json: () =>
              Promise.resolve({
                data: {
                  deployedState: {
                    blocks: {},
                    edges: [],
                    loops: {},
                    parallels: {},
                    deploymentVersionId: 'deployment-version-1',
                  },
                },
              }),
          }
        }
        return {
          ok: true,
          json: () =>
            Promise.resolve({
              data: { name: 'Source Workflow', workspaceId: 'workspace-source', variables: {} },
            }),
        }
      })
      mockCreateSnapshot.mockResolvedValue({ snapshot: { id: 'snapshot-1' } })
      mockExecutorExecute.mockResolvedValue({ success: true, output: { data: 'ok' } })

      await handler.execute(ctx, customBlock, {})

      expect(environmentUtilsMockFns.mockGetExecutionEnvironment).toHaveBeenCalledWith(
        'owner-9',
        'billing-account-9',
        'workspace-source'
      )
    })

    it('builds trusted caller metadata for custom block children with the toggle on', async () => {
      const customBlock = {
        ...mockBlock,
        metadata: { id: 'custom_block_abc', name: 'Published Block' },
      }
      const ctx = {
        ...mockContext,
        userId: 'consumer-1',
        principal: { kind: 'session', userId: 'consumer-1', sessionId: 'session-consumer' },
        workspaceId: 'workspace-consumer',
        executionId: 'exec-1',
      } as ExecutionContext

      mockGetCustomBlockAuthority.mockResolvedValue({
        workflowId: 'source-workflow-id',
        organizationId: 'org-1',
        ownerUserId: 'owner-9',
        exposedOutputs: [{ blockId: 'b1', path: 'content', name: 'answer' }],
        requiredInputIds: [],
      })
      mockGetPersonalAndWorkspaceEnv.mockResolvedValue({
        personalDecrypted: {},
        workspaceDecrypted: {},
      })
      mockResolveBillingAttribution.mockResolvedValue({
        actorUserId: 'owner-9',
        workspaceId: 'workspace-source',
      })
      mockGetUserEmailById.mockImplementation(async (userId: string) =>
        userId === 'owner-9' ? 'owner@source.com' : userId === 'consumer-1' ? 'a@corp.com' : null
      )
      mockFetch.mockImplementation(async (url: unknown) => {
        if (String(url).includes('/deployed')) {
          return {
            ok: true,
            json: () =>
              Promise.resolve({
                data: {
                  deployedState: {
                    blocks: {
                      start: {
                        id: 'start',
                        type: 'start_trigger',
                        name: 'Start',
                        position: { x: 0, y: 0 },
                        subBlocks: {
                          runMetadata: { id: 'runMetadata', type: 'switch', value: true },
                        },
                        outputs: {},
                        enabled: true,
                      },
                    },
                    edges: [],
                    loops: {},
                    parallels: {},
                    deploymentVersionId: 'deployment-version-1',
                  },
                },
              }),
          }
        }
        return {
          ok: true,
          json: () =>
            Promise.resolve({
              data: {
                name: 'Source Workflow',
                workspaceId: 'workspace-source',
                variables: {},
              },
            }),
        }
      })
      mockCreateSnapshot.mockResolvedValue({ snapshot: { id: 'snapshot-1' } })
      mockExecutorExecute.mockResolvedValue({ success: true, output: { data: 'ok' } })

      await handler.execute(ctx, customBlock, {})

      expect(executorOptions).toHaveLength(1)
      const startRunMetadata = executorOptions[0].contextExtensions.startRunMetadata
      expect(startRunMetadata).toMatchObject({
        subject: {
          kind: 'sim_user',
          userId: 'consumer-1',
          email: 'a@corp.com',
        },
        workspaceId: 'workspace-consumer',
        workflowId: 'parent-workflow-id',
        executionId: 'exec-1',
        executionType: 'workflow',
      })
      expect(mockGetUserEmailById).toHaveBeenCalledWith('consumer-1')
      expect(mockGetUserEmailById).not.toHaveBeenCalledWith('owner-9')
      expect(startRunMetadata).not.toHaveProperty('userId')
      expect(typeof startRunMetadata.startTime).toBe('string')
    })

    it('preserves an actorless inherited subject instead of inventing an identity', async () => {
      const ctx = {
        ...mockContext,
        userId: 'publisher-1',
        workspaceId: 'workspace-parent',
        startRunMetadata: {
          subject: null,
          workspaceId: 'workspace-original',
          workflowId: 'workflow-original',
        },
      } as ExecutionContext

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              name: 'Child Workflow',
              workspaceId: 'workspace-parent',
              state: {
                blocks: {
                  start: {
                    id: 'start',
                    type: 'start_trigger',
                    name: 'Start',
                    position: { x: 0, y: 0 },
                    subBlocks: {
                      runMetadata: { id: 'runMetadata', type: 'switch', value: true },
                    },
                    outputs: {},
                    enabled: true,
                  },
                },
                edges: [],
                loops: {},
                parallels: {},
              },
            },
          }),
      })
      mockCreateSnapshot.mockResolvedValue({ snapshot: { id: 'snapshot-1' } })
      mockExecutorExecute.mockResolvedValue({ success: true, output: { data: 'ok' } })

      await handler.execute(ctx, mockBlock, inputs)

      expect(executorOptions).toHaveLength(1)
      expect(executorOptions[0].contextExtensions.startRunMetadata.subject).toBeNull()
      expect(mockGetUserEmailById).not.toHaveBeenCalled()
    })

    it('should fail closed when the executing context has no workspace', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              name: 'Child Workflow',
              workspaceId: 'workspace-parent',
              state: { blocks: {}, edges: [], loops: {}, parallels: {} },
            },
          }),
      })

      await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
        'Cannot execute child workflow child-workflow-id: executing context has no workspace'
      )
      expect(mockExecutorExecute).not.toHaveBeenCalled()
    })
  })

  describe('mapChildOutputToParent', () => {
    it('should throw error for failed child output so BlockExecutor can check error port', () => {
      const childResult = {
        success: false,
        error: 'Child workflow failed',
      }

      expect(() =>
        (handler as any).mapChildOutputToParent(childResult, 'child-id', 'Child Workflow', 100)
      ).toThrow('"Child Workflow" failed: Child workflow failed')

      try {
        ;(handler as any).mapChildOutputToParent(childResult, 'child-id', 'Child Workflow', 100)
      } catch (error: any) {
        expect(error.childTraceSpans).toEqual([])
      }
    })
  })

  describe('custom block child execution', () => {
    const customBlock = () => ({
      ...mockBlock,
      metadata: { id: 'custom_block_abc', name: 'Published Block' },
    })

    function customBlockContext(overrides: Record<string, any> = {}) {
      return {
        ...mockContext,
        workspaceId: 'workspace-consumer',
        executionId: 'parent-execution-id',
        metadata: { ...mockContext.metadata, requestId: 'req-1' },
        ...overrides,
      } as unknown as ExecutionContext
    }

    beforeEach(() => {
      mockGetCustomBlockAuthority.mockResolvedValue({
        workflowId: 'source-workflow-id',
        organizationId: 'org-1',
        ownerUserId: 'owner-9',
        exposedOutputs: [{ blockId: 'b1', path: 'content', name: 'answer' }],
        requiredInputIds: [],
        // Publisher opted this block's runs into consumer traces; the tests that
        // exercise the closed path override it.
        traceChildRuns: true,
      })
      mockGetPersonalAndWorkspaceEnv.mockResolvedValue({
        personalDecrypted: {},
        workspaceDecrypted: {},
        personalEncrypted: { SECRET: 'enc' },
        workspaceEncrypted: {},
      })
      mockResolveBillingAttribution.mockResolvedValue({
        actorUserId: 'owner-9',
        workspaceId: 'workspace-source',
      })
      mockFetch.mockImplementation(async (url: unknown) => {
        if (String(url).includes('/deployed')) {
          return {
            ok: true,
            json: () =>
              Promise.resolve({
                data: {
                  deployedState: {
                    blocks: {},
                    edges: [],
                    loops: {},
                    parallels: {},
                    deploymentVersionId: 'deployment-version-1',
                  },
                },
              }),
          }
        }
        return {
          ok: true,
          json: () =>
            Promise.resolve({
              data: { name: 'Source Workflow', workspaceId: 'workspace-source', variables: {} },
            }),
        }
      })
      mockCreateSnapshot.mockResolvedValue({ snapshot: { id: 'snapshot-1' } })
      mockExecutorExecute.mockResolvedValue({ success: true, output: { data: 'ok' } })
    })

    describe('live child spans for the terminal reconcile', () => {
      const rawSpan = { id: 's1', name: 'Agent 1', type: 'agent', blockId: 'b1' }
      const projectedSpan = { ...rawSpan, input: { key: '{{PUBLISHER_SECRET}}' } }

      beforeEach(() => {
        mockBuildTraceSpans.mockReturnValue({ traceSpans: [rawSpan], totalDuration: 5 })
        mockProjectTraceSpansForLiveDisplay.mockResolvedValue([projectedSpan])
      })

      it('emits NOTHING when there is no identified live consumer', async () => {
        const output: any = await handler.execute(customBlockContext(), customBlock(), {})

        expect(output.childTraceSpans).toBeUndefined()
        expect(mockProjectTraceSpansForLiveDisplay).not.toHaveBeenCalled()
      })

      it('projects through the CHILD session before handing spans to a live consumer', async () => {
        // The invoking run's registry knows nothing about the publisher's secrets, so
        // projecting there would leave a source-owner credential unmasked in the consumer's
        // stream. Only the child's own session can mask them.

        const output: any = await handler.execute(
          customBlockContext({ liveTraceViewerUserId: 'viewer-1' }),
          customBlock(),
          {}
        )

        expect(mockProjectTraceSpansForLiveDisplay).toHaveBeenCalledTimes(1)
        expect(output.childTraceSpans).toEqual([projectedSpan])
        // The raw, unprojected span must never be what crosses the boundary.
        expect(output.childTraceSpans).not.toEqual([rawSpan])
        // Correlation for the reconcile: without this the terminal cannot match the rows.
        expect(output._childWorkflowInstanceId).toBeTruthy()
      })

      it("streams via the emit-only sink, never the parent run's persisting callbacks", async () => {
        // `ctx.onBlockStart/onBlockComplete` on the invoking run are persist-then-emit
        // composites: they write block names and I/O into the PARENT's LoggingSession.
        // Those markers are keyed by the parent execution and readable by anyone with
        // parent-workspace access, long after the per-viewer gate this stream passed — so
        // the source workflow's blocks must reach the emit half only.
        const persistingStart = vi.fn()
        const persistingComplete = vi.fn()
        const emitOnlyStart = vi.fn()
        const emitOnlyComplete = vi.fn()

        await handler.execute(
          customBlockContext({
            liveTraceViewerUserId: 'viewer-1',
            onBlockStart: persistingStart,
            onBlockComplete: persistingComplete,
            liveStreamCallbacks: { onBlockStart: emitOnlyStart, onBlockComplete: emitOnlyComplete },
          }),
          customBlock(),
          {}
        )

        const forwarded = executorOptions[0].contextExtensions
        await forwarded.onBlockStart?.('b1', 'Publisher Agent', 'agent', 1)
        await forwarded.onBlockComplete?.('b1', 'Publisher Agent', 'agent', {})

        expect(emitOnlyStart).toHaveBeenCalledTimes(1)
        expect(emitOnlyComplete).toHaveBeenCalledTimes(1)
        expect(persistingStart).not.toHaveBeenCalled()
        expect(persistingComplete).not.toHaveBeenCalled()
      })

      it('withholds both the viewer id and the sink when streaming is not permitted', async () => {
        mockGetCustomBlockAuthority.mockResolvedValue({
          workflowId: 'source-workflow-id',
          organizationId: 'org-1',
          ownerUserId: 'owner-9',
          exposedOutputs: [{ blockId: 'b1', path: 'content', name: 'answer' }],
          requiredInputIds: [],
          traceChildRuns: false,
        })
        const emitOnly = { onBlockStart: vi.fn(), onBlockComplete: vi.fn() }

        await handler.execute(
          customBlockContext({
            liveTraceViewerUserId: 'consumer-1',
            liveStreamCallbacks: emitOnly,
          }),
          customBlock(),
          {}
        )

        const forwarded = executorOptions[0].contextExtensions
        expect(forwarded.liveTraceViewerUserId).toBeUndefined()
        expect(forwarded.liveStreamCallbacks).toBeUndefined()
      })
    })

    describe("the publisher's trace policy", () => {
      /** Republish the block with tracing closed, the shipped default. */
      function closeTracePolicy() {
        mockGetCustomBlockAuthority.mockResolvedValue({
          workflowId: 'source-workflow-id',
          organizationId: 'org-1',
          ownerUserId: 'owner-9',
          exposedOutputs: [{ blockId: 'b1', path: 'content', name: 'answer' }],
          requiredInputIds: [],
          traceChildRuns: false,
        })
      }

      it('publishes the child run handle when the publisher opted in', async () => {
        const output = (await handler.execute(customBlockContext(), customBlock(), {})) as Record<
          string,
          unknown
        >

        expect(typeof output._childExecutionId).toBe('string')
        expect(output._childExecutionId).not.toBe('parent-execution-id')
        expect(output._childTraceDisabled).toBeUndefined()
      })

      it('withholds the handle outright when the publisher has not', async () => {
        // Withheld rather than persisted behind a flag: with no handle there is
        // nothing for a reader to join, so the decision cannot be undone downstream.
        closeTracePolicy()

        const output = (await handler.execute(customBlockContext(), customBlock(), {})) as Record<
          string,
          unknown
        >

        expect(output._childExecutionId).toBeUndefined()
        expect(output._childTraceDisabled).toBe(true)
      })

      it('ignores a consumer input trying to assert the policy', async () => {
        // The policy belongs to the publisher and is read from the DB. A caller's
        // workflow must not be able to open its own view of another team's internals
        // by placing a param the executor happens to read.
        closeTracePolicy()

        const output = (await handler.execute(customBlockContext(), customBlock(), {
          traceChildRun: true,
          traceChildRuns: true,
        })) as Record<string, unknown>

        expect(output._childExecutionId).toBeUndefined()
        expect(output._childTraceDisabled).toBe(true)
      })
    })

    it('persists the parent deadline before starting the child session', async () => {
      const timeoutController = createTimeoutAbortController(60_000)

      try {
        await handler.execute(
          customBlockContext({ abortSignal: timeoutController.signal }),
          customBlock(),
          {}
        )

        expect(mockSetExecutionDeadlineAt).toHaveBeenCalledWith(
          getExecutionDeadlineAt(timeoutController.signal)
        )
        expect(mockSetExecutionDeadlineAt.mock.invocationCallOrder[0]).toBeLessThan(
          mockSafeStart.mock.invocationCallOrder[0]
        )
      } finally {
        timeoutController.cleanup()
      }
    })

    it('does not execute when admission is denied', async () => {
      mockAdmitCustomBlockChildExecution.mockRejectedValue(new Error('no headroom'))

      await expect(handler.execute(customBlockContext(), customBlock(), {})).rejects.toThrow()

      expect(mockExecutorExecute).not.toHaveBeenCalled()
      expect(loggingSessionArgs).toHaveLength(0)
    })

    it('fails before execution when the source child log row cannot be opened', async () => {
      mockSafeStart.mockResolvedValue(false)

      await expect(handler.execute(customBlockContext(), customBlock(), {})).rejects.toThrow()

      expect(mockExecutorExecute).not.toHaveBeenCalled()
      expect(executorOptions).toHaveLength(0)
    })

    it('replaces the consumer delegation origin with the source child execution', async () => {
      const ctx = customBlockContext({
        executorDelegationOrigin: {
          subjectUserId: 'consumer-1',
          workflowId: 'consumer-workflow',
          executionId: 'parent-execution-id',
        },
      })

      await handler.execute(ctx, customBlock(), {})

      expect(executorOptions[0].contextExtensions.executorDelegationOrigin).toEqual({
        workflowId: 'source-workflow-id',
        executionId: executorOptions[0].contextExtensions.executionId,
        currentWorkflow: {
          workflowId: 'source-workflow-id',
          mode: 'deployment',
          deploymentVersionId: 'deployment-version-1',
        },
        principal: {
          kind: 'system',
          serviceId: 'internal',
          workspaceId: 'workspace-source',
          workflowId: 'source-workflow-id',
        },
      })
    })

    it('imports only publisher secret provenance that crosses the curated output boundary', async () => {
      encryptionMockFns.mockDecryptSecret.mockResolvedValueOnce({
        decrypted: 'publisher-secret',
      })
      mockGetPersonalAndWorkspaceEnv.mockResolvedValueOnce({
        personalDecrypted: { SECRET: 'publisher-secret', UNUSED: 'unused-secret' },
        workspaceDecrypted: {},
        personalEncrypted: {
          SECRET: 'publisher-ciphertext',
          UNUSED: 'unused-ciphertext',
        },
        workspaceEncrypted: {},
        decryptionFailures: [],
      })
      let childRegistry: ResolvedSecretTraceRegistry | undefined
      mockExecutorExecute.mockImplementationOnce(async () => {
        childRegistry = executorOptions.at(-1)?.contextExtensions
          .resolvedSecretTraceRegistry as ResolvedSecretTraceRegistry
        expect(childRegistry.recordResolved('SECRET', 'publisher-secret')).toBe(true)
        return {
          success: true,
          output: {},
          logs: [
            {
              blockId: 'b1',
              success: true,
              output: { content: 'value=publisher-secret' },
            },
          ],
        }
      })
      const parentRegistry = new ResolvedSecretTraceRegistry()
      const result = await handler.execute(
        customBlockContext({ resolvedSecretTraceRegistry: parentRegistry }),
        customBlock(),
        {}
      )

      expect(result).toMatchObject({ answer: 'value=publisher-secret', success: true })
      expect(parentRegistry.getActiveMatches()).toEqual([
        {
          plaintext: 'publisher-secret',
          replacement: ANONYMOUS_SECRET_TRACE_REPLACEMENT,
        },
      ])
      expect(childRegistry?.getActiveMatches()).toEqual([
        { plaintext: 'publisher-secret', replacement: '{{SECRET}}' },
      ])
      expect(mockSetResolvedSecretTraceRegistry).toHaveBeenCalledTimes(1)
    })

    it('never forwards the consumer SSE callbacks into the source run', async () => {
      const ctx = customBlockContext({
        onBlockStart: vi.fn(),
        onBlockComplete: vi.fn(),
        onStream: vi.fn(),
        onChildWorkflowInstanceReady: vi.fn(),
      })

      await handler.execute(ctx, customBlock(), {})

      const extensions = executorOptions[0].contextExtensions
      expect(extensions.onStream).toBeUndefined()
      expect(extensions.onChildWorkflowInstanceReady).toBeUndefined()
      expect(extensions.childWorkflowContext).toBeUndefined()
      expect(ctx.onChildWorkflowInstanceReady).not.toHaveBeenCalled()
      // Block markers exist, but they belong to the CHILD's session.
      expect(extensions.onBlockStart).toBeTypeOf('function')
      expect(extensions.onBlockStart).not.toBe(ctx.onBlockStart)
      expect(extensions.onBlockComplete).not.toBe(ctx.onBlockComplete)
    })

    it('records a cancelled child through the cancellation path', async () => {
      // Production shape: the engine reports cancellation as `success: false`
      // plus `status: 'cancelled'` on the ExecutionResult (never on metadata).
      const executionState = {
        blockStates: { 'function-1': { output: { result: 'raw-secret-value' } } },
      }
      mockExecutorExecute.mockResolvedValue({
        success: false,
        output: {},
        status: 'cancelled',
        executionState,
      })

      await handler.execute(customBlockContext(), customBlock(), {}).catch(() => {})

      expect(mockSafeCompleteWithCancellation).toHaveBeenCalledTimes(1)
      expect(mockSafeCompleteWithCancellation).toHaveBeenCalledWith(
        expect.objectContaining({ executionState })
      )
      expect(mockSafeComplete).not.toHaveBeenCalled()
      // Already finalized as cancelled — must not be re-completed as an error.
      expect(mockSafeCompleteWithError).not.toHaveBeenCalled()
    })

    it('records the real failure on the child log and hides it from the consumer', async () => {
      mockExecutorExecute.mockRejectedValue(new Error('Function 1: secret internals blew up'))

      await expect(handler.execute(customBlockContext(), customBlock(), {})).rejects.toMatchObject({
        message: expect.stringContaining('Custom block execution failed'),
      })

      expect(mockSafeCompleteWithError).toHaveBeenCalledTimes(1)
      expect(mockSafeCompleteWithError.mock.calls[0][0].error.message).toBe(
        'Function 1: secret internals blew up'
      )
      expect(mockDispose).toHaveBeenCalledTimes(1)
    })

    it('gives the consumer an opaque ref and error class, never the source detail', async () => {
      mockExecutorExecute.mockRejectedValue(new Error('Function 1: secret internals blew up'))

      const error = await handler
        .execute(customBlockContext(), customBlock(), {})
        .catch((e: any) => e)

      expect(error.consumerFacing.errorType).toBe('execution_failed')
      expect(error.consumerFacing.ref).toBeDefined()
      expect(error.message).toContain(error.consumerFacing.ref)
      expect(error.message).not.toContain('secret internals')
      expect(error.childWorkflowName).toBe('Published Block')
      expect(error.childTraceSpans).toEqual([])
      expect(error.executionResult).toBeUndefined()
      // The chain is severed at the trust boundary.
      expect(error.cause).toBeUndefined()
    })

    it('registers the child run BEFORE executing it, and settles it when done', async () => {
      // Ordering is the whole point: a cancelled parent drains while the child is
      // still inside `execute`, so registering after it would find nothing.
      let registeredBeforeExecute = false
      mockExecutorExecute.mockImplementation(async () => {
        registeredBeforeExecute = mockTrackChildRun.mock.calls.length === 1
        return { success: true, output: { data: 'ok' } }
      })

      await handler.execute(customBlockContext(), customBlock(), {})

      expect(registeredBeforeExecute).toBe(true)
      const [invokerId, childRun] = mockTrackChildRun.mock.calls[0]
      expect(invokerId).toBe('parent-execution-id')
      // Settled in `finally`, so the invoking run's drain can complete.
      await expect(childRun).resolves.toBeUndefined()
    })

    it('never leaks the source workflow name when the child returns success: false', async () => {
      mockExecutorExecute.mockResolvedValue({
        success: false,
        output: {},
        error: 'Function 1: internal detail',
      })

      const error = await handler
        .execute(customBlockContext(), customBlock(), {})
        .catch((e: any) => e)

      expect(error.message).not.toContain('Source Workflow')
      expect(error.message).not.toContain('internal detail')
      expect(error.consumerFacing.errorType).toBe('execution_failed')
      expect(error.childWorkflowName).toBe('Published Block')
    })

    it('fails loudly on a legacy row with no curated outputs', async () => {
      // Curation is required at publish; a pre-rule row must not silently fall
      // back to exposing the child's raw terminal state.
      mockGetCustomBlockAuthority.mockResolvedValue({
        workflowId: 'source-workflow-id',
        organizationId: 'org-1',
        ownerUserId: 'owner-9',
        exposedOutputs: [],
        requiredInputIds: [],
      })

      const error = await handler
        .execute(customBlockContext(), customBlock(), {})
        .catch((e: any) => e)

      expect(error.consumerFacing.errorType).toBe('unavailable')
      expect(error.message).toContain('re-publish')
      expect(mockExecutorExecute).not.toHaveBeenCalled()
    })

    it('scopes a selected regular child output through its child workflow', async () => {
      const onStream = vi.fn()
      const onBlockComplete = vi.fn()
      const ctx = {
        ...mockContext,
        workspaceId: 'workspace-1',
        stream: true,
        selectedOutputs: ['child-workflow-id.agent-1_content'],
        onStream,
        onBlockComplete,
      } as unknown as ExecutionContext
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              name: 'Child Workflow',
              workspaceId: 'workspace-1',
              state: {
                blocks: [
                  {
                    id: 'agent-1',
                    type: 'agent',
                    name: 'Agent',
                    metadata: { id: 'agent', name: 'Agent' },
                    position: { x: 0, y: 0 },
                    config: { tool: 'agent', params: {} },
                    inputs: {},
                    outputs: {},
                    subBlocks: {},
                    enabled: true,
                  },
                ],
                edges: [],
                loops: {},
                parallels: {},
              },
            },
          }),
      })

      await handler.execute(ctx, mockBlock, { workflowId: 'child-workflow-id' })

      const extensions = executorOptions[0].contextExtensions
      expect(extensions.stream).toBe(true)
      expect(extensions.selectedOutputs).toEqual(['agent-1_content'])

      const childStream = {
        blockId: 'agent-1',
        stream: new ReadableStream(),
        execution: { success: true, output: {} },
      }
      await extensions.onStream(childStream)
      expect(onStream).toHaveBeenCalledWith({
        ...childStream,
        blockId: 'child-workflow-id.agent-1',
        childWorkflowInstanceId: expect.any(String),
      })

      const completion = {
        output: { content: 'done' },
        executionTime: 1,
        startedAt: '2026-01-01T00:00:00.000Z',
        executionOrder: 1,
        endedAt: '2026-01-01T00:00:00.001Z',
      }
      await extensions.onBlockComplete('agent-1', 'Agent', 'agent', completion)
      expect(onBlockComplete).toHaveBeenCalledWith(
        'agent-1',
        'Agent',
        'agent',
        {
          ...completion,
          outputBlockId: 'child-workflow-id.agent-1',
          childWorkflowInstanceId: expect.any(String),
        },
        undefined,
        undefined
      )
    })
  })

  describe('projectCustomBlockOutput', () => {
    const childResult = {
      success: true,
      output: { data: 'whole result' },
      logs: [{ blockId: 'b1', success: true, output: { data: { x: 42 }, price: 999 } }],
    }

    it('maps each curated output to its named field plus system fields', () => {
      const result = (handler as any).projectCustomBlockOutput(childResult, [
        { blockId: 'b1', path: 'data.x', name: 'answer' },
      ])

      expect(result).toEqual({ answer: 42, success: true })
    })

    it('never reports cost on the consumer block — the child bills its own run', () => {
      const result = (handler as any).projectCustomBlockOutput(childResult, [
        { blockId: 'b1', path: 'data.x', name: 'answer' },
      ])

      expect(result.cost).toBeUndefined()
    })
  })
})

describe('remapCustomBlockInputKeys', () => {
  const childBlocks = {
    start: {
      type: 'start_trigger',
      subBlocks: {
        inputFormat: {
          value: [
            { id: 'f1', name: 'firstName', type: 'string' },
            { id: 'f2', name: 'payload', type: 'object' },
          ],
        },
      },
    },
  }

  it('maps field ids to current names and drops keys with no matching field', () => {
    const out = remapCustomBlockInputKeys(
      { f1: 'Theodore', removed: 'stale' },
      childBlocks as Record<string, unknown>
    )
    expect(out).toEqual({ firstName: 'Theodore' })
    expect('removed' in out).toBe(false)
  })

  it('decodes an object/array input from its JSON-string value (no double-encoding)', () => {
    const out = remapCustomBlockInputKeys(
      { f1: 'Theodore', f2: '"hello"' },
      childBlocks as Record<string, unknown>
    )
    expect(out).toEqual({ firstName: 'Theodore', payload: 'hello' })
  })
})

describe('findMissingRequiredCustomBlockInputs', () => {
  const childBlocks = {
    start: {
      type: 'start_trigger',
      subBlocks: {
        inputFormat: {
          value: [
            { id: 'f1', name: 'firstName', type: 'string' },
            { id: 'f2', name: 'payload', type: 'object' },
            { name: 'legacyField', type: 'string' },
          ],
        },
      },
    },
  } as Record<string, unknown>

  it('flags a required field left empty and reports its display name', () => {
    expect(findMissingRequiredCustomBlockInputs(['f1'], childBlocks, {})).toEqual(['firstName'])
    expect(findMissingRequiredCustomBlockInputs(['f1'], childBlocks, { firstName: '' })).toEqual([
      'firstName',
    ])
    expect(findMissingRequiredCustomBlockInputs(['f1'], childBlocks, { firstName: null })).toEqual([
      'firstName',
    ])
  })

  it('ignores a stale required override whose field was removed from the Start', () => {
    expect(findMissingRequiredCustomBlockInputs(['removed-field'], childBlocks, {})).toEqual([])
  })
})
