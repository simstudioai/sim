import type { GenerateContentParameters, GenerateContentResponse } from '@google/genai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StreamingExecution } from '@/executor/types'
import { executeGeminiRequest } from '@/providers/gemini/core'
import type { ProviderRequest, ProviderResponse } from '@/providers/types'

const { mockExecuteTool, mockCapture, mockRecordError } = vi.hoisted(() => ({
  mockExecuteTool: vi.fn(),
  mockCapture: vi.fn(),
  mockRecordError: vi.fn(),
}))

vi.mock('@/providers/conversation-history', () => ({
  getConversationRequestContext: () => undefined,
  captureProviderConversationStep: mockCapture,
  recordProviderConversationToolError: mockRecordError,
}))

vi.mock('@/tools', () => ({ executeTool: mockExecuteTool }))
vi.mock('@/providers', () => ({ MAX_TOOL_ITERATIONS: 5 }))

function textTurn(): GenerateContentResponse {
  return {
    candidates: [{ content: { role: 'model', parts: [{ text: 'answer' }] }, finishReason: 'STOP' }],
    usageMetadata: {
      promptTokenCount: 1000,
      cachedContentTokenCount: 200,
      candidatesTokenCount: 100,
      totalTokenCount: 1100,
    },
  } as GenerateContentResponse
}

