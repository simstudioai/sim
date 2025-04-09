import '../../__test-utils__/mock-dependencies'
import { beforeEach, describe, expect, it, Mock, vi } from 'vitest'
import { BlockOutput } from '@/blocks/types'
import { Tool } from '@/executor/types'
import { SerializedBlock } from '@/serializer/types'
import { executeTool, getTool } from '@/tools'
import { ExecutionContext } from '../../types'
import { GenericBlockHandler } from './generic-handler'

const mockGetTool = getTool as Mock
const mockExecuteTool = executeTool as Mock

describe('GenericBlockHandler', () => {
  let handler: GenericBlockHandler
  let mockBlock: SerializedBlock
  let mockContext: ExecutionContext
  let mockTool: Tool

  beforeEach(() => {
    handler = new GenericBlockHandler()

    mockBlock = {
      id: 'generic-block-1',
      metadata: { id: 'custom-type', name: 'Test Generic Block' },
      position: { x: 40, y: 40 },
      config: { tool: 'some_custom_tool', params: { param1: 'value1' } },
      inputs: { param1: 'string' }, // Using ParamType strings
      outputs: {},
      enabled: true,
    }

    mockContext = {
      workflowId: 'test-workflow-id',
      blockStates: new Map(),
      blockLogs: [],
      metadata: {},
      environmentVariables: {},
      decisions: { router: new Map(), condition: new Map() },
      loopIterations: new Map(),
      loopItems: new Map(),
      executedBlocks: new Set(),
      activeExecutionPath: new Set(),
    }

    mockTool = {
      id: 'some_custom_tool',
      name: 'Some Custom Tool',
      description: 'Does something custom',
      version: '1.0',
      params: { param1: { type: 'string' } },
    }

    // Reset mocks using vi
    vi.clearAllMocks()

    // Default mock implementations
    mockGetTool.mockReturnValue(mockTool)
    mockExecuteTool.mockResolvedValue({ success: true, output: { customResult: 'OK' } })
  })

  it('should always handle any block type', () => {
    const agentBlock: SerializedBlock = { ...mockBlock, metadata: { id: 'agent' } }
    expect(handler.canHandle(agentBlock)).toBe(true)
    expect(handler.canHandle(mockBlock)).toBe(true)
    const noMetaIdBlock: SerializedBlock = { ...mockBlock, metadata: undefined }
    expect(handler.canHandle(noMetaIdBlock)).toBe(true)
  })

  it('should execute generic block by calling its associated tool', async () => {
    const inputs = { param1: 'resolvedValue1' }
    const expectedToolParams = {
      ...inputs,
      _context: { workflowId: mockContext.workflowId },
    }
    const expectedOutput: BlockOutput = { response: { customResult: 'OK' } }

    const result = await handler.execute(mockBlock, inputs, mockContext)

    expect(mockGetTool).toHaveBeenCalledWith('some_custom_tool')
    expect(mockExecuteTool).toHaveBeenCalledWith('some_custom_tool', expectedToolParams)
    expect(result).toEqual(expectedOutput)
  })

  it('should throw error if the associated tool is not found', async () => {
    mockGetTool.mockReturnValue(undefined)
    const inputs = { param1: 'value' }

    await expect(handler.execute(mockBlock, inputs, mockContext)).rejects.toThrow(
      'Tool not found: some_custom_tool'
    )
    expect(mockExecuteTool).not.toHaveBeenCalled()
  })

  it('should handle tool execution errors correctly', async () => {
    const inputs = { param1: 'value' }
    const errorResult = {
      success: false,
      error: 'Custom tool failed',
      output: { detail: 'error detail' },
    }
    mockExecuteTool.mockResolvedValue(errorResult)

    await expect(handler.execute(mockBlock, inputs, mockContext)).rejects.toThrow(
      'Custom tool failed'
    )

    // Re-execute to check error properties after catching
    try {
      await handler.execute(mockBlock, inputs, mockContext)
    } catch (e: any) {
      expect(e.toolId).toBe('some_custom_tool')
      expect(e.blockName).toBe('Test Generic Block')
      expect(e.output).toEqual({ detail: 'error detail' })
    }

    expect(mockExecuteTool).toHaveBeenCalledTimes(2) // Called twice now
  })

  it('should handle tool execution errors with no specific message', async () => {
    const inputs = { param1: 'value' }
    const errorResult = { success: false, output: {} }
    mockExecuteTool.mockResolvedValue(errorResult)

    await expect(handler.execute(mockBlock, inputs, mockContext)).rejects.toThrow(
      'Block execution of Some Custom Tool failed with no error message'
    )
  })
})
