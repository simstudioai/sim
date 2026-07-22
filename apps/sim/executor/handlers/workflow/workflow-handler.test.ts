import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { BlockType } from '@/executor/constants'
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
  mockGetPersonalAndWorkspaceEnv,
  mockGetUserEmailById,
  executorOptions,
} = vi.hoisted(() => ({
  mockExecutorExecute: vi.fn(),
  mockCreateSnapshot: vi.fn(),
  mockResolveBillingAttribution: vi.fn(),
  mockGetCustomBlockAuthority: vi.fn(),
  mockGetPersonalAndWorkspaceEnv: vi.fn(),
  mockGetUserEmailById: vi.fn(),
  executorOptions: [] as Array<Record<string, any>>,
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

vi.mock('@/lib/environment/utils', () => ({
  getPersonalAndWorkspaceEnv: mockGetPersonalAndWorkspaceEnv,
}))

vi.mock('@/lib/workflows/custom-blocks/operations', () => ({
  getCustomBlockAuthority: mockGetCustomBlockAuthority,
}))

vi.mock('@/lib/users/queries', () => ({
  getUserEmailById: mockGetUserEmailById,
}))

// Override the global registry mock so the Serializer can carry the start
// block's runMetadata param through child deployed-state serialization.
vi.mock('@/blocks/registry', () => ({
  getBlock: vi.fn((type: string) => {
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
  }),
  getAllBlocks: vi.fn(() => ({})),
  getLatestBlock: vi.fn(() => undefined),
}))

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
        exposedOutputs: [],
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
        exposedOutputs: [],
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
        exposedOutputs: [],
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

  describe('projectCustomBlockOutput', () => {
    const childResult = {
      success: true,
      output: { data: 'whole result' },
      logs: [{ blockId: 'b1', success: true, output: { data: { x: 42 }, price: 999 } }],
    }

    it('maps each curated output to its named field plus system fields', () => {
      const result = (handler as any).projectCustomBlockOutput(
        childResult,
        [{ blockId: 'b1', path: 'data.x', name: 'answer' }],
        0.5
      )

      expect(result).toEqual({ answer: 42, success: true, cost: { total: 0.5 } })
    })

    it('never lets an exposed output named cost clobber the billed cost', () => {
      const result = (handler as any).projectCustomBlockOutput(
        childResult,
        [{ blockId: 'b1', path: 'price', name: 'cost' }],
        0.5
      )

      expect(result.cost).toEqual({ total: 0.5 })
      expect(result.success).toBe(true)
    })

    it('exposes the whole child result when no outputs are curated', () => {
      const result = (handler as any).projectCustomBlockOutput(childResult, [], 0.5)

      expect(result).toEqual({
        success: true,
        result: { data: 'whole result' },
        cost: { total: 0.5 },
      })
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
