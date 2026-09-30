/**
 * Failure modes of stream compaction, each a way a compacted replay frame would
 * break the UI, restore, or the byte budget:
 * - a bulky string survives, so the frame stays unpersistable;
 * - a structured field the UI reads (exit code, resources, citations, cancel
 *   reason, activity) is truncated or dropped;
 * - a whole `output` or `arguments` object is replaced, changing the shape the
 *   UI reads;
 * - arguments the browser executes from, a file preview, or a one-time API key
 *   are altered;
 * - many medium strings keep the frame over budget;
 * - split assistant text no longer concatenates to the original receipt;
 * - the caller's event is mutated, so dispatch sees the compacted copy.
 */
import { toRecord } from '@sim/utils/object'
import { describe, expect, it } from 'vitest'
import {
  isOmittedStreamValue,
  STREAM_TRUNCATION_KEY,
  type StreamTruncationMarker,
} from '@/lib/mothership/request/session/omission'
import {
  compactStreamEventForReplay,
  STREAM_EVENT_COMPACTION_THRESHOLD_BYTES,
  STREAM_SHORT_STRING_PREVIEW_UNITS,
  STREAM_STRING_PREVIEW_UNITS,
} from '@/lib/mothership/request/session/replay-compaction'
import type { StreamEvent } from '@/lib/mothership/request/session/types'

const MB = 1024 * 1024

function payloadOf(event: StreamEvent): Record<string, unknown> {
  return toRecord(event.payload)
}

function payloadBytes(event: StreamEvent): number {
  return Buffer.byteLength(JSON.stringify(event.payload))
}

function marker(event: StreamEvent): StreamTruncationMarker {
  return payloadOf(event)[STREAM_TRUNCATION_KEY] as StreamTruncationMarker
}

