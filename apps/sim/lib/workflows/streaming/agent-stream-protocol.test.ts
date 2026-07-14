/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  AGENT_STREAM_PROTOCOL_HEADER,
  AGENT_STREAM_PROTOCOL_V1,
  requestOptsIntoAgentStreamProtocol,
  shouldEmitAgentStreamEvents,
} from '@/lib/workflows/streaming/agent-stream-protocol'

function headers(init?: Record<string, string>): Headers {
  return new Headers(init)
}

describe('shouldEmitAgentStreamEvents', () => {
  it('defaults to false when policy is off and header is missing', () => {
    expect(
      shouldEmitAgentStreamEvents({
        includeThinking: false,
        requestHeaders: headers(),
      })
    ).toBe(false)
    expect(
      shouldEmitAgentStreamEvents({
        includeThinking: undefined,
        requestHeaders: headers(),
      })
    ).toBe(false)
  })

  it('requires both includeThinking and protocol header', () => {
    expect(
      shouldEmitAgentStreamEvents({
        includeThinking: true,
        requestHeaders: headers(),
      })
    ).toBe(false)

    expect(
      shouldEmitAgentStreamEvents({
        includeThinking: false,
        requestHeaders: headers({ [AGENT_STREAM_PROTOCOL_HEADER]: AGENT_STREAM_PROTOCOL_V1 }),
      })
    ).toBe(false)

    expect(
      shouldEmitAgentStreamEvents({
        includeThinking: true,
        requestHeaders: headers({ [AGENT_STREAM_PROTOCOL_HEADER]: AGENT_STREAM_PROTOCOL_V1 }),
      })
    ).toBe(true)
  })

  it('accepts case-insensitive header values and comma lists', () => {
    expect(
      shouldEmitAgentStreamEvents({
        includeThinking: true,
        requestHeaders: headers({ [AGENT_STREAM_PROTOCOL_HEADER]: ' Agent-Events-V1 ' }),
      })
    ).toBe(true)

    expect(
      shouldEmitAgentStreamEvents({
        includeThinking: true,
        requestHeaders: headers({
          [AGENT_STREAM_PROTOCOL_HEADER]: 'text, agent-events-v1',
        }),
      })
    ).toBe(true)
  })
})

describe('requestOptsIntoAgentStreamProtocol', () => {
  it('detects protocol opt-in independent of deployment policy', () => {
    expect(requestOptsIntoAgentStreamProtocol(headers())).toBe(false)
    expect(
      requestOptsIntoAgentStreamProtocol(
        headers({ [AGENT_STREAM_PROTOCOL_HEADER]: AGENT_STREAM_PROTOCOL_V1 })
      )
    ).toBe(true)
  })
})
