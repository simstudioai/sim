import '../../__test-utils__/mock-dependencies'
import { beforeEach, describe, expect, it, Mock, vi } from 'vitest'
import { BlockOutput } from '@/blocks/types'
import { executeProviderRequest } from '@/providers'
import { getProviderFromModel } from '@/providers/utils'
import { SerializedBlock } from '@/serializer/types'
import { ExecutionContext } from '../../types'
import { EvaluatorBlockHandler } from './evaluator-handler'

const mockGetProviderFromModel = getProviderFromModel as Mock
const mockExecuteProviderRequest = executeProviderRequest as Mock

describe('EvaluatorBlockHandler', () => {
  let handler: EvaluatorBlockHandler
  let mockBlock: SerializedBlock
  let mockContext: ExecutionContext

  beforeEach(() => {
    handler = new EvaluatorBlockHandler()

    mockBlock = {
      id: 'eval-block-1',
      metadata: { id: 'evaluator', name: 'Test Evaluator' },
      position: { x: 20, y: 20 },
      config: { tool: 'evaluator', params: {} },
      inputs: {
        content: 'string',
        metrics: 'json',
        model: 'string',
        temperature: 'number',
      }, // Using ParamType strings
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

    // Reset mocks using vi
    vi.clearAllMocks()

    // Default mock implementations
    mockGetProviderFromModel.mockReturnValue('openai')
    mockExecuteProviderRequest.mockResolvedValue({
      content: JSON.stringify({ score1: 5, score2: 8 }),
      model: 'mock-model',
      tokens: { prompt: 50, completion: 10, total: 60 },
      cost: 0.002,
      timing: { total: 200 },
    })
  })

  it('should handle evaluator blocks', () => {
    expect(handler.canHandle(mockBlock)).toBe(true)
    const nonEvalBlock: SerializedBlock = { ...mockBlock, metadata: { id: 'other' } }
    expect(handler.canHandle(nonEvalBlock)).toBe(false)
  })

  it('should execute evaluator block correctly with basic inputs', async () => {
    const inputs = {
      content: 'This is the content to evaluate.',
      metrics: [
        { name: 'score1', description: 'First score', range: { min: 0, max: 10 } },
        { name: 'score2', description: 'Second score', range: { min: 0, max: 10 } },
      ],
      model: 'gpt-4o',
      temperature: 0.1,
    }

    const expectedProviderRequest = {
      model: 'gpt-4o',
      systemPrompt: expect.stringContaining(inputs.content),
      responseFormat: {
        name: 'evaluation_response',
        schema: {
          type: 'object',
          properties: {
            score1: { type: 'number' },
            score2: { type: 'number' },
          },
          required: ['score1', 'score2'],
          additionalProperties: false,
        },
        strict: true,
      },
      messages: [{ role: 'user', content: expect.stringContaining('Please evaluate the content') }],
      temperature: 0.1,
      apiKey: undefined,
    }

    const expectedOutput: BlockOutput = {
      response: {
        content: 'This is the content to evaluate.',
        model: 'mock-model',
        tokens: { prompt: 50, completion: 10, total: 60 },
        score1: 5,
        score2: 8,
      },
    }

    const result = await handler.execute(mockBlock, inputs, mockContext)

    expect(mockGetProviderFromModel).toHaveBeenCalledWith('gpt-4o')
    expect(mockExecuteProviderRequest).toHaveBeenCalledWith('openai', expectedProviderRequest)
    expect(result).toEqual(expectedOutput)
  })

  it('should process JSON string content correctly', async () => {
    const contentObj = { text: 'Evaluate this JSON.', value: 42 }
    const inputs = {
      content: JSON.stringify(contentObj),
      metrics: [{ name: 'clarity', description: 'Clarity score', range: { min: 1, max: 5 } }],
    }
    mockExecuteProviderRequest.mockResolvedValueOnce({
      content: JSON.stringify({ clarity: 4 }),
      model: 'm',
      tokens: {},
      cost: 0,
      timing: {},
    })

    await handler.execute(mockBlock, inputs, mockContext)

    expect(mockExecuteProviderRequest).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        systemPrompt: expect.stringContaining(JSON.stringify(contentObj, null, 2)),
      })
    )
  })

  it('should process object content correctly', async () => {
    const contentObj = { data: [1, 2, 3], status: 'ok' }
    const inputs = {
      content: contentObj,
      metrics: [
        { name: 'completeness', description: 'Data completeness', range: { min: 0, max: 1 } },
      ],
    }
    mockExecuteProviderRequest.mockResolvedValueOnce({
      content: JSON.stringify({ completeness: 1 }),
      model: 'm',
      tokens: {},
      cost: 0,
      timing: {},
    })

    await handler.execute(mockBlock, inputs, mockContext)

    expect(mockExecuteProviderRequest).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        systemPrompt: expect.stringContaining(JSON.stringify(contentObj, null, 2)),
      })
    )
  })

  it('should parse valid JSON response correctly', async () => {
    const inputs = {
      content: 'Test content',
      metrics: [{ name: 'quality', description: 'Quality score', range: { min: 1, max: 10 } }],
    }
    mockExecuteProviderRequest.mockResolvedValueOnce({
      content: '```json\n{ "quality": 9 }\n```',
      model: 'm',
      tokens: {},
      cost: 0,
      timing: {},
    })

    const result = await handler.execute(mockBlock, inputs, mockContext)

    expect((result as any).response.quality).toBe(9)
  })

  it('should handle invalid/non-JSON response gracefully (scores = 0)', async () => {
    const inputs = {
      content: 'Test content',
      metrics: [{ name: 'score', description: 'Score', range: { min: 0, max: 5 } }],
    }
    mockExecuteProviderRequest.mockResolvedValueOnce({
      content: 'Sorry, I cannot provide a score.',
      model: 'm',
      tokens: {},
      cost: 0,
      timing: {},
    })

    const result = await handler.execute(mockBlock, inputs, mockContext)

    expect((result as any).response.score).toBe(0)
  })

  it('should handle partially valid JSON response (extracts what it can)', async () => {
    const inputs = {
      content: 'Test content',
      metrics: [
        { name: 'accuracy', description: 'Acc', range: { min: 0, max: 1 } },
        { name: 'fluency', description: 'Flu', range: { min: 0, max: 1 } },
      ],
    }
    mockExecuteProviderRequest.mockResolvedValueOnce({
      content: '{ "accuracy": 1, "fluency": invalid }',
      model: 'm',
      tokens: {},
      cost: 0,
      timing: {},
    })

    const result = await handler.execute(mockBlock, inputs, mockContext)
    expect((result as any).response.accuracy).toBe(0)
    expect((result as any).response.fluency).toBe(0)
  })

  it('should extract metric scores ignoring case', async () => {
    const inputs = {
      content: 'Test',
      metrics: [{ name: 'CamelCaseScore', description: 'Desc', range: { min: 0, max: 10 } }],
    }
    mockExecuteProviderRequest.mockResolvedValueOnce({
      content: JSON.stringify({ camelcasescore: 7 }),
      model: 'm',
      tokens: {},
      cost: 0,
      timing: {},
    })

    const result = await handler.execute(mockBlock, inputs, mockContext)

    expect((result as any).response.camelcasescore).toBe(7)
  })

  it('should handle missing metrics in response (score = 0)', async () => {
    const inputs = {
      content: 'Test',
      metrics: [
        { name: 'presentScore', description: 'Desc1', range: { min: 0, max: 5 } },
        { name: 'missingScore', description: 'Desc2', range: { min: 0, max: 5 } },
      ],
    }
    mockExecuteProviderRequest.mockResolvedValueOnce({
      content: JSON.stringify({ presentScore: 4 }),
      model: 'm',
      tokens: {},
      cost: 0,
      timing: {},
    })

    const result = await handler.execute(mockBlock, inputs, mockContext)

    expect((result as any).response.presentscore).toBe(4)
    expect((result as any).response.missingscore).toBe(0)
  })
})