describe('compactStreamEventForReplay', () => {
  it('truncates only the bulky strings of a Sim tool result and keeps its structured fields', () => {
    const citations = [{ index: 1, title: 'Runbook', url: 'https://docs.example/runbook' }]
    const observations = [{ kind: 'image', mediaType: 'image/png', name: 'chart.png' }]
    const event: StreamEvent = {
      type: 'tool',
      payload: {
        toolCallId: 'call-1',
        toolName: 'run_code',
        executor: 'sim',
        mode: 'async',
        phase: 'result',
        success: true,
        status: 'success',
        output: {
          stdout: 'o'.repeat(2 * MB),
          stderr: 'e'.repeat(300 * 1024),
          exitCode: 0,
          resources: [{ type: 'file', id: 'file-1', title: 'out.csv' }],
          sinkError: 'sink unavailable',
          observations,
          citations,
        },
      },
    }

    const [compacted] = compactStreamEventForReplay(event)
    const output = payloadOf(compacted).output as Record<string, unknown>

    expect(payloadBytes(compacted)).toBeLessThanOrEqual(STREAM_EVENT_COMPACTION_THRESHOLD_BYTES)
    expect(output.stdout).toBe('o'.repeat(STREAM_STRING_PREVIEW_UNITS))
    expect(output.stderr).toBe('e'.repeat(STREAM_STRING_PREVIEW_UNITS))
    expect(output.exitCode).toBe(0)
    expect(output.resources).toEqual([{ type: 'file', id: 'file-1', title: 'out.csv' }])
    expect(output.sinkError).toBe('sink unavailable')
    expect(output.observations).toEqual(observations)
    expect(output.citations).toEqual(citations)
    expect(marker(compacted).fields).toEqual([
      { path: '/output/stdout', bytes: 2 * MB, previewBytes: STREAM_STRING_PREVIEW_UNITS },
      { path: '/output/stderr', bytes: 300 * 1024, previewBytes: STREAM_STRING_PREVIEW_UNITS },
    ])
    expect(payloadOf(compacted)).toMatchObject({
      toolCallId: 'call-1',
      toolName: 'run_code',
      phase: 'result',
      success: true,
      status: 'success',
    })
  })

  it('keeps retrieval result metadata and cuts each result to a short preview when many medium strings remain', () => {
    const results = Array.from({ length: 80 }, (_, index) => ({
      id: `doc-${index}`,
      title: `Document ${index}`,
      url: `https://docs.example/${index}`,
      score: 0.5,
      content: 'c'.repeat(6 * 1024),
    }))
    const event: StreamEvent = {
      type: 'tool',
      payload: {
        toolCallId: 'call-2',
        toolName: 'search_documentation',
        executor: 'go',
        mode: 'sync',
        phase: 'result',
        success: true,
        output: { data: { results } },
      },
    }

    const [compacted] = compactStreamEventForReplay(event)
    const kept = (
      (payloadOf(compacted).output as Record<string, unknown>).data as {
        results: Array<Record<string, unknown>>
      }
    ).results

    expect(payloadBytes(compacted)).toBeLessThanOrEqual(STREAM_EVENT_COMPACTION_THRESHOLD_BYTES)
    expect(kept).toHaveLength(80)
    expect(kept[79]).toEqual({
      id: 'doc-79',
      title: 'Document 79',
      url: 'https://docs.example/79',
      score: 0.5,
      content: 'c'.repeat(STREAM_SHORT_STRING_PREVIEW_UNITS),
    })
  })

  it('omits a subtree only as a last resort, keeping the arguments object and the keys the UI reads', () => {
    const rows = Array.from({ length: 40_000 }, (_, index) => ({ id: index, name: 'row' }))
    const event: StreamEvent = {
      type: 'tool',
      payload: {
        toolCallId: 'call-3',
        toolName: 'cli_tables_rows_query',
        executor: 'sim',
        mode: 'async',
        phase: 'call',
        arguments: {
          activity: { id: 'a-1', title: 'Querying rows' },
          operation: 'query',
          description: 'd'.repeat(10_000),
          format: 'json',
          rows,
        },
      },
    }

    const [compacted] = compactStreamEventForReplay(event)
    const args = payloadOf(compacted).arguments as Record<string, unknown>

    expect(payloadBytes(compacted)).toBeLessThanOrEqual(STREAM_EVENT_COMPACTION_THRESHOLD_BYTES)
    expect(args.activity).toEqual({ id: 'a-1', title: 'Querying rows' })
    expect(args.operation).toBe('query')
    expect(args.description).toBe('d'.repeat(10_000))
    expect(args.format).toBe('json')
    expect(isOmittedStreamValue(args.rows)).toBe(true)
    expect(marker(compacted).fields).toEqual([
      { path: '/arguments/rows', bytes: Buffer.byteLength(JSON.stringify(rows)) },
    ])
  })

  it.each([
    ['a client-executable workflow tool', 'run_workflow', 'sim'],
    ['a client-executed tool', 'custom_client_tool', 'client'],
    ['a user-local VFS read', 'read', 'go'],
    ['a terminal command', 'terminal', 'go'],
  ])('leaves the arguments of %s whole', (_label, toolName, executor) => {
    const args = {
      path: 'user-local/notes.md',
      operation: 'run',
      input: { body: 'b'.repeat(400 * 1024) },
    }
    const event = {
      type: 'tool',
      payload: {
        toolCallId: 'call-4',
        toolName,
        executor,
        mode: 'async',
        phase: 'call',
        arguments: args,
      },
    } as StreamEvent

    const [compacted] = compactStreamEventForReplay(event)

    expect(JSON.stringify(payloadOf(compacted).arguments)).toBe(JSON.stringify(args))
  })

  it('never compacts a file preview or a generated API key', () => {
    const preview: StreamEvent = {
      type: 'tool',
      payload: {
        toolCallId: 'call-5',
        toolName: 'prepare_file_edit',
        previewPhase: 'file_preview_content',
        content: 'p'.repeat(400 * 1024),
        contentMode: 'snapshot',
        previewVersion: 3,
        fileName: 'notes.md',
      },
    }
    const apiKey: StreamEvent = {
      type: 'tool',
      payload: {
        toolCallId: 'call-6',
        toolName: 'generate_api_key',
        executor: 'sim',
        mode: 'async',
        phase: 'result',
        success: true,
        output: { key: 'k'.repeat(400 * 1024) },
      },
    }

    expect(compactStreamEventForReplay(preview)).toEqual([preview])
    expect(compactStreamEventForReplay(apiKey)).toEqual([apiKey])
  })

  it('splits oversized assistant text into contiguous events that reassemble exactly', () => {
    const text = `${'a'.repeat(300 * 1024)}😀${'b'.repeat(300 * 1024)}`
    const event: StreamEvent = {
      type: 'text',
      payload: { channel: 'assistant', text, textOffset: 17 },
    }

    const pieces = compactStreamEventForReplay(event)

    expect(pieces.length).toBeGreaterThan(1)
    expect(pieces.map((piece) => payloadOf(piece).text).join('')).toBe(text)
    let offset = 17
    for (const piece of pieces) {
      expect(payloadOf(piece).textOffset).toBe(offset)
      expect(payloadBytes(piece)).toBeLessThanOrEqual(STREAM_EVENT_COMPACTION_THRESHOLD_BYTES)
      offset += (payloadOf(piece).text as string).length
    }
  })

  it('compacts a copy and leaves the caller’s event whole for dispatch', () => {
    const stdout = 's'.repeat(MB)
    const event: StreamEvent = {
      type: 'tool',
      payload: {
        toolCallId: 'call-7',
        toolName: 'cli_logs_get',
        executor: 'sim',
        mode: 'async',
        phase: 'call',
        arguments: { stdout },
      },
    }

    compactStreamEventForReplay(event)

    expect((payloadOf(event).arguments as Record<string, unknown>).stdout).toBe(stdout)
    expect(STREAM_TRUNCATION_KEY in payloadOf(event)).toBe(false)
  })
})
