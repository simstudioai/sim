import '../../__test-utils__/mock-dependencies'

import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { BlockType } from '@/executor/consts'
import { EvaluatorBlockHandler } from '@/executor/handlers/evaluator/evaluator-handler'
import type { ExecutionContext } from '@/executor/types'
import { getProviderFromModel } from '@/providers/utils'
import type { SerializedBlock } from '@/serializer/types'

const mockGetProviderFromModel = getProviderFromModel as Mock
const mockFetch = global.fetch as unknown as Mock

describe('EvaluatorBlockHandler', () => {
  let handler: EvaluatorBlockHandler
  let mockBlock: SerializedBlock
  let mockContext: ExecutionContext

  beforeEach(() => {
    handler = new EvaluatorBlockHandler()

    mockBlock = {
      id: 'eval-block-1',
      metadata: { id: BlockType.EVALUATOR, name: 'Test Evaluator' },
      position: { x: 20, y: 20 },
      config: { tool: BlockType.EVALUATOR, params: {} },
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
      metadata: { duration: 0 },
      environmentVariables: {},
      decisions: { router: new Map(), condition: new Map() },
      loopIterations: new Map(),
      loopItems: new Map(),
      completedLoops: new Set(),
      executedBlocks: new Set(),
      activeExecutionPath: new Set(),
    }

    // Reset mocks using vi
    vi.clearAllMocks()

    // Default mock implementations
    mockGetProviderFromModel.mockReturnValue('openai')

    // Set up fetch mock to return a successful response
    mockFetch.mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            content: JSON.stringify({ score1: 5, score2: 8 }),
            model: 'mock-model',
            tokens: { prompt: 50, completion: 10, total: 60 },
            cost: 0.002,
            timing: { total: 200 },
          }),
      })
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

    const result = await handler.execute(mockBlock, inputs, mockContext)

    expect(mockGetProviderFromModel).toHaveBeenCalledWith('gpt-4o')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: 'POST',
        headers: expect.any(Object),
        body: expect.any(String),
      })
    )

    // Verify the request body contains the expected data
    const fetchCallArgs = mockFetch.mock.calls[0]
    const requestBody = JSON.parse(fetchCallArgs[1].body)
    expect(requestBody).toMatchObject({
      provider: 'openai',
      model: 'gpt-4o',
      systemPrompt: expect.stringContaining(inputs.content),
      responseFormat: expect.objectContaining({
        schema: {
          type: 'object',
          properties: {
            score1: { type: 'number' },
            score2: { type: 'number' },
          },
          required: ['score1', 'score2'],
          additionalProperties: false,
        },
      }),
      temperature: 0.1,
    })

    expect(result).toEqual({
      content: 'This is the content to evaluate.',
      model: 'mock-model',
      tokens: { prompt: 50, completion: 10, total: 60 },
      cost: {
        input: 0,
        output: 0,
        total: 0,
      },
      score1: 5,
      score2: 8,
    })
  })

  it('should process JSON string content correctly', async () => {
    const contentObj = { text: 'Evaluate this JSON.', value: 42 }
    const inputs = {
      content: JSON.stringify(contentObj),
      metrics: [{ name: 'clarity', description: 'Clarity score', range: { min: 1, max: 5 } }],
    }

    mockFetch.mockImplementationOnce(() => {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            content: JSON.stringify({ clarity: 4 }),
            model: 'm',
            tokens: {},
            cost: 0,
            timing: {},
          }),
      })
    })

    await handler.execute(mockBlock, inputs, mockContext)

    const fetchCallArgs = mockFetch.mock.calls[0]
    const requestBody = JSON.parse(fetchCallArgs[1].body)
    expect(requestBody).toMatchObject({
      systemPrompt: expect.stringContaining(JSON.stringify(contentObj, null, 2)),
    })
  })

  it('should process object content correctly', async () => {
    const contentObj = { data: [1, 2, 3], status: 'ok' }
    const inputs = {
      content: contentObj,
      metrics: [
        { name: 'completeness', description: 'Data completeness', range: { min: 0, max: 1 } },
      ],
    }

    mockFetch.mockImplementationOnce(() => {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            content: JSON.stringify({ completeness: 1 }),
            model: 'm',
            tokens: {},
            cost: 0,
            timing: {},
          }),
      })
    })

    await handler.execute(mockBlock, inputs, mockContext)

    const fetchCallArgs = mockFetch.mock.calls[0]
    const requestBody = JSON.parse(fetchCallArgs[1].body)
    expect(requestBody).toMatchObject({
      systemPrompt: expect.stringContaining(JSON.stringify(contentObj, null, 2)),
    })
  })

  it('should parse valid JSON response correctly', async () => {
    const inputs = {
      content: 'Test content',
      metrics: [{ name: 'quality', description: 'Quality score', range: { min: 1, max: 10 } }],
    }

    mockFetch.mockImplementationOnce(() => {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            content: '```json\n{ "quality": 9 }\n```',
            model: 'm',
            tokens: {},
            cost: 0,
            timing: {},
          }),
      })
    })

    const result = await handler.execute(mockBlock, inputs, mockContext)

    expect((result as any).quality).toBe(9)
  })

  it('should handle invalid/non-JSON response gracefully (scores = 0)', async () => {
    const inputs = {
      content: 'Test content',
      metrics: [{ name: 'score', description: 'Score', range: { min: 0, max: 5 } }],
    }

    mockFetch.mockImplementationOnce(() => {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            content: 'Sorry, I cannot provide a score.',
            model: 'm',
            tokens: {},
            cost: 0,
            timing: {},
          }),
      })
    })

    const result = await handler.execute(mockBlock, inputs, mockContext)

    expect((result as any).score).toBe(0)
  })

  it('should handle partially valid JSON response (extracts what it can)', async () => {
    const inputs = {
      content: 'Test content',
      metrics: [
        { name: 'accuracy', description: 'Acc', range: { min: 0, max: 1 } },
        { name: 'fluency', description: 'Flu', range: { min: 0, max: 1 } },
      ],
    }

    mockFetch.mockImplementationOnce(() => {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            content: '{ "accuracy": 1, "fluency": invalid }',
            model: 'm',
            tokens: {},
            cost: 0,
            timing: {},
          }),
      })
    })

    const result = await handler.execute(mockBlock, inputs, mockContext)
    expect((result as any).accuracy).toBe(0)
    expect((result as any).fluency).toBe(0)
  })

  it('should extract metric scores ignoring case', async () => {
    const inputs = {
      content: 'Test',
      metrics: [{ name: 'CamelCaseScore', description: 'Desc', range: { min: 0, max: 10 } }],
    }

    mockFetch.mockImplementationOnce(() => {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            content: JSON.stringify({ camelcasescore: 7 }),
            model: 'm',
            tokens: {},
            cost: 0,
            timing: {},
          }),
      })
    })

    const result = await handler.execute(mockBlock, inputs, mockContext)

    expect((result as any).camelcasescore).toBe(7)
  })

  it('should handle missing metrics in response (score = 0)', async () => {
    const inputs = {
      content: 'Test',
      metrics: [
        { name: 'presentScore', description: 'Desc1', range: { min: 0, max: 5 } },
        { name: 'missingScore', description: 'Desc2', range: { min: 0, max: 5 } },
      ],
    }

    mockFetch.mockImplementationOnce(() => {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            content: JSON.stringify({ presentScore: 4 }),
            model: 'm',
            tokens: {},
            cost: 0,
            timing: {},
          }),
      })
    })

    const result = await handler.execute(mockBlock, inputs, mockContext)

    expect((result as any).presentscore).toBe(4)
    expect((result as any).missingscore).toBe(0)
  })

  it('should handle server error responses', async () => {
    const inputs = { content: 'Test error handling.' }

    // Override fetch mock to return an error
    mockFetch.mockImplementationOnce(() => {
      return Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Server error' }),
      })
    })

    await expect(handler.execute(mockBlock, inputs, mockContext)).rejects.toThrow('Server error')
  })
})
