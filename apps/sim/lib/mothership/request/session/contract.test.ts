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

  it('reports invalid JSON separately from schema failures', () => {
    const parsed = parsePersistedStreamEventEnvelopeJson('{')

    expect(parsed.ok).toBe(false)
    if (parsed.ok) {
      throw new Error('expected invalid json result')
    }
    expect(parsed.reason).toBe('invalid_json')
  })
})

describe('resource event view pins', () => {
  it('accepts a table resource pinned to a saved view', () => {
    const event = {
      ...BASE_ENVELOPE,
      type: 'resource' as const,
      payload: {
        op: 'upsert' as const,
        resource: { id: 'tbl-1', type: 'table', title: 'Invoices', viewId: 'view-1' },
      },
    }

    expect(isContractStreamEventEnvelope(event)).toBe(true)
    expect(parsePersistedStreamEventEnvelope(event).ok).toBe(true)
  })

  it('rejects a pin that is not a string', () => {
    const event = {
      ...BASE_ENVELOPE,
      type: 'resource' as const,
      payload: {
        op: 'upsert' as const,
        resource: { id: 'tbl-1', type: 'table', title: 'Invoices', viewId: 42 },
      },
    }

    expect(isContractStreamEventEnvelope(event)).toBe(false)
  })

  it('accepts a canonical pin clear and rejects a non-string view identity', () => {
    const event = {
      ...BASE_ENVELOPE,
      type: 'resource' as const,
      payload: {
        op: 'clear_view' as const,
        resource: { id: 'tbl-1', type: 'table', viewId: 'view-1' },
      },
    }

    expect(isContractStreamEventEnvelope(event)).toBe(true)
    expect(parsePersistedStreamEventEnvelope(event).ok).toBe(true)
    expect(
      isContractStreamEventEnvelope({
        ...event,
        payload: { ...event.payload, resource: { ...event.payload.resource, viewId: true } },
      })
    ).toBe(false)
  })
})
