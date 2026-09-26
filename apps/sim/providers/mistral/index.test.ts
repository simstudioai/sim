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
vi.mock('@/providers/mistral/utils', () => ({
  createReadableStreamFromMistralStream: vi.fn(),
}))
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
