/**
 * Failure modes of stream compaction, each a way a compacted replay frame would
 * break the UI, restore, or the byte budget:
 * - a bulky string survives, so the frame stays unpersistable;
 * - a field the UI reads (exit code, resources, citations, cancel reason,
 *   activity, identity) is cut or dropped, or an object changes shape;
 * - arguments the browser executes from, a file preview, or a one-time API key
 *   are altered;
 * - the caller's event is mutated, so dispatch sees the compacted copy;
 * - a cut splits a surrogate pair into invalid text.
 */
import { toRecord } from '@sim/utils/object'
import { describe, expect, it } from 'vitest'
import {
  compactStreamEvent,
  STREAM_EVENT_COMPACTION_THRESHOLD_BYTES,
  STREAM_EVENT_MAX_PAYLOAD_BYTES,
  STREAM_STRING_PREVIEW_UNITS,
  serializedBytes,
} from '@/lib/mothership/request/session/replay-compaction'
import type { StreamEvent } from '@/lib/mothership/request/session/types'

const MB = 1024 * 1024

function payloadOf(event: StreamEvent): Record<string, unknown> {
  return toRecord(event.payload)
}

describe('compactStreamEvent', () => {
  it('cuts only the bulky strings of a tool result and keeps every other field and shape', () => {
    const citations = [{ index: 1, title: 'Runbook', url: 'https://docs.example/runbook' }]
    const resources = [{ type: 'file', id: 'file-1', title: 'out.csv' }]
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
          resources,
          citations,
          reason: 'user_cancelled',
        },
      },
    }

    const compacted = compactStreamEvent(event)
    const output = toRecord(payloadOf(compacted).output)

    expect(Buffer.byteLength(JSON.stringify(compacted.payload))).toBeLessThan(
      STREAM_EVENT_COMPACTION_THRESHOLD_BYTES
    )
    expect(output.stdout).toBe(`${'o'.repeat(STREAM_STRING_PREVIEW_UNITS)}…[truncated, 2 MB total]`)
    expect(output.stderr).toBe(
      `${'e'.repeat(STREAM_STRING_PREVIEW_UNITS)}…[truncated, 300 KB total]`
    )
    expect(output).toMatchObject({ exitCode: 0, resources, citations, reason: 'user_cancelled' })
    expect(Object.keys(output)).toEqual(Object.keys(toRecord(payloadOf(event).output)))
    expect(payloadOf(compacted)).toMatchObject({
      toolCallId: 'call-1',
      toolName: 'run_code',
      phase: 'result',
      success: true,
      status: 'success',
    })
  })

  it('cuts long text even under keys the UI reads, keeping its head', () => {
    const rows = Array.from({ length: 3 }, (_, index) => ({
      id: `row-${index}`,
      description: `row ${index} ${'d'.repeat(700 * 1024)}`,
    }))
    const event: StreamEvent = {
      type: 'tool',
      payload: {
        toolCallId: 'c',
        toolName: 'cli_tables_rows_query',
        executor: 'sim',
        mode: 'async',
        phase: 'result',
        success: false,
        status: 'error',
        error: `Query failed: ${'e'.repeat(2 * MB)}`,
        output: { error: `Query failed: ${'e'.repeat(2 * MB)}`, rows },
      },
    }

    const compacted = payloadOf(compactStreamEvent(event))
    const output = toRecord(compacted.output)

    expect(Buffer.byteLength(JSON.stringify(compacted))).toBeLessThan(
      STREAM_EVENT_COMPACTION_THRESHOLD_BYTES
    )
    expect(compacted.error).toMatch(/^Query failed: e+…\[truncated, 2 MB total\]$/)
    expect(output.error).toMatch(/^Query failed: e+…\[truncated, 2 MB total\]$/)
    expect((output.rows as Array<{ id: string; description: string }>)[2]).toEqual({
      id: 'row-2',
      description: `row 2 ${'d'.repeat(STREAM_STRING_PREVIEW_UNITS - 6)}…[truncated, 700 KB total]`,
    })
  })

  it.each([
    ['a workflow run', 'run_workflow', { workflowId: 'wf-1' }],
    ['a user-local VFS read', 'read', { path: 'user-local/notes.md' }],
    ['a terminal command', 'terminal', { operation: 'run' }],
    ['a browser action', 'browser_click', { elementId: 'e-1' }],
  ])('leaves the arguments of %s whole', (_label, toolName, identity) => {
    const args = { ...identity, input: 'b'.repeat(400 * 1024) }
    const event = {
      type: 'tool',
      payload: {
        toolCallId: 'c',
        toolName,
        executor: 'go',
        mode: 'async',
        phase: 'call',
        arguments: args,
      },
    } as StreamEvent

    expect(compactStreamEvent(event)).toBe(event)
  })

  it('cuts the arguments of a call the browser does not execute', () => {
    const event: StreamEvent = {
      type: 'tool',
      payload: {
        toolCallId: 'c',
        toolName: 'sim_cli',
        executor: 'go',
        mode: 'async',
        phase: 'call',
        arguments: { activity: { id: 'a', title: 'Reading logs' }, stdin: 'x'.repeat(MB) },
      },
    }

    const args = toRecord(payloadOf(compactStreamEvent(event)).arguments)

    expect(args.activity).toEqual({ id: 'a', title: 'Reading logs' })
    expect(args.stdin).toBe(`${'x'.repeat(STREAM_STRING_PREVIEW_UNITS)}…[truncated, 1 MB total]`)
  })

  it('never compacts preview content, which the client applies as exact deltas', () => {
    const preview: StreamEvent = {
      type: 'tool',
      payload: {
        toolCallId: 'c',
        toolName: 'prepare_file_edit',
        previewPhase: 'file_preview_content',
        content: 'p'.repeat(400 * 1024),
        contentMode: 'snapshot',
        previewVersion: 3,
        fileName: 'notes.md',
      },
    }

    expect(compactStreamEvent(preview)).toBe(preview)
  })

  it('bounds a preview edit whose model-written search text is past one replay write', () => {
    const meta: StreamEvent = {
      type: 'tool',
      payload: {
        toolCallId: 'c',
        toolName: 'prepare_file_edit',
        previewPhase: 'file_preview_edit_meta',
        edit: { strategy: 'search_replace', search: 's'.repeat(2 * MB), replaceAll: false },
      },
    }

    const payload = payloadOf(compactStreamEvent(meta))
    const edit = toRecord(payload.edit)

    expect(serializedBytes(payload)).toBeLessThanOrEqual(STREAM_EVENT_MAX_PAYLOAD_BYTES)
    expect(payload.previewPhase).toBe('file_preview_edit_meta')
    expect(edit.strategy).toBe('search_replace')
    expect(edit.replaceAll).toBe(false)
    expect(edit.search).toBe(`${'s'.repeat(STREAM_STRING_PREVIEW_UNITS)}…[truncated, 2 MB total]`)
  })

  it('compacts a copy and leaves the caller’s event whole for dispatch', () => {
    const stdout = 's'.repeat(MB)
    const event: StreamEvent = {
      type: 'tool',
      payload: {
        toolCallId: 'c',
        toolName: 'cli_logs_get',
        executor: 'sim',
        mode: 'async',
        phase: 'call',
        arguments: { stdout },
      },
    }

    expect(compactStreamEvent(event)).not.toBe(event)
    expect(toRecord(payloadOf(event).arguments).stdout).toBe(stdout)
  })

  it('does not split a surrogate pair at the cut', () => {
    const text = `${'a'.repeat(STREAM_STRING_PREVIEW_UNITS - 1)}😀${'b'.repeat(MB)}`
    const event: StreamEvent = {
      type: 'tool',
      payload: {
        toolCallId: 'c',
        toolName: 'cli_logs_get',
        executor: 'sim',
        mode: 'async',
        phase: 'result',
        success: true,
        output: { text },
      },
    }

    const cut = toRecord(payloadOf(compactStreamEvent(event)).output).text as string

    expect(cut.startsWith(`${'a'.repeat(STREAM_STRING_PREVIEW_UNITS - 1)}…`)).toBe(true)
  })

  it('never cuts assistant text, whose length is part of the text receipt', () => {
    const event: StreamEvent = {
      type: 'text',
      payload: { channel: 'assistant', text: 'a'.repeat(MB), textOffset: 0 },
    }

    expect(compactStreamEvent(event)).toBe(event)
  })

  it('keeps the head of a long array of short items when strings alone cannot bound it', () => {
    const rows = Array.from({ length: 40_000 }, (_, index) => ({ id: index, name: 'row' }))
    const citations = [{ index: 1, title: 'Runbook', url: 'https://docs.example/runbook' }]
    const event: StreamEvent = {
      type: 'tool',
      payload: {
        toolCallId: 'c',
        toolName: 'cli_tables_rows_query',
        executor: 'sim',
        mode: 'async',
        phase: 'result',
        success: true,
        output: { rows, data: { results: citations } },
      },
    }

    const compacted = compactStreamEvent(event)
    const output = toRecord(payloadOf(compacted).output)
    const kept = output.rows as unknown[]

    expect(Buffer.byteLength(JSON.stringify(compacted.payload))).toBeLessThan(
      STREAM_EVENT_COMPACTION_THRESHOLD_BYTES
    )
    expect(kept.slice(0, 2)).toEqual([rows[0], rows[1]])
    expect(kept.at(-1)).toMatch(/^…\[truncated, \d+ more items\]$/)
    expect(output.data).toEqual({ results: citations })
    expect(toRecord(payloadOf(event).output).rows).toHaveLength(40_000)
  })

  it('omits the largest remaining field when cuts alone leave the event over one replay write', () => {
    const blocks = Object.fromEntries(
      Array.from({ length: 5_000 }, (_, index) => [`block-${index}`, 'b'.repeat(300)])
    )
    const event: StreamEvent = {
      type: 'tool',
      payload: {
        toolCallId: 'c',
        toolName: 'cli_workflows_state_get',
        executor: 'sim',
        mode: 'async',
        phase: 'result',
        success: true,
        status: 'success',
        output: { blocks },
      },
    }

    const compacted = payloadOf(compactStreamEvent(event))

    expect(Buffer.byteLength(JSON.stringify(compacted))).toBeLessThanOrEqual(
      STREAM_EVENT_MAX_PAYLOAD_BYTES
    )
    expect(toRecord(compacted.output).blocks).toMatch(/^…\[omitted, [\d.]+ MB total\]$/)
    expect(compacted).toMatchObject({ toolCallId: 'c', success: true, status: 'success' })
  })

  it('omits only the bulk inside an output, keeping the ids and resources the UI reads', () => {
    const blocks = Object.fromEntries(
      Array.from({ length: 5_000 }, (_, index) => [`block-${index}`, 'b'.repeat(300)])
    )
    const resources = [{ type: 'workflow', id: 'wf-1', title: 'Pipeline' }]
    const event: StreamEvent = {
      type: 'tool',
      payload: {
        toolCallId: 'c',
        toolName: 'cli_workflows_state_get',
        executor: 'sim',
        mode: 'async',
        phase: 'result',
        success: true,
        status: 'success',
        output: { workflowId: 'wf-1', resources, data: { id: 'wf-1', name: 'Pipeline', blocks } },
      },
    }

    const output = toRecord(payloadOf(compactStreamEvent(event)).output)

    expect(output.workflowId).toBe('wf-1')
    expect(output.resources).toEqual(resources)
    expect(output.data).toEqual({
      id: 'wf-1',
      name: 'Pipeline',
      blocks: expect.stringMatching(/^…\[omitted, [\d.]+ MB total\]$/),
    })
  })

  it('keeps omitting bulk until the event fits when more than one large object remains', () => {
    const manyKeys = (prefix: string, count: number) =>
      Object.fromEntries(
        Array.from({ length: count }, (_, index) => [`${prefix}-${index}`, 'v'.repeat(300)])
      )
    const event: StreamEvent = {
      type: 'tool',
      payload: {
        toolCallId: 'c',
        toolName: 'cli_workflows_state_get',
        executor: 'sim',
        mode: 'async',
        phase: 'result',
        success: true,
        status: 'success',
        output: { workflowId: 'wf-1', a: manyKeys('a', 4_300), b: manyKeys('b', 3_600) },
      },
    }

    const compacted = payloadOf(compactStreamEvent(event))
    const output = toRecord(compacted.output)

    expect(Buffer.byteLength(JSON.stringify(compacted))).toBeLessThanOrEqual(
      STREAM_EVENT_MAX_PAYLOAD_BYTES
    )
    expect(output.workflowId).toBe('wf-1')
    expect(output.a).toMatch(/^…\[omitted, [\d.]+ MB total\]$/)
    expect(output.b).toMatch(/^…\[omitted, [\d.]+ MB total\]$/)
  })

  it('never omits identity to make room for client-executed arguments it must keep whole', () => {
    const args = { workflowId: 'wf-1', input: 'w'.repeat(1.5 * MB) }
    const event: StreamEvent = {
      type: 'tool',
      payload: {
        toolCallId: 'c',
        toolName: 'run_workflow',
        executor: 'client',
        mode: 'async',
        phase: 'call',
        ui: { clientExecutable: true },
        arguments: args,
      },
    }

    expect(compactStreamEvent(event)).toBe(event)
  })

  it('omits only the smallest sufficient bulk when no single child dominates, keeping its siblings', () => {
    const manyKeys = (prefix: string) =>
      Object.fromEntries(
        Array.from({ length: 2_300 }, (_, index) => [`${prefix}-${index}`, 'v'.repeat(300)])
      )
    const event: StreamEvent = {
      type: 'tool',
      payload: {
        toolCallId: 'c',
        toolName: 'cli_tables_rows_query',
        executor: 'sim',
        mode: 'async',
        phase: 'result',
        success: true,
        output: { fileId: 'file-1', rows: manyKeys('r'), cols: manyKeys('c') },
      },
    }

    const compacted = payloadOf(compactStreamEvent(event))
    const output = toRecord(compacted.output)

    expect(Buffer.byteLength(JSON.stringify(compacted))).toBeLessThanOrEqual(
      STREAM_EVENT_MAX_PAYLOAD_BYTES
    )
    expect(output.fileId).toBe('file-1')
    expect([output.rows, output.cols].filter((value) => typeof value === 'string')).toHaveLength(1)
  })

  it('omits the smaller of two bulks when either alone would make the event fit', () => {
    const manyKeys = (prefix: string, count: number) =>
      Object.fromEntries(
        Array.from({ length: count }, (_, index) => [`${prefix}-${index}`, 'v'.repeat(300)])
      )
    const event: StreamEvent = {
      type: 'tool',
      payload: {
        toolCallId: 'c',
        toolName: 'cli_tables_rows_query',
        executor: 'sim',
        mode: 'async',
        phase: 'result',
        success: true,
        output: { fileId: 'file-1', rows: manyKeys('r', 3_000), cols: manyKeys('c', 1_900) },
      },
    }

    const output = toRecord(payloadOf(compactStreamEvent(event)).output)

    expect(output.fileId).toBe('file-1')
    expect(Object.keys(toRecord(output.rows))).toHaveLength(3_000)
    expect(output.cols).toMatch(/^…\[omitted, [\d.]+ KB total\]$/)
  })

  it('omits a sufficient bulk whole when its own large parts cannot cover the overage', () => {
    const manyKeys = (prefix: string, count: number) =>
      Object.fromEntries(
        Array.from({ length: count }, (_, index) => [`${prefix}-${index}`, 'v'.repeat(3_000)])
      )
    const event: StreamEvent = {
      type: 'tool',
      payload: {
        toolCallId: 'c',
        toolName: 'cli_workflows_state_get',
        executor: 'sim',
        mode: 'async',
        phase: 'result',
        success: true,
        output: { workflowId: 'wf-1', state: { nested: manyKeys('n', 35), ...manyKeys('k', 400) } },
      },
    }

    const compacted = payloadOf(compactStreamEvent(event))
    const output = toRecord(compacted.output)

    expect(Buffer.byteLength(JSON.stringify(compacted))).toBeLessThanOrEqual(
      STREAM_EVENT_MAX_PAYLOAD_BYTES
    )
    expect(output.workflowId).toBe('wf-1')
    expect(output.state).toMatch(/^…\[omitted, [\d.]+ MB total\]$/)
  })

  it('bounds a balanced 16 MB tree in one pass', () => {
    const tree = (depth: number, leaf: number): unknown =>
      depth === 0
        ? 'x'.repeat(leaf)
        : { l: tree(depth - 1, leaf + 100), r: tree(depth - 1, Math.max(leaf - 100, 1)) }
    const event: StreamEvent = {
      type: 'tool',
      payload: {
        toolCallId: 'c',
        toolName: 'cli_blocks_get',
        executor: 'sim',
        mode: 'async',
        phase: 'result',
        success: true,
        output: tree(12, 3_900),
      },
    }

    const started = performance.now()
    const compacted = compactStreamEvent(event)
    const elapsedMs = performance.now() - started

    expect(Buffer.byteLength(JSON.stringify(compacted.payload))).toBeLessThanOrEqual(
      STREAM_EVENT_MAX_PAYLOAD_BYTES
    )
    expect(elapsedMs).toBeLessThan(2_000)
  })

  it('measures serialized size exactly without serializing', () => {
    const values: unknown[] = [
      { a: 'é😀"\\\n', b: [1, null, true, { c: 'd' }], e: undefined, f: -1.5e-7 },
      [undefined, 'x', { 'kéy "q"': 0 }],
      'plain',
      42,
      null,
      {},
      [],
    ]

    for (const value of values) {
      expect(serializedBytes(value)).toBe(Buffer.byteLength(JSON.stringify(value)))
    }
  })
})
