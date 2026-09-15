/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearLargeValueCacheForTests } from '@/lib/execution/payloads/cache'
import { isLargeArrayManifest } from '@/lib/execution/payloads/large-array-manifest-metadata'
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

  it('includes unmatched assignments in block output without mutating workflow variables', async () => {
    const handler = new VariablesBlockHandler()
    const ctx = createContext()
    const value = [{ key: 'SIM-1', summary: 'Transient issue' }]

    const output = await handler.execute(ctx, createBlock(), {
      variables: [
        {
          variableName: 'transientIssues',
          type: 'array',
          value,
        },
      ],
    })

    expect(ctx.workflowVariables).not.toHaveProperty('transientIssues')
    expect(output).toEqual({ transientIssues: value })
  })

  it('keeps special unmatched assignment names as own output fields', async () => {
    const handler = new VariablesBlockHandler()
    const ctx = createContext()
    const value = { polluted: true }

    const output = await handler.execute(ctx, createBlock(), {
      variables: [
        {
          variableName: '__proto__',
          type: 'object',
          value,
        },
      ],
    })

    expect(Object.hasOwn(output, '__proto__')).toBe(true)
    expect(output.__proto__).toEqual(value)
    expect(Object.getPrototypeOf(output)).toBe(Object.prototype)
  })

  it('does not treat inherited prototype keys as existing workflow variable IDs', async () => {
    const handler = new VariablesBlockHandler()
    const ctx = createContext()
    const value = { safe: true }
    const originalPrototype = Object.getPrototypeOf(ctx.workflowVariables)

    const output = await handler.execute(ctx, createBlock(), {
      variables: [
        {
          variableId: '__proto__',
          variableName: 'prototypeAssignment',
          type: 'object',
          value,
        },
      ],
    })

    expect(Object.getPrototypeOf(ctx.workflowVariables)).toBe(originalPrototype)
    expect(ctx.workflowVariables).not.toHaveProperty('__proto__')
    expect(output).toEqual({ prototypeAssignment: value })
  })

  it('stores oversized array assignments as durable manifests in variables and block output', async () => {
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
    expect(isLargeArrayManifest(storedValue)).toBe(true)
    expect(output.issues).toBe(storedValue)
    expect(storedValue).toMatchObject({
      __simLargeArrayManifest: true,
      kind: 'array',
      totalCount: value.length,
    })
    expect(storedValue.chunkCount).toBeGreaterThan(1)
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

  it('preserves whole large refs before scalar type coercion', async () => {
    const handler = new VariablesBlockHandler()
    const ref = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_ABCDEFGHIJKL',
      kind: 'object',
      size: 12 * 1024 * 1024,
      executionId: 'execution-1',
    }
    const ctx = createContext({
      workflowVariables: {
        stringVar: { id: 'stringVar', name: 'stringRef', type: 'string', value: '' },
        plainVar: { id: 'plainVar', name: 'plainRef', type: 'plain', value: '' },
        numberVar: { id: 'numberVar', name: 'numberRef', type: 'number', value: 0 },
        booleanVar: { id: 'booleanVar', name: 'booleanRef', type: 'boolean', value: false },
      },
    })

    await handler.execute(ctx, createBlock(), {
      variables: [
        {
          variableId: 'stringVar',
          variableName: 'stringRef',
          type: 'string',
          value: JSON.stringify(ref),
        },
        {
          variableId: 'plainVar',
          variableName: 'plainRef',
          type: 'plain',
          value: JSON.stringify(ref),
        },
        {
          variableId: 'numberVar',
          variableName: 'numberRef',
          type: 'number',
          value: JSON.stringify(ref),
        },
        {
          variableId: 'booleanVar',
          variableName: 'booleanRef',
          type: 'boolean',
          value: JSON.stringify(ref),
        },
      ],
    })

    expect(ctx.workflowVariables?.stringVar.value).toEqual(ref)
    expect(ctx.workflowVariables?.plainVar.value).toEqual(ref)
    expect(ctx.workflowVariables?.numberVar.value).toEqual(ref)
    expect(ctx.workflowVariables?.booleanVar.value).toEqual(ref)
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
