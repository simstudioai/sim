import { describe, expect, it, vi } from 'vitest'
import {
  createReadableStreamFromBedrockStream,
  getBedrockInferenceProfileId,
  supportsToolResultStatus,
  toBedrockConversationUsage,
} from '@/providers/bedrock/utils'
import type { AgentStreamEvent } from '@/providers/stream-events'

describe('getBedrockInferenceProfileId', () => {
  it.concurrent('prefixes geo inference profile for models that require it', () => {
    expect(
      getBedrockInferenceProfileId('bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0', 'us-east-1')
    ).toBe('us.anthropic.claude-sonnet-4-5-20250929-v1:0')
    expect(getBedrockInferenceProfileId('bedrock/amazon.nova-pro-v1:0', 'eu-west-1')).toBe(
      'eu.amazon.nova-pro-v1:0'
    )
    expect(
      getBedrockInferenceProfileId('bedrock/meta.llama4-scout-17b-instruct-v1:0', 'us-west-2')
    ).toBe('us.meta.llama4-scout-17b-instruct-v1:0')
  })

  it.concurrent('returns already-prefixed inference profile IDs unchanged', () => {
    expect(
      getBedrockInferenceProfileId('us.anthropic.claude-sonnet-4-5-20250929-v1:0', 'us-east-1')
    ).toBe('us.anthropic.claude-sonnet-4-5-20250929-v1:0')
    expect(getBedrockInferenceProfileId('global.amazon.nova-2-lite-v1:0', 'us-east-1')).toBe(
      'global.amazon.nova-2-lite-v1:0'
    )
  })

  it.each([
    'arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/MyProfile',
    'arn:aws:bedrock:us-east-1:123456789012:custom-model-deployment/MyDeployment',
    'MyCustomProfile',
    'future.vendor-model-v1:0',
    'global.anthropic.claude-opus-5',
  ])('preserves caller-supplied model ID %s', (model) => {
    expect(getBedrockInferenceProfileId(`BEDROCK/${model}`, 'us-east-1')).toBe(model)
  })

  it.concurrent('uses only published geographic prefixes for new catalog models', () => {
    expect(getBedrockInferenceProfileId('bedrock/anthropic.claude-opus-5', 'us-east-1')).toBe(
      'us.anthropic.claude-opus-5'
    )
    expect(getBedrockInferenceProfileId('bedrock/anthropic.claude-opus-5', 'ap-southeast-2')).toBe(
      'au.anthropic.claude-opus-5'
    )
    expect(getBedrockInferenceProfileId('bedrock/openai.gpt-5.6-sol', 'us-east-1')).toBe(
      'us.openai.gpt-5.6-sol'
    )
    expect(() => getBedrockInferenceProfileId('bedrock/openai.gpt-5.6-sol', 'eu-west-1')).toThrow(
      'Supply an explicit bedrock/global.'
    )
    expect(getBedrockInferenceProfileId('bedrock/openai.gpt-oss-120b-1:0', 'us-east-1')).toBe(
      'openai.gpt-oss-120b-1:0'
    )
  })

  it.concurrent('returns the bare model ID for models without geo profile support', () => {
    expect(
      getBedrockInferenceProfileId('bedrock/mistral.mistral-large-3-675b-instruct', 'us-east-1')
    ).toBe('mistral.mistral-large-3-675b-instruct')
    expect(
      getBedrockInferenceProfileId('bedrock/mistral.ministral-3-8b-instruct', 'eu-west-1')
    ).toBe('mistral.ministral-3-8b-instruct')
    expect(getBedrockInferenceProfileId('bedrock/cohere.command-r-plus-v1:0', 'us-east-1')).toBe(
      'cohere.command-r-plus-v1:0'
    )
    expect(
      getBedrockInferenceProfileId('bedrock/mistral.mixtral-8x7b-instruct-v0:1', 'ap-southeast-1')
    ).toBe('mistral.mixtral-8x7b-instruct-v0:1')
    expect(
      getBedrockInferenceProfileId('bedrock/amazon.titan-text-premier-v1:0', 'us-east-1')
    ).toBe('amazon.titan-text-premier-v1:0')
  })
})

describe('supportsToolResultStatus', () => {
  it.concurrent('accepts Claude and Nova through every ID form', () => {
    expect(supportsToolResultStatus('bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0')).toBe(true)
    expect(supportsToolResultStatus('us.anthropic.claude-opus-4-5-20251101-v1:0')).toBe(true)
    expect(supportsToolResultStatus('anthropic.claude-haiku-4-5-20251001-v1:0')).toBe(true)
    expect(supportsToolResultStatus('global.amazon.nova-2-lite-v1:0')).toBe(true)
    expect(supportsToolResultStatus('bedrock/amazon.nova-micro-v1:0')).toBe(true)
  })

  it.concurrent('rejects every family that returns a ValidationException for it', () => {
    expect(supportsToolResultStatus('us.meta.llama4-scout-17b-instruct-v1:0')).toBe(false)
    expect(supportsToolResultStatus('bedrock/meta.llama3-3-70b-instruct-v1:0')).toBe(false)
    expect(supportsToolResultStatus('mistral.mistral-large-2407-v1:0')).toBe(false)
    expect(supportsToolResultStatus('cohere.command-r-plus-v1:0')).toBe(false)
    // Titan shares the amazon vendor prefix but is not Nova.
    expect(supportsToolResultStatus('bedrock/amazon.titan-text-premier-v1:0')).toBe(false)
  })
})

