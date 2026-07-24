/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSend = vi.fn()

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
  getBedrockStreamError: vi.fn().mockReturnValue(null),
}))

vi.mock('@/providers/models', () => ({
  getProviderFileAttachment: vi
    .fn()
    .mockReturnValue({ maxBytes: 10 * 1024 * 1024, strategy: 'inline' }),
  INLINE_ATTACHMENT_MAX_BYTES: 10 * 1024 * 1024,
  getProviderModels: vi.fn().mockReturnValue([]),
  getProviderDefaultModel: vi.fn().mockReturnValue('us.anthropic.claude-3-5-sonnet-20241022-v2:0'),
  supportsNativeStructuredOutputs: vi.fn().mockReturnValue(false),
}))

vi.mock('@/providers/utils', () => ({
  calculateCost: vi.fn().mockReturnValue({ input: 0, output: 0, total: 0, pricing: null }),
  prepareToolExecution: vi.fn((_tool, args) => ({
    toolParams: args,
    executionParams: args,
  })),
  prepareToolsWithUsageControl: vi.fn().mockReturnValue({
    tools: [],
    toolChoice: 'auto',
    forcedTools: [],
  }),
  sumToolCosts: vi.fn().mockReturnValue(0),
}))

vi.mock('@/tools', () => ({
  executeTool: vi.fn().mockResolvedValue({ success: true, output: false }),
}))

import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime'
import type { StreamingExecution } from '@/executor/types'
import { bedrockProvider } from '@/providers/bedrock/index'
import { clearProviderClientCacheForTests } from '@/providers/client-cache'
import { prepareToolsWithUsageControl } from '@/providers/utils'

describe('bedrockProvider credential handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('creates client without credentials when neither is provided', async () => {
    await bedrockProvider.executeRequest(baseRequest)

    expect(BedrockRuntimeClient).toHaveBeenCalledWith({
      region: 'us-east-1',
    })
  })

  it('uses custom region when provided', async () => {
    await bedrockProvider.executeRequest({
      ...baseRequest,
      bedrockRegion: 'eu-west-1',
    })

    expect(BedrockRuntimeClient).toHaveBeenCalledWith({
      region: 'eu-west-1',
    })
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
