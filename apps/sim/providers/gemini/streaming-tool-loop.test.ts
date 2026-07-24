/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { createGeminiStreamingToolLoopStream } from '@/providers/gemini/streaming-tool-loop'
import type { AgentStreamEvent } from '@/providers/stream-events'
import { resetLocalToolIdCounterForTests } from '@/providers/tool-call-id'

async function collectEvents(
  stream: ReadableStream<AgentStreamEvent>
): Promise<AgentStreamEvent[]> {
  const events: AgentStreamEvent[] = []
  const reader = stream.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    events.push(value)
  }
  return events
}

vi.mock('@/tools', () => ({
  executeTool: vi.fn(async () => ({
    success: true,
    output: { ok: true, url: 'https://httpbin.org/get' },
  })),
}))

vi.mock('@/providers/utils', () => ({
  prepareToolExecution: vi.fn(() => ({
    toolParams: { url: 'https://httpbin.org/get' },
    executionParams: { url: 'https://httpbin.org/get' },
  })),
  calculateCost: vi.fn(() => ({
    input: 0.01,
    output: 0.02,
    total: 0.03,
    pricing: { input: 1, output: 2, updatedAt: new Date().toISOString() },
  })),
  sumToolCosts: vi.fn(() => 0),
  isGemini3Model: vi.fn(() => false),
  trackForcedToolUsage: () => ({ hasUsedForcedTool: false, usedForcedTools: [] }),
}))

describe('createGeminiStreamingToolLoopStream', () => {
  it('emits thinking, tool lifecycle, then final answer; allocates local tool ids', async () => {
    resetLocalToolIdCounterForTests()

    const turns = [
      // Turn 1: thinking + functionCall (no id)
      (async function* () {
        yield {
          candidates: [
            {
              content: {
                parts: [
                  { text: 'I should call the API. ', thought: true },
                  {
                    functionCall: {
                      name: 'http_request',
                      args: { url: 'https://httpbin.org/get' },
                    },
                  },
                ],
              },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 5,
            totalTokenCount: 15,
          },
        } as any
      })(),
      // Turn 2: final answer
      (async function* () {
        yield {
          candidates: [
            {
              content: {
                parts: [{ text: 'Done: https://httpbin.org/get' }],
              },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 20,
            candidatesTokenCount: 8,
            totalTokenCount: 28,
          },
        } as any
      })(),
    ]

    let turnIdx = 0
    const ai = {
      models: {
        generateContentStream: vi.fn(async () => turns[turnIdx++]),
      },
    }

    const onComplete = vi.fn()
    const timeSegments: any[] = []
    const stream = createGeminiStreamingToolLoopStream({
      ai: ai as any,
      model: 'gemini-2.5-flash',
      baseConfig: {},
      contents: [{ role: 'user', parts: [{ text: 'fetch it' }] }],
      request: {
        model: 'gemini-2.5-flash',
        tools: [
          {
            id: 'http_request',
            name: 'http_request',
            description: 'HTTP',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        ],
      } as any,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
      timeSegments,
      onComplete,
    })

    const events = await collectEvents(stream)

    expect(events.filter((e) => e.type === 'thinking_delta').map((e) => e.text)).toEqual([
      'I should call the API. ',
    ])

    const starts = events.filter((e) => e.type === 'tool_call_start')
    expect(starts).toHaveLength(1)
    expect(starts[0]).toMatchObject({ name: 'http_request' })
    expect((starts[0] as { id: string }).id).toMatch(/^gemini_/)

    const ends = events.filter((e) => e.type === 'tool_call_end')
    expect(ends).toEqual([
      {
        type: 'tool_call_end',
        id: (starts[0] as { id: string }).id,
        name: 'http_request',
        status: 'success',
      },
    ])

    // Text streams live as `pending`; the turn_end sequence classifies turns.
    const textEvents = events.filter((e) => e.type === 'text_delta')
    expect(textEvents.every((e) => e.type === 'text_delta' && e.turn === 'pending')).toBe(true)
    expect(
      textEvents
        .filter((e) => e.type === 'text_delta')
        .map((e) => e.text)
        .join('')
    ).toContain('Done:')
    expect(events.filter((e) => e.type === 'turn_end').map((e) => e.turn)).toEqual([
      'intermediate',
      'final',
    ])

    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Done:'),
        toolCalls: expect.objectContaining({ count: 1 }),
      })
    )
  })
})
