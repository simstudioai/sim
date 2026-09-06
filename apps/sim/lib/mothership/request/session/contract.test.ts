/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { MothershipStreamV1RunKind } from '@/lib/mothership/generated/mothership-stream-v1'
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
      trace: {
        ...BASE_ENVELOPE.trace,
        goTraceId: 'go-trace-1',
      },
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

  it('accepts every run kind the generated contract names', () => {
    // A hand-kept kind list rejected steering_applied and then task_armed the day each
    // shipped; an unknown-but-contracted kind is fatal to the live turn.
    for (const kind of Object.values(MothershipStreamV1RunKind)) {
      const event = {
        ...BASE_ENVELOPE,
        type: 'run' as const,
        payload: { kind, taskId: 't', taskKind: 'timer', target: {}, note: 'n' },
      }
      expect(isContractStreamEventEnvelope(event)).toBe(true)
    }
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

  it.each(['run', 'complete'])('validates activity acknowledgement on %s boundaries', (type) => {
    const payload = type === 'run' ? { kind: 'checkpoint_pause' } : { status: 'complete' }
    const event = {
      ...BASE_ENVELOPE,
      type,
      payload: { ...payload, activityReceipt: { emitterId: 'owner', sequence: 12 } },
    }
    expect(parsePersistedStreamEventEnvelope(event)).toEqual({ ok: true, event })
    for (const activityReceipt of [
      null,
      {},
      { emitterId: '', sequence: 1 },
      { emitterId: 'x'.repeat(129), sequence: 1 },
      { emitterId: 'owner', sequence: -1 },
      { emitterId: 'owner', sequence: 1.5 },
      { emitterId: 'owner', sequence: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      expect(
        parsePersistedStreamEventEnvelope({ ...event, payload: { ...payload, activityReceipt } }).ok
      ).toBe(false)
    }
  })

  it('validates the read-only tool replay marker', () => {
    const event = {
      ...BASE_ENVELOPE,
      type: 'tool',
      payload: {
        phase: 'call',
        toolCallId: 'saved',
        toolName: 'sim_cli',
        executor: 'go',
        mode: 'sync',
        replay: true,
      },
    }
    expect(parsePersistedStreamEventEnvelope(event)).toEqual({ ok: true, event })
    for (const replay of [false, 'true', 1, null]) {
      expect(
        parsePersistedStreamEventEnvelope({ ...event, payload: { ...event.payload, replay } }).ok
      ).toBe(false)
    }
  })

  it('accepts contract span events', () => {
    const event = {
      ...BASE_ENVELOPE,
      type: 'span' as const,
      payload: {
        kind: 'subagent' as const,
        event: 'start' as const,
        agent: 'file',
      },
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

  it('rejects a resource event whose id names nothing', () => {
    for (const id of ['', '   ']) {
      const event = {
        ...BASE_ENVELOPE,
        type: 'resource' as const,
        payload: { op: 'upsert' as const, resource: { id, type: 'file', title: 'test.md' } },
      }

      expect(isContractStreamEventEnvelope(event)).toBe(false)
      expect(parsePersistedStreamEventEnvelope(event).ok).toBe(false)
    }
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
        toolName: 'prepare_file_edit' as const,
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