describe('createReadableStreamFromBedrockStream', () => {
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

  it('captures stream cache usage without subtracting it from uncached input', async () => {
    const onComplete = vi.fn()
    await collectEvents(
      createReadableStreamFromBedrockStream(
        (async function* () {
          yield {
            metadata: {
              usage: {
                inputTokens: 10,
                outputTokens: 20,
                totalTokens: 100,
                cacheReadInputTokens: 30,
                cacheWriteInputTokens: 40,
                cacheDetails: [
                  { ttl: '1h', inputTokens: 15 },
                  { ttl: '5m', inputTokens: 25 },
                ],
              },
              metrics: { latencyMs: 1 },
            },
          }
        })(),
        onComplete
      )
    )
    expect(
      toBedrockConversationUsage(
        onComplete.mock.calls[0][1],
        'bedrock/us.anthropic.claude-sonnet-4-6'
      )
    ).toEqual({
      input: 10,
      output: 20,
      cacheRead: 30,
      cacheWrites: [
        { tokens: 25, inputRateMultiplier: 1.25 },
        { tokens: 15, inputRateMultiplier: 2 },
      ],
    })
  })

  it('uses the standard Anthropic cache tier when TTL details are absent', () => {
    expect(
      toBedrockConversationUsage(
        { cacheWriteInputTokens: 40 },
        'bedrock/anthropic.claude-sonnet-4-6'
      )
    ).toMatchObject({
      cacheWrites: [
        { tokens: 40, inputRateMultiplier: 1.25 },
        { tokens: 0, inputRateMultiplier: 2 },
      ],
    })
  })

  it('does not apply Anthropic cache-write premiums to Nova', () => {
    expect(
      toBedrockConversationUsage({ cacheWriteInputTokens: 40 }, 'bedrock/amazon.nova-lite-v1:0')
    ).toEqual({
      input: 0,
      output: 0,
      cacheWrites: [{ tokens: 40, inputRateMultiplier: 1 }],
    })
  })

  it('retains complete signed reasoning in the final callback while awaiting persistence', async () => {
    const onComplete = vi.fn(async () => {
      await Promise.resolve()
    })
    const stream = createReadableStreamFromBedrockStream(
      (async function* () {
        yield {
          contentBlockDelta: {
            contentBlockIndex: 0,
            delta: { reasoningContent: { text: 'Think' } },
          },
        }
        yield {
          contentBlockDelta: {
            contentBlockIndex: 0,
            delta: { reasoningContent: { signature: 'sig' } },
          },
        }
        yield {
          contentBlockDelta: {
            contentBlockIndex: 1,
            delta: { reasoningContent: { redactedContent: new Uint8Array([1, 2]) } },
          },
        }
        yield { contentBlockDelta: { contentBlockIndex: 2, delta: { text: 'Done' } } }
      })(),
      onComplete
    )

    await collectEvents(stream)
    expect(onComplete).toHaveBeenCalledWith(
      'Done',
      { inputTokens: 0, outputTokens: 0 },
      {
        role: 'assistant',
        content: [
          { reasoningContent: { reasoningText: { text: 'Think', signature: 'sig' } } },
          { reasoningContent: { redactedContent: new Uint8Array([1, 2]) } },
          { text: 'Done' },
        ],
      }
    )
  })

  it('emits text only — no tool events (never executed on this path) and no invented thinking', async () => {
    const onComplete = vi.fn()
    const stream = createReadableStreamFromBedrockStream(
      (async function* () {
        yield {
          contentBlockStart: {
            start: {
              toolUse: { toolUseId: 'tooluse_1', name: 'http_request' },
            },
          },
        } as any
        yield {
          contentBlockDelta: { delta: { text: 'Done' } },
        } as any
        yield {
          metadata: { usage: { inputTokens: 2, outputTokens: 3 } },
        } as any
      })(),
      onComplete
    )

    const events = await collectEvents(stream)
    expect(events).toEqual([{ type: 'text_delta', text: 'Done', turn: 'final' }])
    expect(events.some((e) => e.type === 'thinking_delta')).toBe(false)
    expect(events.some((e) => e.type === 'tool_call_start')).toBe(false)
    expect(onComplete).toHaveBeenCalledWith(
      'Done',
      { inputTokens: 2, outputTokens: 3 },
      { role: 'assistant', content: [{ text: 'Done' }] }
    )
  })

  it('surfaces Bedrock event-stream exceptions', async () => {
    const stream = createReadableStreamFromBedrockStream(
      (async function* () {
        yield {
          modelStreamErrorException: { message: 'Model stream failed' },
        } as any
      })()
    )

    await expect(collectEvents(stream)).rejects.toThrow('Model stream failed')
  })
})
