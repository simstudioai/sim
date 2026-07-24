/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  AGENT_STREAM_PROTOCOL_HEADER,
  AGENT_STREAM_PROTOCOL_V1,
  isChatChunkFrame,
  isChatChunkResetFrame,
  shouldEmitAgentStreamEvents,
} from '@/lib/workflows/streaming/agent-stream-protocol'

function headers(init?: Record<string, string>): Headers {
  return new Headers(init)
}

describe('chunk_reset frame guard', () => {
  it('identifies reset frames and keeps them out of the chunk guard', () => {
    const reset = { blockId: 'agent-1', event: 'chunk_reset' }
    expect(isChatChunkResetFrame(reset)).toBe(true)
    // A reset must never be appended as answer text.
    expect(isChatChunkFrame(reset)).toBe(false)

    expect(isChatChunkResetFrame({ event: 'chunk_reset' })).toBe(false)
    expect(isChatChunkResetFrame({ blockId: 'agent-1', chunk: 'text' })).toBe(false)
  })
})

describe('shouldEmitAgentStreamEvents', () => {
  it('defaults to false when policy is off and header is missing', () => {
    expect(
      shouldEmitAgentStreamEvents({
        includeThinking: false,
        includeToolCalls: false,
        requestHeaders: headers(),
      })
    ).toBe(false)
    expect(
      shouldEmitAgentStreamEvents({
        includeThinking: undefined,
        includeToolCalls: undefined,
        requestHeaders: headers(),
      })
    ).toBe(false)
  })

  it('requires the protocol header and at least one event policy', () => {
    expect(
      shouldEmitAgentStreamEvents({
        includeThinking: true,
        includeToolCalls: false,
        requestHeaders: headers(),
      })
    ).toBe(false)

    expect(
      shouldEmitAgentStreamEvents({
        includeThinking: false,
        includeToolCalls: false,
        requestHeaders: headers({ [AGENT_STREAM_PROTOCOL_HEADER]: AGENT_STREAM_PROTOCOL_V1 }),
      })
    ).toBe(false)

    expect(
      shouldEmitAgentStreamEvents({
        includeThinking: true,
        includeToolCalls: false,
        requestHeaders: headers({ [AGENT_STREAM_PROTOCOL_HEADER]: AGENT_STREAM_PROTOCOL_V1 }),
      })
    ).toBe(true)

    expect(
      shouldEmitAgentStreamEvents({
        includeThinking: false,
        includeToolCalls: true,
        requestHeaders: headers({ [AGENT_STREAM_PROTOCOL_HEADER]: AGENT_STREAM_PROTOCOL_V1 }),
      })
    ).toBe(true)
  })

  it('accepts case-insensitive header values and comma lists', () => {
    expect(
      shouldEmitAgentStreamEvents({
        includeThinking: true,
        includeToolCalls: false,
        requestHeaders: headers({ [AGENT_STREAM_PROTOCOL_HEADER]: ' Agent-Events-V1 ' }),
      })
    ).toBe(true)

    expect(
      shouldEmitAgentStreamEvents({
        includeThinking: false,
        includeToolCalls: true,
        requestHeaders: headers({
          [AGENT_STREAM_PROTOCOL_HEADER]: 'text, agent-events-v1',
        }),
      })
    ).toBe(true)
  })
})