async function run(
  model: string,
  generateContent: ReturnType<typeof vi.fn>,
  overrides: Partial<ProviderRequest> = {}
) {
  return (await executeGeminiRequest({
    ai: { models: { generateContent, generateContentStream: vi.fn() } } as never,
    model: model.replace(/^vertex\//i, ''),
    providerType: 'vertex',
    request: {
      model,
      apiKey: 'test-key',
      messages: [{ role: 'user', content: 'Look this up' }],
      temperature: 0.5,
      thinkingLevel: 'medium',
      ...overrides,
    },
  })) as ProviderResponse
}

describe('Vertex Gemini request compatibility', () => {
  beforeEach(() => {
    mockExecuteTool.mockResolvedValue({ success: true, output: { value: 'tool result' } })
  })

  it('captures two same-name calls without IDs before parallel execution and preserves every part', async () => {
    const calls = [
      { name: 'lookup', args: { key: 'a' } },
      { name: 'lookup', args: { key: 'b' } },
    ]
    const content = {
      role: 'model',
      parts: [
        { text: 'Looking up both', thoughtSignature: 'text-signature' },
        ...calls.map((functionCall, index) => ({
          functionCall,
          thoughtSignature: `signature-${index}`,
        })),
      ],
    }
    const generateContent = vi
      .fn()
      .mockResolvedValueOnce({
        functionCalls: calls,
        candidates: [{ content, finishReason: 'STOP' }],
      })
      .mockResolvedValueOnce(textTurn())
    mockExecuteTool.mockImplementation(async (_tool, params) => {
      expect(mockCapture).toHaveBeenCalledWith(expect.anything(), 'gemini', content, {
        input: 0,
        output: 0,
        cacheRead: 0,
      })
      return { success: true, output: { value: params.key } }
    })

    await run('vertex/gemini-3.8-flash', generateContent, {
      tools: [
        {
          id: 'lookup',
          name: 'Lookup',
          description: 'Look up a record',
          parameters: { type: 'object', properties: { key: { type: 'string' } } },
        },
      ],
    })

    expect(mockExecuteTool).toHaveBeenCalledTimes(2)
    expect(mockCapture).toHaveBeenCalledTimes(2)
    const secondRequest = generateContent.mock.calls[1][0] as GenerateContentParameters
    expect(secondRequest.contents).toContainEqual(content)
    expect(secondRequest.contents).toContainEqual({
      role: 'user',
      parts: [
        { functionResponse: { name: 'lookup', response: { value: 'a' } } },
        { functionResponse: { name: 'lookup', response: { value: 'b' } } },
      ],
    })
  })

  it.each([
    'vertex/gemini-3.8-flash',
    'vertex/gemini-3.7-flash',
    'vertex/gemini-3.6-flash',
    'vertex/gemini-3.5-flash-lite',
  ])('uses thinking levels and omits ignored temperature for %s', async (model) => {
    const generateContent = vi.fn().mockResolvedValue(textTurn())
    await run(model, generateContent)

    const params = generateContent.mock.calls[0][0] as GenerateContentParameters
    expect(params.model).toBe(model.replace('vertex/', ''))
    expect(params.config).not.toHaveProperty('temperature')
    expect(params.config?.thinkingConfig).toEqual({
      thinkingLevel: 'MEDIUM',
      includeThoughts: false,
    })
  })

  it.each(['vertex/gemini-2.5-flash', 'vertex/Custom-Gemini-Model'])(
    'preserves temperature for supported or uncataloged %s',
    async (model) => {
      const generateContent = vi.fn().mockResolvedValue(textTurn())
      await run(model, generateContent)

      expect(generateContent.mock.calls[0][0].config.temperature).toBe(0.5)
    }
  )

  it('prices Vertex-only catalog entries using the namespaced model ID', async () => {
    const generateContent = vi.fn().mockResolvedValue(textTurn())
    const result = await run('vertex/gemini-3.8-flash', generateContent)

    expect(result.cost?.input).toBeCloseTo((800 * 0.75 + 200 * 0.075) / 1e6, 10)
    expect(result.cost?.output).toBeCloseTo((100 * 3.75) / 1e6, 10)
  })

  it.each([false, true])(
    'retains Vertex pricing when streaming with tools enabled: %s',
    async (withTools) => {
      const generateContentStream = vi.fn().mockImplementation(async function* () {
        yield textTurn()
      })
      const result = (await executeGeminiRequest({
        ai: { models: { generateContentStream } } as never,
        model: 'gemini-3.8-flash',
        providerType: 'vertex',
        request: {
          model: 'vertex/gemini-3.8-flash',
          messages: [{ role: 'user', content: 'Hello' }],
          stream: true,
          ...(withTools
            ? {
                tools: [
                  {
                    id: 'lookup',
                    name: 'lookup',
                    description: 'Look up a query',
                    parameters: { type: 'object', properties: {}, required: [] },
                  },
                ],
              }
            : {}),
        },
      })) as StreamingExecution
      const reader = result.stream.getReader()
      while (!(await reader.read()).done) {}
      reader.releaseLock()

      expect(result.execution.output.cost?.input).toBeCloseTo((800 * 0.75 + 200 * 0.075) / 1e6, 10)
      expect(result.execution.output.cost?.output).toBeCloseTo((100 * 3.75) / 1e6, 10)
    }
  )

  it('echoes IDs and thought signatures for parallel same-name function calls', async () => {
    const functionCalls = [
      { id: 'call-first', name: 'lookup', args: { query: 'first' } },
      { id: 'call-second', name: 'lookup', args: { query: 'second' } },
    ]
    const parts = functionCalls.map((functionCall, index) => ({
      functionCall,
      thoughtSignature: `signature-${index}`,
    }))
    const generateContent = vi
      .fn()
      .mockResolvedValueOnce({
        candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }],
        functionCalls,
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 },
      })
      .mockResolvedValueOnce(textTurn())

    await run('vertex/gemini-3.8-flash', generateContent, {
      tools: [
        {
          id: 'lookup',
          name: 'lookup',
          description: 'Look up a query',
          parameters: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        },
      ],
    })

    expect(generateContent).toHaveBeenCalledTimes(2)
    const followUp = generateContent.mock.calls[1][0] as GenerateContentParameters
    expect(followUp.contents).toEqual([
      expect.objectContaining({ role: 'user' }),
      { role: 'model', parts },
      {
        role: 'user',
        parts: functionCalls.map(({ id, name }) => ({
          functionResponse: { id, name, response: { value: 'tool result' } },
        })),
      },
    ])
  })
})
