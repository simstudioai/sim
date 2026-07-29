/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  AGENT_STREAM_PROTOCOL_HEADER,
  AGENT_STREAM_PROTOCOL_V1,
  clientAcceptsAgentStreamProtocol,
  hasAgentStreamPolicy,
  isChatChunkFrame,
  isChatChunkResetFrame,
  isChatToolFrame,
  shouldEmitAgentStreamEvents,
} from '@/lib/workflows/streaming/agent-stream-protocol'

function headers(init?: Record<string, string>): Headers {
  return new Headers(init)
}

describe('clientAcceptsAgentStreamProtocol', () => {
  it('depends on the header alone, never on a policy', () => {
    expect(
      clientAcceptsAgentStreamProtocol(
        headers({ [AGENT_STREAM_PROTOCOL_HEADER]: AGENT_STREAM_PROTOCOL_V1 })
      )
    ).toBe(true)
    expect(
      clientAcceptsAgentStreamProtocol(headers({ [AGENT_STREAM_PROTOCOL_HEADER]: ' V1 ' }))
    ).toBe(false)
    expect(clientAcceptsAgentStreamProtocol(headers())).toBe(false)
  })

  it('tolerates casing and comma lists from proxies', () => {
    expect(
      clientAcceptsAgentStreamProtocol(
        headers({ [AGENT_STREAM_PROTOCOL_HEADER]: ' Agent-Events-V1 ' })
      )
    ).toBe(true)
    expect(
      clientAcceptsAgentStreamProtocol(
        headers({ [AGENT_STREAM_PROTOCOL_HEADER]: 'text, agent-events-v1' })
      )
    ).toBe(true)
  })
})

describe('tool frame guard', () => {
  const base = { event: 'tool', blockId: 'agent-1', phase: 'end', id: 'call_1', name: 'search' }

  it('accepts every documented terminal status and a start frame without one', () => {
    expect(isChatToolFrame({ ...base, phase: 'start' })).toBe(true)
    for (const status of ['success', 'error', 'cancelled']) {
      expect(isChatToolFrame({ ...base, status })).toBe(true)
    }
  })

  it('rejects an unrecognized status instead of letting it settle as success', () => {
    expect(isChatToolFrame({ ...base, status: 'timeout' })).toBe(false)
    expect(isChatToolFrame({ ...base, status: 42 })).toBe(false)
  })
})

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
  const negotiated = () => headers({ [AGENT_STREAM_PROTOCOL_HEADER]: AGENT_STREAM_PROTOCOL_V1 })

  it('is off when neither policy is set', () => {
    expect(
      shouldEmitAgentStreamEvents({
        includeThinking: false,
        includeToolCalls: false,
        requestHeaders: negotiated(),
      })
    ).toBe(false)
    expect(
      shouldEmitAgentStreamEvents({
        includeThinking: undefined,
        includeToolCalls: undefined,
        requestHeaders: negotiated(),
      })
    ).toBe(false)
  })

  it('is on when either policy is set on a negotiated client', () => {
    expect(
      shouldEmitAgentStreamEvents({
        includeThinking: true,
        includeToolCalls: false,
        requestHeaders: negotiated(),
      })
    ).toBe(true)
    expect(
      shouldEmitAgentStreamEvents({
        includeThinking: false,
        includeToolCalls: true,
        requestHeaders: negotiated(),
      })
    ).toBe(true)
  })

  /**
   * Frames have no defined shape for a client that never declared a version,
   * so policy alone is not enough.
   */
  it('is off without the protocol header even when policy is on', () => {
    expect(
      shouldEmitAgentStreamEvents({
        includeThinking: true,
        includeToolCalls: true,
        requestHeaders: headers(),
      })
    ).toBe(false)
  })
})

describe('hasAgentStreamPolicy', () => {
  /**
   * Surfaces where the caller sets the policy use this to reject an
   * un-negotiated request instead of silently dropping the flags.
   */
  it('reports the policy independently of negotiation', () => {
    expect(hasAgentStreamPolicy({ includeThinking: true, includeToolCalls: false })).toBe(true)
    expect(hasAgentStreamPolicy({ includeThinking: false, includeToolCalls: true })).toBe(true)
    expect(hasAgentStreamPolicy({ includeThinking: false, includeToolCalls: false })).toBe(false)
    expect(hasAgentStreamPolicy({ includeThinking: undefined, includeToolCalls: null })).toBe(false)
  })
})
