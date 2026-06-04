/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1TextChannel,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { parsePersistedStreamEventEnvelope } from '@/lib/copilot/request/session'
import { createEvent, eventToStreamEvent } from '@/lib/copilot/request/session/event'

describe('createEvent', () => {
  it('creates contract envelopes that pass validation', () => {
    const envelope = createEvent({
      streamId: 'stream-1',
      cursor: '1',
      seq: 1,
      requestId: 'req-1',
      type: MothershipStreamV1EventType.text,
      payload: {
        channel: MothershipStreamV1TextChannel.assistant,
        text: 'hello',
      },
    })

    const parsed = parsePersistedStreamEventEnvelope(envelope)
    expect(parsed.ok).toBe(true)
    expect(envelope.type).toBe(MothershipStreamV1EventType.text)
    expect(envelope.payload).toEqual({
      channel: MothershipStreamV1TextChannel.assistant,
      text: 'hello',
    })
  })

  it('creates synthetic preview envelopes that round-trip to stream events', () => {
    const envelope = createEvent({
      streamId: 'stream-1',
      cursor: '2',
      seq: 2,
      requestId: 'req-1',
      type: MothershipStreamV1EventType.tool,
      payload: {
        previewPhase: 'file_preview_start',
        toolCallId: 'preview-1',
        toolName: 'workspace_file',
      },
    })

    const parsed = parsePersistedStreamEventEnvelope(envelope)
    expect(parsed.ok).toBe(true)

    const streamEvent = eventToStreamEvent(envelope)
    expect(streamEvent).toEqual({
      type: MothershipStreamV1EventType.tool,
      payload: {
        previewPhase: 'file_preview_start',
        toolCallId: 'preview-1',
        toolName: 'workspace_file',
      },
    })
  })
})
