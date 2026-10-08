import { openaiMock, openaiMockFns } from '@sim/testing/mocks/openai.mock'
import { providersMock } from '@sim/testing/mocks/providers.mock'
import { providersAttachmentsMock } from '@sim/testing/mocks/providers-attachments.mock'
import { providersModelsMock } from '@sim/testing/mocks/providers-models.mock'
import { providersTraceEnrichmentMock } from '@sim/testing/mocks/providers-trace-enrichment.mock'
import { providersUtilsMock, providersUtilsMockFns } from '@sim/testing/mocks/providers-utils.mock'
import { toolsMock, toolsMockFns } from '@sim/testing/mocks/tools.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStreamEvent } from '@/providers/stream-events'
import type { ProviderToolConfig } from '@/providers/types'

vi.mock('openai', () => openaiMock)
vi.mock('@/providers', () => providersMock)
vi.mock('@/providers/attachments', () => providersAttachmentsMock)

vi.mock('@/providers/models', () => providersModelsMock)
vi.mock('@/providers/trace-enrichment', () => providersTraceEnrichmentMock)
vi.mock('@/providers/utils', () => providersUtilsMock)
vi.mock('@/tools', () => toolsMock)

import { mistralProvider } from '@/providers/mistral'

const mockCreate = openaiMockFns.mockChatCompletionsCreate

const mockExecuteTool = toolsMockFns.mockExecuteTool
providersUtilsMockFns.mockPrepareToolsWithUsageControl.mockImplementation(
  (tools) =>
    ({
      tools,
      toolChoice: 'auto',
      forcedTools: [],
    }) as ReturnType<typeof providersUtilsMockFns.mockPrepareToolsWithUsageControl>
)

function makeTool(id: string): ProviderToolConfig {
  return {
    id,
    description: '',
    params: {},
    parameters: { type: 'object', properties: {}, required: [] },
  }
}

async function readAgentEvents(stream: ReadableStream<AgentStreamEvent>) {
  const events: AgentStreamEvent[] = []
  const reader = stream.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) return events
    events.push(value)
  }
}

