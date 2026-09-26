import type { GenerateContentParameters, GenerateContentResponse } from '@google/genai'
import { providersMock } from '@sim/testing/mocks/providers.mock'
import {
  providersConversationHistoryMock,
  providersConversationHistoryMockFns,
} from '@sim/testing/mocks/providers-conversation-history.mock'
import { toolsMock, toolsMockFns } from '@sim/testing/mocks/tools.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StreamingExecution } from '@/executor/types'
import { executeGeminiRequest } from '@/providers/gemini/core'
import type { ProviderRequest, ProviderResponse } from '@/providers/types'
import { calculateCost } from '@/providers/utils'

providersMock.MAX_TOOL_ITERATIONS = 5
const mockCapture = providersConversationHistoryMockFns.mockCaptureProviderConversationStep
const mockRecordError = providersConversationHistoryMockFns.mockRecordProviderConversationToolError

const mockExecuteTool = toolsMockFns.mockExecuteTool

vi.mock('@/providers/conversation-history', () => providersConversationHistoryMock)

vi.mock('@/tools', () => toolsMock)
vi.mock('@/providers', () => providersMock)

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

describe('Gemini block cost with implicit prompt caching', () => {
  /** input 0.30/M, cachedInput 0.03/M, output 2.50/M. */
  const MODEL = 'gemini-2.5-flash'

  function textTurn(usageMetadata: Record<string, number>) {
    return {
      candidates: [
        {
          content: { role: 'model', parts: [{ text: 'answer' }] },
          finishReason: 'STOP',
        },
      ],
      usageMetadata,
    }
  }

  function toolTurn(usageMetadata: Record<string, number>) {
    return {
      candidates: [
        {
          content: { role: 'model', parts: [{ functionCall: { name: 'lookup', args: {} } }] },
          finishReason: 'STOP',
        },
      ],
      functionCalls: [{ name: 'lookup', args: {} }],
      usageMetadata,
    }
  }

  async function run(generateContent: ReturnType<typeof vi.fn>, withTools = false) {
    return (await executeGeminiRequest({
      ai: { models: { generateContent, generateContentStream: vi.fn() } } as never,
      model: MODEL,
      providerType: 'google',
      request: {
        model: MODEL,
        apiKey: 'test-key',
        messages: [{ role: 'user', content: 'Look this up' }],
        ...(withTools
          ? {
              tools: [
                {
                  id: 'lookup',
                  name: 'lookup',
                  description: 'Lookup',
                  parameters: { type: 'object', properties: {}, required: [] },
                },
              ],
            }
          : {}),
      },
    })) as ProviderResponse
  }

  beforeEach(() => {
    mockExecuteTool.mockResolvedValue({ success: true, output: { value: 'tool result' } })
  })

  it('bills cached prompt tokens at the discounted rate, not the full input rate', async () => {
    const generateContent = vi.fn().mockResolvedValue(
      textTurn({
        promptTokenCount: 100_000,
        cachedContentTokenCount: 80_000,
        candidatesTokenCount: 1_000,
        totalTokenCount: 101_000,
      })
    )

    const response = await run(generateContent)

    expect(response.tokens).toEqual({
      input: 20_000,
      output: 1_000,
      cacheRead: 80_000,
      total: 101_000,
    })
    expect(response.cost?.input).toBeCloseTo(0.0084, 10)
    expect(response.cost?.output).toBeCloseTo(0.0025, 10)
    expect(response.cost?.total).toBeCloseTo(0.0109, 10)

    const cacheBlind = calculateCost(MODEL, 100_000, 1_000)
    expect(cacheBlind.total).toBeCloseTo(0.0325, 10)
    expect(response.cost?.total).toBeLessThan(cacheBlind.total)
  })

  it('accumulates the cached and uncached buckets separately across tool-loop turns', async () => {
    const generateContent = vi
      .fn()
      .mockResolvedValueOnce(
        toolTurn({
          promptTokenCount: 10_000,
          cachedContentTokenCount: 6_000,
          candidatesTokenCount: 100,
          totalTokenCount: 10_100,
        })
      )
      .mockResolvedValueOnce(
        textTurn({
          promptTokenCount: 12_000,
          cachedContentTokenCount: 9_000,
          candidatesTokenCount: 200,
          totalTokenCount: 12_200,
        })
      )

    const response = await run(generateContent, true)

    expect(generateContent).toHaveBeenCalledTimes(2)
    expect(response.tokens).toEqual({
      input: 7_000,
      output: 300,
      cacheRead: 15_000,
      total: 22_300,
    })
    expect(response.cost?.input).toBeCloseTo(0.00255, 10)
    expect(response.cost?.output).toBeCloseTo(0.00075, 10)
    expect(response.cost?.total).toBeCloseTo(0.0033, 10)
  })

  it('matches plain calculateCost when the response reports no cache hit', async () => {
    const generateContent = vi.fn().mockResolvedValue(
      textTurn({
        promptTokenCount: 100_000,
        candidatesTokenCount: 1_000,
        totalTokenCount: 101_000,
      })
    )

    const response = await run(generateContent)

    expect(response.tokens).toEqual({
      input: 100_000,
      output: 1_000,
      cacheRead: 0,
      total: 101_000,
    })
    expect(response.cost).toEqual(calculateCost(MODEL, 100_000, 1_000))
  })
})
