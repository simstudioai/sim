/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import {
  isContractStreamEventEnvelope,
  isSyntheticFilePreviewEventEnvelope,
  parsePersistedStreamEventEnvelope,
  parsePersistedStreamEventEnvelopeJson,
} from './contract'

const BASE_ENVELOPE = {
  v: 1 as const,
  seq: 1,
  ts: '2026-04-11T00:00:00.000Z',
  stream: {
    streamId: 'stream-1',
    cursor: '1',
  },
  trace: {
    requestId: 'req-1',
  },
}

describe('stream session contract parser', () => {
  it('accepts contract text events', () => {
    const event = {
      ...BASE_ENVELOPE,
      type: 'text' as const,
      payload: {
        channel: 'assistant' as const,
        text: 'hello',
      },
    }

    expect(isContractStreamEventEnvelope(event)).toBe(true)

    const parsed = parsePersistedStreamEventEnvelope(event)
    expect(parsed).toEqual({
      ok: true,
      event,
    })
  })

  it('accepts synthetic file preview events', () => {
    const event = {
      ...BASE_ENVELOPE,
      type: 'tool' as const,
      payload: {
        toolCallId: 'preview-1',
        toolName: 'workspace_file' as const,
        previewPhase: 'file_preview_content' as const,
        content: 'draft body',
        contentMode: 'snapshot' as const,
        previewVersion: 2,
        fileName: 'draft.md',
      },
    }

    expect(isSyntheticFilePreviewEventEnvelope(event)).toBe(true)

    const parsed = parsePersistedStreamEventEnvelope(event)
    expect(parsed).toEqual({
      ok: true,
      event,
    })
  })

  it('rejects invalid tool events with structured validation errors', () => {
    const parsed = parsePersistedStreamEventEnvelope({
      ...BASE_ENVELOPE,
      type: 'tool',
      payload: {
        toolCallId: 'tool-1',
        toolName: 'read',
      },
    })

    expect(parsed.ok).toBe(false)
    if (parsed.ok) {
      throw new Error('expected invalid result')
    }
    expect(parsed.reason).toBe('invalid_stream_event')
    expect(parsed.errors?.length).toBeGreaterThan(0)
  })

  it('reports invalid JSON separately from schema failures', () => {
    const parsed = parsePersistedStreamEventEnvelopeJson('{')

    expect(parsed.ok).toBe(false)
    if (parsed.ok) {
      throw new Error('expected invalid json result')
    }
    expect(parsed.reason).toBe('invalid_json')
  })
})
