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

  it('accepts contract session chat events', () => {
    const event = {
      ...BASE_ENVELOPE,
      type: 'session' as const,
      payload: { kind: 'chat' as const, chatId: 'chat-1' },
    }

    expect(isContractStreamEventEnvelope(event)).toBe(true)
    expect(parsePersistedStreamEventEnvelope(event).ok).toBe(true)
  })

  it('accepts contract complete events', () => {
    const event = {
      ...BASE_ENVELOPE,
      type: 'complete' as const,
      payload: { status: 'complete' as const },
    }

    expect(isContractStreamEventEnvelope(event)).toBe(true)
    expect(parsePersistedStreamEventEnvelope(event).ok).toBe(true)
  })

  it('accepts contract error events', () => {
    const event = {
      ...BASE_ENVELOPE,
      type: 'error' as const,
      payload: { message: 'something went wrong' },
    }

    expect(isContractStreamEventEnvelope(event)).toBe(true)
    expect(parsePersistedStreamEventEnvelope(event).ok).toBe(true)
  })

  it('accepts contract tool call events', () => {
    const event = {
      ...BASE_ENVELOPE,
      type: 'tool' as const,
      payload: {
        toolCallId: 'tc-1',
        toolName: 'read',
        phase: 'call' as const,
        executor: 'sim' as const,
        mode: 'sync' as const,
      },
    }

    expect(isContractStreamEventEnvelope(event)).toBe(true)
    expect(parsePersistedStreamEventEnvelope(event).ok).toBe(true)
  })

  it('accepts contract span events', () => {
    const event = {
      ...BASE_ENVELOPE,
      type: 'span' as const,
      payload: { kind: 'subagent' as const, event: 'start' as const, agent: 'file' },
    }

    expect(isContractStreamEventEnvelope(event)).toBe(true)
    expect(parsePersistedStreamEventEnvelope(event).ok).toBe(true)
  })

  it('accepts contract resource events', () => {
    const event = {
      ...BASE_ENVELOPE,
      type: 'resource' as const,
      payload: {
        op: 'upsert' as const,
        resource: { id: 'r-1', type: 'file', title: 'test.md' },
      },
    }

    expect(isContractStreamEventEnvelope(event)).toBe(true)
    expect(parsePersistedStreamEventEnvelope(event).ok).toBe(true)
  })

  it('accepts contract run events', () => {
    const event = {
      ...BASE_ENVELOPE,
      type: 'run' as const,
      payload: { kind: 'compaction_start' as const },
    }

    expect(isContractStreamEventEnvelope(event)).toBe(true)
    expect(parsePersistedStreamEventEnvelope(event).ok).toBe(true)
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
  })

  it('rejects unknown event types', () => {
    const parsed = parsePersistedStreamEventEnvelope({
      ...BASE_ENVELOPE,
      type: 'unknown_type',
      payload: {},
    })

    expect(parsed.ok).toBe(false)
    if (parsed.ok) {
      throw new Error('expected invalid result')
    }
    expect(parsed.reason).toBe('invalid_stream_event')
    expect(parsed.errors).toContain('unknown type="unknown_type"')
  })

  it('rejects non-object values', () => {
    const parsed = parsePersistedStreamEventEnvelope('not an object')

    expect(parsed.ok).toBe(false)
    if (parsed.ok) {
      throw new Error('expected invalid result')
    }
    expect(parsed.reason).toBe('invalid_stream_event')
    expect(parsed.errors).toContain('value is not an object')
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
