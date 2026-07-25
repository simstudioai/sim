/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeGeminiRequest } from '@/providers/gemini/core'
import type { ProviderResponse } from '@/providers/types'
import { calculateCost } from '@/providers/utils'

const { mockExecuteTool } = vi.hoisted(() => ({
  mockExecuteTool: vi.fn(),
}))

vi.mock('@/tools', () => ({
  executeTool: mockExecuteTool,
}))

vi.mock('@/providers', () => ({
  MAX_TOOL_ITERATIONS: 5,
}))

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

describe('Gemini block cost with implicit prompt caching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
