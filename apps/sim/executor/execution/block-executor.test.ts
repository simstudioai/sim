/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearLargeValueCacheForTests } from '@/lib/execution/payloads/cache'
import { isLargeArrayManifest } from '@/lib/execution/payloads/large-array-manifest-metadata'
import { BlockType } from '@/executor/constants'
import type { DAGNode } from '@/executor/dag/builder'
import { BlockExecutor } from '@/executor/execution/block-executor'
import { ExecutionState } from '@/executor/execution/state'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import { VariableResolver } from '@/executor/variables/resolver'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

const { mockUploadFile } = vi.hoisted(() => ({
  mockUploadFile: vi.fn(),
}))

vi.mock('@/ee/access-control/utils/permission-check', () => ({
  validateBlockType: vi.fn(),
}))

vi.mock('@/lib/uploads', () => ({
  StorageService: {
    uploadFile: mockUploadFile,
  },
}))

function createBlock(): SerializedBlock {
  return {
    id: 'function-block-1',
    metadata: { id: BlockType.FUNCTION, name: 'Function' },
    position: { x: 0, y: 0 },
    config: { tool: BlockType.FUNCTION, params: {} },
    inputs: {},
    outputs: {},
    enabled: true,
  }
}

function createContext(state: ExecutionState): ExecutionContext {
  return {
    workflowId: 'workflow-1',
    workspaceId: 'workspace-1',
    executionId: 'execution-1',
    userId: 'user-1',
    blockStates: state.getBlockStates(),
    blockLogs: [],
    metadata: { requestId: 'request-1', duration: 0 },
    environmentVariables: {},
    workflowVariables: {},
    decisions: { router: new Map(), condition: new Map() },
    loopExecutions: new Map(),
    executedBlocks: new Set(),
    activeExecutionPath: new Set(),
    completedLoops: new Set(),
  } as ExecutionContext
}

function createNode(block: SerializedBlock): DAGNode {
  return {
    id: block.id,
    block,
    incomingEdges: new Set(),
    outgoingEdges: new Map(),
    metadata: {},
  }
}

describe('BlockExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearLargeValueCacheForTests()
    mockUploadFile.mockImplementation(async ({ customKey }) => ({ key: customKey }))
  })

  it('persists function output arrays as manifests in execution state', async () => {
    const block = createBlock()
    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [block],
      connections: [],
      loops: {},
      parallels: {},
    }
    const state = new ExecutionState()
    const resolver = new VariableResolver(workflow, {}, state)
    const output = {
      result: Array.from({ length: 120_000 }, (_, index) => ({
        key: `SIM-${index}`,
        payload: 'x'.repeat(100),
      })),
    }
    const handler: BlockHandler = {
      canHandle: () => true,
      execute: async () => output,
    }
    const executor = new BlockExecutor(
      [handler],
      resolver,
      {
        workspaceId: 'workspace-1',
        executionId: 'execution-1',
        userId: 'user-1',
        metadata: {
          requestId: 'request-1',
          executionId: 'execution-1',
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          userId: 'user-1',
          triggerType: 'manual',
          useDraftState: false,
          startTime: new Date().toISOString(),
        },
      },
      state
    )

    await executor.execute(createContext(state), createNode(block), block)

    const storedOutput = state.getBlockOutput(block.id)
    expect(isLargeArrayManifest(storedOutput?.result)).toBe(true)
    expect(storedOutput?.result).toMatchObject({
      __simLargeArrayManifest: true,
      kind: 'array',
      totalCount: output.result.length,
    })
  })
})
