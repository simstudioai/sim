/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearLargeValueCacheForTests } from '@/lib/execution/payloads/cache'
import { isLargeValueRef } from '@/lib/execution/payloads/large-value-ref'
import { BlockType } from '@/executor/constants'
import { VariablesBlockHandler } from '@/executor/handlers/variables/variables-handler'
import type { ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

const { mockUploadFile } = vi.hoisted(() => ({
  mockUploadFile: vi.fn(),
}))

vi.mock('@/lib/uploads', () => ({
  StorageService: {
    uploadFile: mockUploadFile,
  },
}))

function createContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    workflowId: 'workflow-1',
    workspaceId: 'workspace-1',
    executionId: 'execution-1',
    userId: 'user-1',
    blockStates: new Map(),
    blockLogs: [],
    metadata: { duration: 0 },
    environmentVariables: {},
    workflowVariables: {
      'var-1': { id: 'var-1', name: 'issues', type: 'array', value: [] },
    },
    decisions: { router: new Map(), condition: new Map() },
    loopExecutions: new Map(),
    executedBlocks: new Set(),
    activeExecutionPath: new Set(),
    completedLoops: new Set(),
    ...overrides,
  }
}

function createBlock(): SerializedBlock {
  return {
    id: 'variables-block-1',
    metadata: { id: BlockType.VARIABLES, name: 'Variables' },
    position: { x: 0, y: 0 },
    config: { tool: BlockType.VARIABLES, params: {} },
    inputs: {},
    outputs: {},
    enabled: true,
  }
}

describe('VariablesBlockHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearLargeValueCacheForTests()
    mockUploadFile.mockImplementation(async ({ customKey }) => ({ key: customKey }))
  })

  it('preserves small assignments inline', async () => {
    const handler = new VariablesBlockHandler()
    const ctx = createContext()
    const value = [{ key: 'SIM-1', summary: 'Small issue' }]

    const output = await handler.execute(ctx, createBlock(), {
      variables: [
        {
          variableId: 'var-1',
          variableName: 'issues',
          type: 'array',
          value,
        },
      ],
    })

    expect(ctx.workflowVariables?.['var-1'].value).toEqual(value)
    expect(output).toEqual({ issues: value })
    expect(mockUploadFile).not.toHaveBeenCalled()
  })

  it('stores oversized assignments as durable refs in variables and block output', async () => {
    const handler = new VariablesBlockHandler()
    const ctx = createContext()
    const value = Array.from({ length: 120_000 }, (_, index) => ({
      key: `SIM-${index}`,
      summary: 'Issue summary that keeps each item small',
    }))

    const output = await handler.execute(ctx, createBlock(), {
      variables: [
        {
          variableId: 'var-1',
          variableName: 'issues',
          type: 'array',
          value,
        },
      ],
    })

    const storedValue = ctx.workflowVariables?.['var-1'].value
    expect(isLargeValueRef(storedValue)).toBe(true)
    expect(output.issues).toBe(storedValue)
    expect(storedValue).toMatchObject({
      __simLargeValueRef: true,
      kind: 'array',
      executionId: 'execution-1',
    })
    expect(mockUploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        context: 'execution',
        preserveKey: true,
        customKey: expect.stringContaining('/execution-1/large-value-'),
      })
    )
  })

  it('fails clearly when durable context is missing for oversized assignments', async () => {
    const handler = new VariablesBlockHandler()
    const ctx = createContext({ workspaceId: undefined, executionId: undefined })
    const value = Array.from({ length: 120_000 }, (_, index) => ({
      key: `SIM-${index}`,
      summary: 'Issue summary that keeps each item small',
    }))

    await expect(
      handler.execute(ctx, createBlock(), {
        variables: [
          {
            variableId: 'var-1',
            variableName: 'issues',
            type: 'array',
            value,
          },
        ],
      })
    ).rejects.toThrow(
      'Cannot persist large execution value without workspace, workflow, and execution IDs'
    )

    expect(mockUploadFile).not.toHaveBeenCalled()
  })

  it('preserves existing variable metadata when compacting reassignment', async () => {
    const handler = new VariablesBlockHandler()
    const ctx = createContext({
      workflowVariables: {
        'var-1': {
          id: 'var-1',
          name: 'issues',
          type: 'array',
          value: [],
          isExisting: true,
        },
      },
    })
    const value = [{ key: 'SIM-1', summary: 'Updated' }]

    await handler.execute(ctx, createBlock(), {
      variables: [
        {
          variableId: 'var-1',
          variableName: 'issues',
          type: 'array',
          value,
        },
      ],
    })

    expect(ctx.workflowVariables?.['var-1']).toEqual({
      id: 'var-1',
      name: 'issues',
      type: 'array',
      value,
      isExisting: true,
    })
  })
})
