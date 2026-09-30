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
  STREAM_STRING_PREVIEW_UNITS,
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
          reason: 'r'.repeat(20_000),
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
    expect(output).toMatchObject({ exitCode: 0, resources, citations, reason: 'r'.repeat(20_000) })
    expect(Object.keys(output)).toEqual(Object.keys(toRecord(payloadOf(event).output)))
    expect(payloadOf(compacted)).toMatchObject({
      toolCallId: 'call-1',
      toolName: 'run_code',
      phase: 'result',
      success: true,
      status: 'success',
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

  it('never compacts a file preview or a generated API key', () => {
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
    const apiKey: StreamEvent = {
      type: 'tool',
      payload: {
        toolCallId: 'c',
        toolName: 'generate_api_key',
        executor: 'sim',
        mode: 'async',
        phase: 'result',
        success: true,
        output: { key: 'k'.repeat(400 * 1024) },
      },
    }

    expect(compactStreamEvent(preview)).toBe(preview)
    expect(compactStreamEvent(apiKey)).toBe(apiKey)
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
})
