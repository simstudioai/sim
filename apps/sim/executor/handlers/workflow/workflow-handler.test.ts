import { environmentUtilsMockFns, resetEnvironmentUtilsMock } from '@sim/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { getBlock } from '@/blocks/registry'
import { BlockType } from '@/executor/constants'
import { BoundarySafeError } from '@/executor/errors/boundary'
import {
  findMissingRequiredCustomBlockInputs,
  remapCustomBlockInputKeys,
  WorkflowBlockHandler,
} from '@/executor/handlers/workflow/workflow-handler'
import type { ExecutionContext } from '@/executor/types'
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
  mockDispose,
  executorOptions,
  loggingSessionArgs,
} = vi.hoisted(() => ({
  mockExecutorExecute: vi.fn(),
  mockCreateSnapshot: vi.fn(),
  mockResolveBillingAttribution: vi.fn(),
  mockGetCustomBlockAuthority: vi.fn(),
  mockGetUserEmailById: vi.fn(),
  mockAdmitCustomBlockChildExecution: vi.fn(),
  mockTrackChildRun: vi.fn(),
  mockBuildTraceSpans: vi.fn(),
  mockSafeStart: vi.fn(),
  mockSafeComplete: vi.fn(),
  mockSafeCompleteWithError: vi.fn(),
  mockSafeCompleteWithCancellation: vi.fn(),
  mockDispose: vi.fn(),
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
    onBlockStart = vi.fn()
    onBlockComplete = vi.fn()
  },
}))

