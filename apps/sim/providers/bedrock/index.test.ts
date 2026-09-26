import {
  providersConversationHistoryMock,
  providersConversationHistoryMockFns,
} from '@sim/testing/mocks/providers-conversation-history.mock'
import {
  providersModelsMock,
  providersModelsMockFns,
} from '@sim/testing/mocks/providers-models.mock'
import { providersUtilsMock, providersUtilsMockFns } from '@sim/testing/mocks/providers-utils.mock'
import { toolsMock, toolsMockFns } from '@sim/testing/mocks/tools.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSend = vi.fn()
const capturedRequestHistories = vi.hoisted(() => [] as unknown[])

vi.mock('@/providers/conversation-history', () => providersConversationHistoryMock)

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: vi.fn().mockImplementation(
    class {
      send = mockSend
    }
  ),
  ConverseCommand: vi.fn(),
  ConverseStreamCommand: vi.fn(),
}))

vi.mock('@/providers/bedrock/utils', () => ({
  getBedrockInferenceProfileId: vi
    .fn()
    .mockReturnValue('us.anthropic.claude-3-5-sonnet-20241022-v2:0'),
  checkForForcedToolUsage: vi.fn(),
  createReadableStreamFromBedrockStream: vi.fn(),
  generateToolUseId: vi.fn().mockReturnValue('tool-1'),
  getBedrockBaseModelId: (model: string) => model.replace(/^bedrock\//i, ''),
  getBedrockStreamError: vi.fn().mockReturnValue(null),
  // The mocked inference profile above is a Claude model, which supports it.
  supportsToolResultStatus: vi.fn().mockReturnValue(true),
  toBedrockConversationUsage: (usage?: { inputTokens: number; outputTokens: number }) =>
    usage ? { input: usage.inputTokens, output: usage.outputTokens } : undefined,
}))

vi.mock('@/providers/models', () => providersModelsMock)

vi.mock('@/providers/utils', () => providersUtilsMock)

vi.mock('@/tools', () => toolsMock)

import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime'
import type { StreamingExecution } from '@/executor/types'
import { bedrockProvider } from '@/providers/bedrock/index'
import { clearProviderClientCacheForTests } from '@/providers/client-cache'
import { getModelCapabilities, isKnownModelId } from '@/providers/models'
import { prepareToolsWithUsageControl } from '@/providers/utils'

providersModelsMockFns.mockGetModelCapabilities.mockReturnValue({ temperature: { min: 0, max: 1 } })
providersModelsMockFns.mockIsKnownModelId.mockReturnValue(true)
providersConversationHistoryMockFns.mockCaptureProviderConversationStep.mockImplementation(
  (
    _request: unknown,
    _protocol: unknown,
    _message: unknown,
    _usage: unknown,
    options?: { requestHistory?: readonly unknown[] }
  ) => {
    capturedRequestHistories.push(structuredClone(options?.requestHistory))
    return Promise.resolve()
  }
)

providersUtilsMockFns.mockCalculateCost.mockReturnValue({
  input: 0,
  output: 0,
  total: 0,
  pricing: null,
})
providersUtilsMockFns.mockPrepareToolsWithUsageControl.mockReturnValue({
  tools: [],
  toolChoice: 'auto',
  forcedTools: [],
  hasFilteredTools: false,
})

toolsMockFns.mockExecuteTool.mockResolvedValue({ success: true, output: false })

describe('bedrockProvider credential handling', () => {
  beforeEach(() => {
    capturedRequestHistories.length = 0
    clearProviderClientCacheForTests()
    mockSend.mockResolvedValue({
      output: { message: { content: [{ text: 'response' }] } },
      usage: { inputTokens: 10, outputTokens: 5 },
    })
  })

  const baseRequest = {
    model: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
    systemPrompt: 'You are helpful.',
    messages: [{ role: 'user' as const, content: 'Hello' }],
  }

  it('preserves system-only instructions while supplying the required user message', async () => {
    await bedrockProvider.executeRequest({
      ...baseRequest,
      messages: [{ role: 'system', content: 'Answer in French.' }],
    })
    expect(ConverseCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        system: [{ text: 'You are helpful.' }, { text: 'Answer in French.' }],
        messages: [{ role: 'user', content: [{ text: 'Hello' }] }],
      })
    )
  })

  it('rejects an orphan tool result before sending a memory-disabled request', async () => {
    await expect(
      bedrockProvider.executeRequest({
        ...baseRequest,
        messages: [{ role: 'tool', tool_call_id: 'orphan', content: 'result' }],
      })
    ).rejects.toThrow('no matching unresolved assistant tool call')
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('throws when only bedrockAccessKeyId is provided', async () => {
    await expect(
      bedrockProvider.executeRequest({
        ...baseRequest,
        bedrockAccessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      })
    ).rejects.toThrow('Both bedrockAccessKeyId and bedrockSecretKey must be provided together')
  })

  it('throws when only bedrockSecretKey is provided', async () => {
    await expect(
      bedrockProvider.executeRequest({
        ...baseRequest,
        bedrockSecretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      })
    ).rejects.toThrow('Both bedrockAccessKeyId and bedrockSecretKey must be provided together')
  })

  it('creates client with explicit credentials when both are provided', async () => {
    await bedrockProvider.executeRequest({
      ...baseRequest,
      bedrockAccessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      bedrockSecretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    })

    expect(BedrockRuntimeClient).toHaveBeenCalledWith({
      region: 'us-east-1',
      credentials: {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      },
    })
  })

  it('omits temperature for catalog models that do not support it', async () => {
    vi.mocked(getModelCapabilities).mockReturnValueOnce({ maxOutputTokens: 128000 })
    await bedrockProvider.executeRequest({
      ...baseRequest,
      model: 'bedrock/anthropic.claude-opus-5',
      temperature: 0.7,
    })
    expect(ConverseCommand).toHaveBeenCalledWith(expect.objectContaining({ inferenceConfig: {} }))
  })

  it('preserves explicit temperature for a custom model without catalog capabilities', async () => {
    vi.mocked(isKnownModelId).mockReturnValueOnce(false)
    await bedrockProvider.executeRequest({
      ...baseRequest,
      model: 'bedrock/MyCustomProfile',
      temperature: 0.2,
    })
    expect(ConverseCommand).toHaveBeenCalledWith(
      expect.objectContaining({ inferenceConfig: { temperature: 0.2 } })
    )
  })

  it('leaves temperature to the service default for a custom model when omitted', async () => {
    vi.mocked(isKnownModelId).mockReturnValueOnce(false)
    await bedrockProvider.executeRequest({ ...baseRequest, model: 'bedrock/MyCustomProfile' })
    expect(ConverseCommand).toHaveBeenCalledWith(expect.objectContaining({ inferenceConfig: {} }))
  })

  it('uses the live loop for streaming tool requests without a caller flag', async () => {
    vi.mocked(prepareToolsWithUsageControl).mockReturnValueOnce({
      tools: [
        {
          name: 'lookup',
          description: 'Lookup',
          input_schema: { type: 'object', properties: {}, required: [] },
        },
      ],
      toolChoice: 'auto',
      forcedTools: [],
      hasFilteredTools: false,
    })
    mockSend
      .mockResolvedValueOnce({
        stream: (async function* () {
          yield {
            contentBlockStart: {
              contentBlockIndex: 0,
              start: {
                toolUse: {
                  toolUseId: 'tool-1',
                  name: 'lookup',
                },
              },
            },
          }
          yield {
            contentBlockDelta: {
              contentBlockIndex: 0,
              delta: { toolUse: { input: '{}' } },
            },
          }
          yield { metadata: { usage: { inputTokens: 1, outputTokens: 1 } } }
          yield { messageStop: { stopReason: 'tool_use' } }
        })(),
      })
      .mockResolvedValueOnce({
        stream: (async function* () {
          yield {
            contentBlockDelta: {
              contentBlockIndex: 0,
              delta: { text: 'settled answer' },
            },
          }
          yield { metadata: { usage: { inputTokens: 2, outputTokens: 2 } } }
          yield { messageStop: { stopReason: 'end_turn' } }
        })(),
      })

    const result = (await bedrockProvider.executeRequest({
      ...baseRequest,
      stream: true,
      tools: [
        {
          id: 'lookup',
          name: 'lookup',
          description: 'Lookup',
          params: {},
          parameters: { type: 'object', properties: {}, required: [] },
        },
      ],
    })) as StreamingExecution

    const reader = result.stream.getReader()
    while (!(await reader.read()).done) {}

    expect(mockSend).toHaveBeenCalledTimes(2)
    expect(capturedRequestHistories[0]).toEqual([{ role: 'user', content: [{ text: 'Hello' }] }])
    expect(capturedRequestHistories[1]).toHaveLength(3)
    expect(result.execution.output.content).toBe('settled answer')
    expect(result.execution.output.providerTiming?.iterations).toBe(2)
    expect(
      result.execution.output.providerTiming?.timeSegments?.filter(
        (segment) => segment.type === 'model'
      )
    ).toHaveLength(2)
  })

  it('keeps the explicit structured-output extraction call before settled projection', async () => {
    vi.mocked(prepareToolsWithUsageControl).mockReturnValueOnce({
      tools: [
        {
          name: 'lookup',
          description: 'Lookup',
          input_schema: { type: 'object', properties: {}, required: [] },
        },
      ],
      toolChoice: 'auto',
      forcedTools: [],
      hasFilteredTools: false,
    })
    mockSend
      .mockResolvedValueOnce({
        output: {
          message: {
            content: [
              {
                toolUse: {
                  toolUseId: 'tool-1',
                  name: 'lookup',
                  input: {},
                },
              },
            ],
          },
        },
        stopReason: 'tool_use',
        usage: { inputTokens: 1, outputTokens: 1 },
      })
      .mockResolvedValueOnce({
        output: { message: { content: [{ text: 'unformatted answer' }] } },
        stopReason: 'end_turn',
        usage: { inputTokens: 2, outputTokens: 2 },
      })
      .mockResolvedValueOnce({
        output: {
          message: {
            content: [
              {
                toolUse: {
                  toolUseId: 'structured-1',
                  name: 'structured_output',
                  input: { answer: 'formatted' },
                },
              },
            ],
          },
        },
        stopReason: 'tool_use',
        usage: { inputTokens: 3, outputTokens: 3 },
      })

    const result = (await bedrockProvider.executeRequest({
      ...baseRequest,
      stream: true,
      tools: [
        {
          id: 'lookup',
          name: 'lookup',
          description: 'Lookup',
          params: {},
          parameters: { type: 'object', properties: {}, required: [] },
        },
      ],
      responseFormat: {
        name: 'answer',
        schema: {
          type: 'object',
          properties: { answer: { type: 'string' } },
          required: ['answer'],
        },
      },
    })) as StreamingExecution

    expect(mockSend).toHaveBeenCalledTimes(3)
    expect(capturedRequestHistories[0]).toEqual([{ role: 'user', content: [{ text: 'Hello' }] }])
    expect(capturedRequestHistories[1]).toHaveLength(3)
    expect(result.execution.output.providerTiming?.iterations).toBe(3)
    expect(
      result.execution.output.providerTiming?.timeSegments?.filter(
        (segment) => segment.type === 'model'
      )
    ).toHaveLength(3)
    expect(vi.mocked(ConverseCommand).mock.calls[2][0]).toMatchObject({
      toolConfig: {
        tools: [
          {
            toolSpec: {
              name: 'structured_output',
            },
          },
        ],
        toolChoice: { tool: { name: 'structured_output' } },
      },
    })

    const reader = result.stream.getReader()
    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: {
        type: 'text_delta',
        text: '{\n  "answer": "formatted"\n}',
        turn: 'final',
      },
    })
  })
})
