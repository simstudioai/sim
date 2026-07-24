/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StreamingExecution } from '@/executor/types'
import { executeGeminiRequest } from '@/providers/gemini/core'

const { mockExecuteTool } = vi.hoisted(() => ({
  mockExecuteTool: vi.fn(),
}))

vi.mock('@/tools', () => ({
  executeTool: mockExecuteTool,
}))

vi.mock('@/providers', () => ({
  MAX_TOOL_ITERATIONS: 1,
}))

describe('executeGeminiRequest settled stream projection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps the required Gemini 2 schema extraction but does not regenerate for streaming', async () => {
    mockExecuteTool.mockResolvedValue({ success: true, output: { value: 'tool result' } })

    const generateContent = vi
      .fn()
      .mockResolvedValueOnce({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ functionCall: { name: 'lookup', args: {} } }],
            },
            finishReason: 'STOP',
          },
        ],
        functionCalls: [{ name: 'lookup', args: {} }],
        usageMetadata: {
          promptTokenCount: 1,
          candidatesTokenCount: 1,
          totalTokenCount: 2,
        },
      })
      .mockResolvedValueOnce({
        candidates: [
          {
            content: { role: 'model', parts: [{ text: 'unformatted answer' }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 2,
          candidatesTokenCount: 2,
          totalTokenCount: 4,
        },
      })
      .mockResolvedValueOnce({
        candidates: [
          {
            content: { role: 'model', parts: [{ text: '{"value":"formatted"}' }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 3,
          candidatesTokenCount: 3,
          totalTokenCount: 6,
        },
      })
    const generateContentStream = vi.fn()

    const result = (await executeGeminiRequest({
      ai: { models: { generateContent, generateContentStream } } as never,
      model: 'gemini-2.5-flash',
      providerType: 'google',
      request: {
        model: 'gemini-2.5-flash',
        apiKey: 'test-key',
        stream: true,
        messages: [{ role: 'user', content: 'Look this up' }],
        tools: [
          {
            id: 'lookup',
            name: 'lookup',
            description: 'Lookup',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        ],
        responseFormat: {
          name: 'answer',
          schema: {
            type: 'object',
            properties: { value: { type: 'string' } },
            required: ['value'],
          },
        },
      },
    })) as StreamingExecution

    expect(generateContent).toHaveBeenCalledTimes(3)
    expect(generateContentStream).not.toHaveBeenCalled()
    expect(generateContent.mock.calls[2][0].config).toMatchObject({
      tools: undefined,
      toolConfig: undefined,
      responseMimeType: 'application/json',
    })

    const reader = result.stream.getReader()
    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: { type: 'text_delta', text: '{"value":"formatted"}', turn: 'final' },
    })
    expect(result.execution.output.content).toBe('{"value":"formatted"}')
  })

  it('runs one schema synthesis after the tool-batch cap without executing over-cap calls', async () => {
    mockExecuteTool.mockResolvedValue({ success: true, output: { value: 'tool result' } })

    const responseSchema = {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
    }
    const generateContent = vi
      .fn()
      .mockResolvedValueOnce({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ functionCall: { name: 'lookup', args: { batch: 1 } } }],
            },
            finishReason: 'STOP',
          },
        ],
        functionCalls: [{ name: 'lookup', args: { batch: 1 } }],
        usageMetadata: {
          promptTokenCount: 1,
          candidatesTokenCount: 1,
          totalTokenCount: 2,
        },
      })
      .mockResolvedValueOnce({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ functionCall: { name: 'lookup', args: { batch: 2 } } }],
            },
            finishReason: 'STOP',
          },
        ],
        functionCalls: [{ name: 'lookup', args: { batch: 2 } }],
        usageMetadata: {
          promptTokenCount: 2,
          candidatesTokenCount: 2,
          totalTokenCount: 4,
        },
      })
      .mockResolvedValueOnce({
        candidates: [
          {
            content: { role: 'model', parts: [{ text: '{"value":"capped"}' }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 3,
          candidatesTokenCount: 3,
          totalTokenCount: 6,
        },
      })

    const result = (await executeGeminiRequest({
      ai: { models: { generateContent, generateContentStream: vi.fn() } } as never,
      model: 'gemini-2.5-flash',
      providerType: 'google',
      request: {
        model: 'gemini-2.5-flash',
        apiKey: 'test-key',
        stream: true,
        messages: [{ role: 'user', content: 'Keep looking this up' }],
        tools: [
          {
            id: 'lookup',
            name: 'lookup',
            description: 'Lookup',
            parameters: {
              type: 'object',
              properties: { batch: { type: 'number' } },
              required: ['batch'],
            },
          },
        ],
        responseFormat: {
          name: 'answer',
          schema: responseSchema,
        },
      },
    })) as StreamingExecution

    expect(generateContent).toHaveBeenCalledTimes(3)
    expect(mockExecuteTool).toHaveBeenCalledTimes(1)
    expect(mockExecuteTool).toHaveBeenCalledWith(
      'lookup',
      expect.objectContaining({ batch: 1 }),
      expect.any(Object)
    )
    expect(generateContent.mock.calls[2][0].config).toMatchObject({
      tools: undefined,
      toolConfig: undefined,
      responseMimeType: 'application/json',
      responseSchema,
    })

    const reader = result.stream.getReader()
    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: { type: 'text_delta', text: '{"value":"capped"}', turn: 'final' },
    })
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined })
    expect(result.execution.output.content).toBe('{"value":"capped"}')
    expect(result.execution.output.tokens).toEqual({ input: 6, output: 6, total: 12 })
    expect(result.execution.output.providerTiming?.iterations).toBe(3)
    expect(
      result.execution.output.providerTiming?.timeSegments?.filter(
        (segment) => segment.type === 'model'
      )
    ).toHaveLength(3)
  })

  it.each(['google', 'vertex'] as const)(
    'uses the live loop for %s streaming tool requests without a caller flag',
    async (providerType) => {
      mockExecuteTool.mockResolvedValue({ success: true, output: false })

      const toolTurn = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ functionCall: { name: 'lookup', args: {} } }],
            },
            finishReason: 'STOP',
          },
        ],
        functionCalls: [{ name: 'lookup', args: {} }],
        usageMetadata: {
          promptTokenCount: 1,
          candidatesTokenCount: 1,
          totalTokenCount: 2,
        },
      }
      const answerTurn = {
        candidates: [
          {
            content: { role: 'model', parts: [{ text: 'live answer' }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 2,
          candidatesTokenCount: 2,
          totalTokenCount: 4,
        },
      }
      const generateContent = vi.fn()
      const generateContentStream = vi
        .fn()
        .mockResolvedValueOnce(
          (async function* () {
            yield toolTurn
          })()
        )
        .mockResolvedValueOnce(
          (async function* () {
            yield answerTurn
          })()
        )

      const result = (await executeGeminiRequest({
        ai: { models: { generateContent, generateContentStream } } as never,
        model: 'gemini-3-flash-preview',
        providerType,
        request: {
          model: 'gemini-3-flash-preview',
          apiKey: 'test-key',
          stream: true,
          messages: [{ role: 'user', content: 'Look this up' }],
          tools: [
            {
              id: 'lookup',
              name: 'lookup',
              description: 'Lookup',
              params: {},
              parameters: { type: 'object', properties: {}, required: [] },
            },
          ],
        },
      })) as StreamingExecution

      const events: unknown[] = []
      const reader = result.stream.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        events.push(value)
      }

      expect(generateContent).not.toHaveBeenCalled()
      expect(generateContentStream).toHaveBeenCalledTimes(2)
      expect(events).toContainEqual({ type: 'turn_end', turn: 'final' })
      expect(result.execution.output.content).toBe('live answer')
    }
  )
})