vi.mock('@/lib/logs/execution/trace-spans/trace-spans', () => ({
  buildTraceSpans: mockBuildTraceSpans,
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

vi.mock('@/lib/users/queries', () => ({
  getUserEmailById: mockGetUserEmailById,
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

vi.mock('@/executor/utils/http', () => ({
  buildAuthHeaders: vi.fn().mockResolvedValue({ 'Content-Type': 'application/json' }),
  buildAPIUrl: vi.fn((path: string) => new URL(path, 'http://localhost:3000')),
  extractAPIErrorMessage: vi.fn(async (response: Response) => {
    const defaultMessage = `API request failed with status ${response.status}`
    try {
      const errorData = await response.json()
      return errorData.error || defaultMessage
    } catch {
      return defaultMessage
    }
  }),
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
      blockStates: new Map(),
      blockLogs: [],
      metadata: { duration: 0 },
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
  })

  describe('canHandle', () => {
    it('should handle workflow blocks', () => {
      expect(handler.canHandle(mockBlock)).toBe(true)
    })

    it('should not handle non-workflow blocks', () => {
      const nonWorkflowBlock = { ...mockBlock, metadata: { id: BlockType.FUNCTION } }
      expect(handler.canHandle(nonWorkflowBlock)).toBe(false)
    })
  })

  describe('execute', () => {
    it('should throw error when no workflowId is provided', async () => {
      const inputs = {}

      await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
        'No workflow selected for execution'
      )
    })

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

    it('should handle child workflow not found', async () => {
      const inputs = { workflowId: 'non-existent-workflow' }

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: () => Promise.resolve(''),
      })

      await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
        '"non-existent-workflow" failed: Child workflow non-existent-workflow not found'
      )
    })

    it('should handle fetch errors gracefully', async () => {
      const inputs = { workflowId: 'child-workflow-id' }

      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
        '"child-workflow-id" failed: Network error'
      )
    })
  })

  describe('workspace containment', () => {
    const inputs = { workflowId: 'child-workflow-id' }

    it('should fail a cross-workspace child in the draft loader path', async () => {
      const ctx = { ...mockContext, workspaceId: 'workspace-parent' }

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
    })

    it('should fail a cross-workspace child in the deployed loader path', async () => {
      const ctx = {
        ...mockContext,
        workspaceId: 'workspace-parent',
        isDeployedContext: true,
      }

      mockFetch.mockImplementation(async (url: unknown) => {
        if (String(url).includes('/deployed')) {
          return {
            ok: true,
            json: () =>
              Promise.resolve({
                data: {
                  deployedState: { blocks: {}, edges: [], loops: {}, parallels: {} },
                },
              }),
          }
        }
        return {
          ok: true,
          json: () =>
            Promise.resolve({
              data: {
                name: 'Foreign Workflow',
                workspaceId: 'workspace-other',
                variables: {},
              },
            }),
        }
      })

      await expect(handler.execute(ctx, mockBlock, inputs)).rejects.toThrow(
        'Child workflow child-workflow-id belongs to a different workspace and cannot be executed'
      )
      expect(mockCreateSnapshot).not.toHaveBeenCalled()
      expect(mockExecutorExecute).not.toHaveBeenCalled()
    })

    it('should execute a same-workspace child as before', async () => {
      const ctx = { ...mockContext, workspaceId: 'workspace-parent' }

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

      const result = await handler.execute(ctx, mockBlock, inputs)

      expect(result).toMatchObject({
        success: true,
        childWorkflowId: 'child-workflow-id',
        childWorkflowName: 'Child Workflow',
        childWorkflowSnapshotId: 'snapshot-1',
        result: { data: 'ok' },
      })
      expect(mockExecutorExecute).toHaveBeenCalledWith('child-workflow-id')
    })

    it('threads the parent billing attribution into the child execution context', async () => {
      const billingAttribution = {
        actorUserId: 'actor-1',
        workspaceId: 'workspace-parent',
        organizationId: 'org-1',
        billedAccountUserId: 'owner-1',
        billingEntity: { type: 'organization', id: 'org-1' },
        billingPeriod: { start: '2026-07-01T00:00:00.000Z', end: '2026-08-01T00:00:00.000Z' },
        payerSubscription: null,
      }
      const ctx = {
        ...mockContext,
        workspaceId: 'workspace-parent',
        metadata: { ...mockContext.metadata, billingAttribution },
      } as ExecutionContext

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
      expect(executorOptions[0].contextExtensions.billingAttribution).toBe(billingAttribution)
      expect(mockResolveBillingAttribution).not.toHaveBeenCalled()
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
                  deployedState: { blocks: {}, edges: [], loops: {}, parallels: {} },
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

      expect(mockResolveBillingAttribution).toHaveBeenCalledWith({
        actorUserId: 'owner-9',
        workspaceId: 'workspace-source',
      })
      expect(executorOptions).toHaveLength(1)
      expect(executorOptions[0].contextExtensions.billingAttribution).toBe(sourceAttribution)
      expect(executorOptions[0].contextExtensions.userId).toBe('owner-9')
      expect(executorOptions[0].contextExtensions.workspaceId).toBe('workspace-source')
    })

    it('builds trusted caller metadata for custom block children with the toggle on', async () => {
      const customBlock = {
        ...mockBlock,
        metadata: { id: 'custom_block_abc', name: 'Published Block' },
      }
      const ctx = {
        ...mockContext,
        userId: 'consumer-1',
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
        userEmail: 'a@corp.com',
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

    it('propagates the parent run metadata wholesale to nested children', async () => {
      const customBlock = {
        ...mockBlock,
        metadata: { id: 'custom_block_abc', name: 'Published Block' },
      }
      const inheritedMetadata = {
        userEmail: 'original@corp.com',
        workspaceId: 'workspace-original',
        workflowId: 'workflow-original',
        executionId: 'exec-1',
        executionType: 'api',
        executionMode: 'async' as const,
        startTime: '2026-07-15T00:00:00.000Z',
      }
      const ctx = {
        ...mockContext,
        userId: 'publisher-1',
        workspaceId: 'workspace-intermediate',
        executionId: 'exec-1',
        startRunMetadata: inheritedMetadata,
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
      expect(executorOptions[0].contextExtensions.startRunMetadata).toMatchObject({
        userEmail: 'original@corp.com',
        workspaceId: 'workspace-original',
        workflowId: 'workflow-original',
        executionMode: 'async',
      })
      expect(mockGetUserEmailById).not.toHaveBeenCalled()
    })

    it('preserves a fail-soft null inherited email instead of re-resolving it', async () => {
      const ctx = {
        ...mockContext,
        userId: 'publisher-1',
        workspaceId: 'workspace-parent',
        startRunMetadata: {
          userEmail: null,
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
      expect(executorOptions[0].contextExtensions.startRunMetadata.userEmail).toBeNull()
      expect(mockGetUserEmailById).not.toHaveBeenCalled()
    })

    it('recovers inherited metadata from the seeded start-block state after resume', async () => {
      const seededMetadata = {
        userEmail: 'original@corp.com',
        workspaceId: 'workspace-original',
        workflowId: 'workflow-original',
        executionMode: 'sync',
      }
      const parentStartBlock = {
        id: 'parent-start',
        position: { x: 0, y: 0 },
        config: { tool: 'start_trigger', params: { runMetadata: true } },
        inputs: {},
        outputs: {},
        metadata: { id: 'start_trigger', name: 'Start', category: 'triggers' },
        enabled: true,
      }
      const ctx = {
        ...mockContext,
        userId: 'user-1',
        workspaceId: 'workspace-parent',
        workflow: { ...mockContext.workflow, blocks: [parentStartBlock] },
        blockStates: new Map([
          [
            'parent-start',
            { output: { metadata: seededMetadata }, executed: true, executionTime: 0 },
          ],
        ]),
      } as unknown as ExecutionContext

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
      expect(executorOptions[0].contextExtensions.startRunMetadata).toMatchObject({
        userEmail: 'original@corp.com',
        workspaceId: 'workspace-original',
        workflowId: 'workflow-original',
      })
      expect(mockGetUserEmailById).not.toHaveBeenCalled()
    })

    it('passes inherited metadata through a toggle-off child so deeper children keep it', async () => {
      const inheritedMetadata = {
        userEmail: 'original@corp.com',
        workspaceId: 'workspace-original',
        workflowId: 'workflow-original',
      }
      const ctx = {
        ...mockContext,
        userId: 'publisher-1',
        workspaceId: 'workspace-parent',
        startRunMetadata: inheritedMetadata,
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
                    subBlocks: {},
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
      expect(executorOptions[0].contextExtensions.startRunMetadata).toBe(inheritedMetadata)
    })

    it('passes no run metadata when the child start block toggle is off', async () => {
      const ctx = {
        ...mockContext,
        userId: 'consumer-1',
        workspaceId: 'workspace-parent',
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
                    subBlocks: {},
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
      expect(executorOptions[0].contextExtensions.startRunMetadata).toBeUndefined()
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

  describe('loadChildWorkflow', () => {
    it('should return null for 404 responses', async () => {
      const workflowId = 'non-existent-workflow'

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: () => Promise.resolve(''),
      })

      const result = await (handler as any).loadChildWorkflow(workflowId)

      expect(result).toBeNull()
    })

    it('should handle invalid workflow state', async () => {
      const workflowId = 'invalid-workflow'

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              name: 'Invalid Workflow',
              state: null, // Invalid state
            },
          }),
      })

      await expect((handler as any).loadChildWorkflow(workflowId)).rejects.toThrow(
        'Child workflow invalid-workflow has invalid state'
      )
    })
  })

  describe('mapChildOutputToParent', () => {
    it('should map successful child output correctly', () => {
      const childResult = {
        success: true,
        output: { data: 'test result' },
      }

      const result = (handler as any).mapChildOutputToParent(
        childResult,
        'child-id',
        'Child Workflow',
        100
      )

      expect(result).toEqual({
        success: true,
        childWorkflowId: 'child-id',
        childWorkflowName: 'Child Workflow',
        result: { data: 'test result' },
        childTraceSpans: [],
      })
    })

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

    it('should handle nested response structures', () => {
      const childResult = {
        output: { nested: 'data' },
      }

      const result = (handler as any).mapChildOutputToParent(
        childResult,
        'child-id',
        'Child Workflow',
        100
      )

      expect(result).toEqual({
        success: true,
        childWorkflowId: 'child-id',
        childWorkflowName: 'Child Workflow',
        result: { nested: 'data' },
        childTraceSpans: [],
      })
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
                data: { deployedState: { blocks: {}, edges: [], loops: {}, parallels: {} } },
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

    it('opens a session on the source workflow with a fresh id and no base charge', async () => {
      await handler.execute(customBlockContext(), customBlock(), {})

      expect(loggingSessionArgs).toHaveLength(1)
      const [workflowId, executionId, trigger, requestId, reservationId, options] =
        loggingSessionArgs[0]
      expect(workflowId).toBe('source-workflow-id')
      expect(executionId).not.toBe('parent-execution-id')
      expect(reservationId).toBe(executionId)
      expect(trigger).toBe('custom_block')
      expect(requestId).toBe('req-1')
      expect(options).toEqual({ baseExecutionCharge: 0 })
    })

    it('starts the session against the source workspace and payer', async () => {
      await handler.execute(customBlockContext(), customBlock(), {})

      expect(mockSafeStart).toHaveBeenCalledTimes(1)
      const params = mockSafeStart.mock.calls[0][0]
      expect(params.workspaceId).toBe('workspace-source')
      expect(params.actorUserId).toBe('owner-9')
      expect(params.billingAttribution).toEqual({
        actorUserId: 'owner-9',
        workspaceId: 'workspace-source',
      })
      expect(params.variables).toEqual({ SECRET: 'enc' })
      expect(params.triggerData.correlation).toEqual({
        source: 'custom_block',
        executionId: 'parent-execution-id',
      })
    })

    it('admits against the source payer before executing', async () => {
      await handler.execute(customBlockContext(), customBlock(), {})

      expect(mockAdmitCustomBlockChildExecution).toHaveBeenCalledWith({
        actorUserId: 'owner-9',
        workspaceId: 'workspace-source',
      })
    })

    it('does not execute when admission is denied', async () => {
      mockAdmitCustomBlockChildExecution.mockRejectedValue(new Error('no headroom'))

      await expect(handler.execute(customBlockContext(), customBlock(), {})).rejects.toThrow()

      expect(mockExecutorExecute).not.toHaveBeenCalled()
      expect(loggingSessionArgs).toHaveLength(0)
    })

    it('runs the child under its own execution id but keeps the parent readable', async () => {
      const ctx = customBlockContext()
      await handler.execute(ctx, customBlock(), {})

      const extensions = executorOptions[0].contextExtensions
      expect(extensions.executionId).not.toBe('parent-execution-id')
      expect(extensions.largeValueExecutionIds).toContain('parent-execution-id')
      expect(ctx.largeValueExecutionIds).toContain(extensions.executionId)
    })

    it('shares one large-value id list so nested custom blocks propagate upward', async () => {
      const ctx = customBlockContext()
      await handler.execute(ctx, customBlock(), {})

      const childIds = executorOptions[0].contextExtensions.largeValueExecutionIds
      // Same array instance, not a copy — that is what lets a nested custom
      // block's grandchild id reach the top-level invoker.
      expect(childIds).toBe(ctx.largeValueExecutionIds)

      // Simulate a nested custom block appending its own child id deeper down.
      childIds.push('grandchild-execution-id')
      expect(ctx.largeValueExecutionIds).toContain('grandchild-execution-id')
    })

    it('does not duplicate ids across repeated invocations', async () => {
      const ctx = customBlockContext()
      await handler.execute(ctx, customBlock(), {})
      await handler.execute(ctx, customBlock(), {})

      const ids = ctx.largeValueExecutionIds as string[]
      expect(new Set(ids).size).toBe(ids.length)
      expect(ids.filter((id) => id === 'parent-execution-id')).toHaveLength(1)
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

    it('completes the child session and disposes the cancellation bridge', async () => {
      await handler.execute(customBlockContext(), customBlock(), {})

      expect(mockSafeComplete).toHaveBeenCalledTimes(1)
      expect(mockSafeCompleteWithError).not.toHaveBeenCalled()
      expect(mockDispose).toHaveBeenCalledTimes(1)
    })

    it('records a cancelled child through the cancellation path', async () => {
      // Production shape: the engine reports cancellation as `success: false`
      // plus `status: 'cancelled'` on the ExecutionResult (never on metadata).
      mockExecutorExecute.mockResolvedValue({
        success: false,
        output: {},
        status: 'cancelled',
      })

      await handler.execute(customBlockContext(), customBlock(), {}).catch(() => {})

      expect(mockSafeCompleteWithCancellation).toHaveBeenCalledTimes(1)
      expect(mockSafeComplete).not.toHaveBeenCalled()
      // Already finalized as cancelled — must not be re-completed as an error.
      expect(mockSafeCompleteWithError).not.toHaveBeenCalled()
    })

    it('tells the consumer a cancellation was a cancellation, not a generic failure', async () => {
      mockExecutorExecute.mockResolvedValue({
        success: false,
        output: {},
        status: 'cancelled',
      })

      const error = await handler
        .execute(customBlockContext(), customBlock(), {})
        .catch((e: any) => e)

      expect(error.consumerFacing.errorType).toBe('cancelled')
      expect(error.message).toBe('Custom block execution was cancelled')
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

    it('settles the registered child run on the failure path too', async () => {
      mockExecutorExecute.mockRejectedValue(new Error('boom'))

      await handler.execute(customBlockContext(), customBlock(), {}).catch(() => {})

      expect(mockTrackChildRun).toHaveBeenCalledTimes(1)
      expect(mockTrackChildRun.mock.calls[0][0]).toBe('parent-execution-id')
      await expect(mockTrackChildRun.mock.calls[0][1]).resolves.toBeUndefined()
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

    it('classifies an unavailable block so consumers can branch on it', async () => {
      mockGetCustomBlockAuthority.mockResolvedValue(null)

      const error = await handler
        .execute(customBlockContext(), customBlock(), {})
        .catch((e: any) => e)

      expect(error.consumerFacing.errorType).toBe('unavailable')
      expect(error.message).toBe('This custom block is no longer available')
    })

    it('classifies an admission denial as a usage limit, not a generic failure', async () => {
      // `CustomBlockAdmissionError` is a `BoundarySafeError` of this type; the
      // class itself is covered in child-execution.test.ts.
      mockAdmitCustomBlockChildExecution.mockRejectedValue(
        new BoundarySafeError({
          errorType: 'usage_limit',
          message: 'Organization usage limit exceeded',
        })
      )

      const error = await handler
        .execute(customBlockContext(), customBlock(), {})
        .catch((e: any) => e)

      expect(error.consumerFacing.errorType).toBe('usage_limit')
      expect(error.message).toBe('Organization usage limit exceeded')
    })

    it('keeps the depth-limit classification instead of collapsing to generic', async () => {
      const ctx = customBlockContext({ callChain: Array.from({ length: 30 }, (_, i) => `wf-${i}`) })

      const error = await handler.execute(ctx, customBlock(), {}).catch((e: any) => e)

      expect(error.consumerFacing.errorType).toBe('depth_limit')
      expect(error.childWorkflowName).toBe('Published Block')
    })

    it('surfaces a missing-required-input failure verbatim', async () => {
      mockGetCustomBlockAuthority.mockResolvedValue({
        workflowId: 'source-workflow-id',
        organizationId: 'org-1',
        ownerUserId: 'owner-9',
        exposedOutputs: [{ blockId: 'b1', path: 'content', name: 'answer' }],
        requiredInputIds: ['field-1'],
      })
      mockFetch.mockImplementation(async (url: unknown) => {
        if (String(url).includes('/deployed')) {
          return {
            ok: true,
            json: () =>
              Promise.resolve({
                data: {
                  deployedState: {
                    blocks: {
                      starter: {
                        type: 'start_trigger',
                        subBlocks: {
                          inputFormat: {
                            value: [{ id: 'field-1', name: 'Username', type: 'string' }],
                          },
                        },
                      },
                    },
                    edges: [],
                    loops: {},
                    parallels: {},
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

      const error = await handler
        .execute(customBlockContext(), customBlock(), { inputMapping: '{}' })
        .catch((e: any) => e)

      expect(error.message).toContain('missing required fields')
      expect(error.message).toContain('Username')
      expect(error.consumerFacing.errorType).toBe('missing_inputs')
      expect(mockExecutorExecute).not.toHaveBeenCalled()
    })

    it('leaves regular workflow blocks entirely alone', async () => {
      const ctx = {
        ...mockContext,
        workspaceId: 'workspace-1',
        executionId: 'parent-execution-id',
        onBlockStart: vi.fn(),
        onStream: vi.fn(),
      } as unknown as ExecutionContext
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              name: 'Child Workflow',
              workspaceId: 'workspace-1',
              state: { blocks: [], edges: [], loops: {}, parallels: {} },
            },
          }),
      })

      await handler.execute(ctx, mockBlock, { workflowId: 'child-workflow-id' })

      expect(loggingSessionArgs).toHaveLength(0)
      const extensions = executorOptions[0].contextExtensions
      expect(extensions.executionId).toBe('parent-execution-id')
      expect(extensions.onStream).toBe(ctx.onStream)
      expect(extensions.childWorkflowContext).toBeDefined()
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

    it('never dumps the child result when no outputs are curated', () => {
      // Curation is required at publish and guarded at invocation, so this path
      // is unreachable in production — but it must not fall back to exposing the
      // terminal block's raw state (agent toolCalls/thinking, nested workflow
      // ids) if it is ever reached.
      const result = (handler as any).projectCustomBlockOutput(childResult, [])

      expect(result).toEqual({ success: true })
      expect((result as any).result).toBeUndefined()
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

  it('parses a real object value and leaves invalid JSON as a raw string', () => {
    expect(
      remapCustomBlockInputKeys({ f2: '{"a":1}' }, childBlocks as Record<string, unknown>)
    ).toEqual({ payload: { a: 1 } })
    expect(
      remapCustomBlockInputKeys({ f2: 'not json' }, childBlocks as Record<string, unknown>)
    ).toEqual({ payload: 'not json' })
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

  it('passes when the required field has a value', () => {
    expect(
      findMissingRequiredCustomBlockInputs(['f1'], childBlocks, { firstName: 'Theodore' })
    ).toEqual([])
    expect(findMissingRequiredCustomBlockInputs(['f1'], childBlocks, { firstName: 0 })).toEqual([])
    expect(findMissingRequiredCustomBlockInputs(['f1'], childBlocks, { firstName: false })).toEqual(
      []
    )
  })

  it('ignores a stale required override whose field was removed from the Start', () => {
    expect(findMissingRequiredCustomBlockInputs(['removed-field'], childBlocks, {})).toEqual([])
  })

  it('treats fields without an override as optional', () => {
    expect(findMissingRequiredCustomBlockInputs(['f1'], childBlocks, { firstName: 'x' })).toEqual(
      []
    )
    expect(findMissingRequiredCustomBlockInputs([], childBlocks, {})).toEqual([])
  })

  it('keys legacy fields without a stable id by name', () => {
    expect(findMissingRequiredCustomBlockInputs(['legacyField'], childBlocks, {})).toEqual([
      'legacyField',
    ])
    expect(
      findMissingRequiredCustomBlockInputs(['legacyField'], childBlocks, { legacyField: 'v' })
    ).toEqual([])
  })

  it('reports every missing required field at once', () => {
    expect(findMissingRequiredCustomBlockInputs(['f1', 'f2'], childBlocks, {})).toEqual([
      'firstName',
      'payload',
    ])
  })
})