describe('mistralProvider.executeRequest', () => {
  beforeEach(() => {
    mockExecuteTool.mockResolvedValue({ success: true, output: { ok: true } })
  })

  const answerBlocks = [
    { type: 'thinking', thinking: [{ type: 'text', text: 'Reasoning stays out of the answer.' }] },
    { type: 'text', text: '{"ok":' },
    { type: 'text', text: 'true}' },
  ]
  const usage = { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 }
  const toolResponse = {
    choices: [
      {
        message: {
          content: null,
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{}' } },
          ],
        },
      },
    ],
    usage,
  }
  const answerResponse = { choices: [{ message: { content: answerBlocks } }], usage }

  it('returns answer text from Mistral content blocks without including thinking', async () => {
    mockCreate.mockResolvedValueOnce(answerResponse)
    const result = await mistralProvider.executeRequest({
      model: 'mistral-large-4',
      apiKey: 'key',
      messages: [{ role: 'user', content: 'Return JSON' }],
    })
    if ('stream' in result) throw new Error('Expected a settled response')
    expect(JSON.parse(result.content)).toEqual({ ok: true })
  })

  it('preserves text from streamed Mistral content blocks', async () => {
    async function* chunks() {
      yield { choices: [{ delta: { content: answerBlocks.slice(0, 2) }, index: 0 }] }
      yield {
        choices: [{ delta: { content: answerBlocks.slice(2) }, index: 0, finish_reason: 'stop' }],
        usage,
      }
    }
    mockCreate.mockResolvedValueOnce(chunks())
    const result = await mistralProvider.executeRequest({
      model: 'zai-glm-5-3',
      apiKey: 'key',
      messages: [{ role: 'user', content: 'Return JSON' }],
      stream: true,
    })
    if (!('stream' in result)) throw new Error('Expected a stream')
    const events = await readAgentEvents(result.stream as ReadableStream<AgentStreamEvent>)
    const answer = events
      .filter((event) => event.type === 'text_delta')
      .map((event) => event.text)
      .join('')
    expect(JSON.parse(answer)).toEqual({ ok: true })
    expect(result.execution.output.content).toBe(answer)
  })

  it.each([
    { content: [] },
    { content: [{ type: 'thinking', thinking: [{ type: 'text', text: 'Private thought.' }] }] },
  ])(
    'preserves an earlier tool answer when later content has no answer text: $content',
    async ({ content }) => {
      mockCreate
        .mockResolvedValueOnce({
          ...toolResponse,
          choices: [{ message: { ...toolResponse.choices[0].message, content: answerBlocks } }],
        })
        .mockResolvedValueOnce({ choices: [{ message: { content } }], usage })
      const result = await mistralProvider.executeRequest({
        model: 'mistral-large-4',
        apiKey: 'key',
        messages: [{ role: 'user', content: 'Use a tool' }],
        tools: [makeTool('lookup')],
      })
      if ('stream' in result) throw new Error('Expected a settled response')
      expect(JSON.parse(result.content)).toEqual({ ok: true })
      const nextPayload = mockCreate.mock.calls[1][0]
      expect(
        nextPayload.messages.find((message: { role: string }) => message.role === 'assistant')
          .content
      ).toBe('{"ok":true}')
    }
  )

  it.each([false, true])(
    'normalizes the answer on the final allowed tool turn (streaming: %s)',
    async (stream) => {
      const previousLimit = providersMock.MAX_TOOL_ITERATIONS
      providersMock.MAX_TOOL_ITERATIONS = 1
      try {
        mockCreate.mockResolvedValueOnce(toolResponse).mockResolvedValueOnce(answerResponse)
        const result = await mistralProvider.executeRequest({
          model: 'mistral-large-4',
          apiKey: 'key',
          messages: [{ role: 'user', content: 'Use a tool' }],
          tools: [makeTool('lookup')],
          stream,
        })
        if ('stream' in result) {
          await readAgentEvents(result.stream as ReadableStream<AgentStreamEvent>)
          expect(JSON.parse(result.execution.output.content)).toEqual({ ok: true })
        } else expect(JSON.parse(result.content)).toEqual({ ok: true })
      } finally {
        providersMock.MAX_TOOL_ITERATIONS = previousLimit
      }
    }
  )

  it.each([false, true])(
    'normalizes the synthesis answer after the tool cap (streaming: %s)',
    async (stream) => {
      const previousLimit = providersMock.MAX_TOOL_ITERATIONS
      providersMock.MAX_TOOL_ITERATIONS = 1
      try {
        mockCreate
          .mockResolvedValueOnce(toolResponse)
          .mockResolvedValueOnce(toolResponse)
          .mockResolvedValueOnce(answerResponse)
        const result = await mistralProvider.executeRequest({
          model: 'zai-glm-5-3',
          apiKey: 'key',
          messages: [{ role: 'user', content: 'Use a tool' }],
          tools: [makeTool('lookup')],
          stream,
        })
        if ('stream' in result) {
          await readAgentEvents(result.stream as ReadableStream<AgentStreamEvent>)
          expect(JSON.parse(result.execution.output.content)).toEqual({ ok: true })
        } else expect(JSON.parse(result.content)).toEqual({ ok: true })
      } finally {
        providersMock.MAX_TOOL_ITERATIONS = previousLimit
      }
    }
  )

  it('projects the settled tool-loop answer without a final streaming request', async () => {
    mockCreate
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'lookup', arguments: '{}' },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'done', tool_calls: undefined } }],
        usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
      })

    const result = await mistralProvider.executeRequest!({
      model: 'mistral-large-latest',
      apiKey: 'key',
      messages: [{ role: 'user', content: 'Use a tool' }],
      stream: true,
      tools: [makeTool('lookup')],
    })

    expect(mockCreate).toHaveBeenCalledTimes(2)
    expect(mockExecuteTool).toHaveBeenCalledTimes(1)
    expect('stream' in result).toBe(true)
    if (!('stream' in result)) throw new Error('Expected streaming execution')
    expect(result.execution.output.content).toBe('done')
    expect(result.execution.output.tokens).toEqual({ input: 6, output: 3, total: 9 })
    expect(result.execution.output.providerTiming?.iterations).toBe(2)
    expect(
      result.execution.output.providerTiming?.timeSegments?.filter(
        (segment) => segment.type === 'model'
      )
    ).toHaveLength(2)
    await expect(
      readAgentEvents(result.stream as ReadableStream<AgentStreamEvent>)
    ).resolves.toEqual([{ type: 'text_delta', text: 'done', turn: 'final' }])
  })
})
