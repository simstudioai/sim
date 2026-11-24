/**
 * @vitest-environment node
 */
import { getMockLogger } from '@sim/testing/mocks/logger.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parsePersistedStreamEventEnvelope } from '@/lib/mothership/request/session/contract'
import { parseIngestedStreamEventEnvelope } from '@/lib/mothership/request/session/contract-shadow'

const { recordStreamContractDisagreement } = vi.hoisted(() => ({
  recordStreamContractDisagreement: vi.fn(),
}))
vi.mock('@/lib/mothership/request/metrics', () => ({ recordStreamContractDisagreement }))

const logger = getMockLogger('StreamContractShadow')

const shell = {
  v: 1,
  seq: 7,
  ts: '2026-11-23T00:00:00.000Z',
  stream: { streamId: 'stream-1', chatId: 'chat-1' },
  trace: { requestId: 'req-1' },
}
const toolCall = {
  phase: 'call',
  toolCallId: 'tool-1',
  toolName: 'sim_cli',
  executor: 'sim',
  mode: 'async',
  status: 'executing',
  arguments: { argv: ['tables', 'list'] },
  deadlineMs: 600_000,
}
const toolResult = {
  phase: 'result',
  toolCallId: 'tool-1',
  toolName: 'sim_cli',
  executor: 'sim',
  mode: 'async',
  success: true,
}
const argsDelta = { phase: 'args_delta', toolCallId: 'tool-1', toolName: 'sim_cli' }
const spanStart = { kind: 'subagent', event: 'start', agent: 'research' }
const checkpoint = {
  kind: 'checkpoint_pause',
  checkpointId: 'ckpt-1',
  executionId: 'exec-1',
  runId: 'run-1',
  pendingToolCallIds: ['tool-1'],
}
const complete = { status: 'complete', usage: { input_tokens: 12, output_tokens: 3 } }

const frame = (type: string, payload: Record<string, unknown>, extra: object = {}) => ({
  ...shell,
  ...extra,
  type,
  payload,
})

/**
 * A representative set of frames the stream validator accepts today that the contract schema
 * rejects, one per kind of gap (missing or mistyped field, unknown enum value, the `error`-only
 * alias), not an exhaustive list. Each row names the issue path the schema reports.
 */
const SCHEMA_ONLY_REJECTS: Array<[string, Record<string, unknown>, string, string]> = [
  [
    'args_delta without argumentsDelta',
    frame('tool', argsDelta),
    'args_delta',
    'payload.argumentsDelta',
  ],
  [
    'args_delta with a numeric argumentsDelta',
    frame('tool', { ...argsDelta, argumentsDelta: 42 }),
    'args_delta',
    'payload.argumentsDelta',
  ],
  [
    'tool call without executor or mode',
    frame('tool', { ...toolCall, executor: undefined, mode: undefined }),
    'call',
    'payload.executor',
  ],
  [
    'tool call with string arguments',
    frame('tool', { ...toolCall, arguments: 'str' }),
    'call',
    'payload.arguments',
  ],
  [
    'tool call with a string deadlineMs',
    frame('tool', { ...toolCall, deadlineMs: 'soon' }),
    'call',
    'payload.deadlineMs',
  ],
  [
    'tool call with an unknown status',
    frame('tool', { ...toolCall, status: 'bogus' }),
    'call',
    'payload.status',
  ],
  [
    'tool result without success',
    frame('tool', { ...toolResult, success: undefined }),
    'result',
    'payload.success',
  ],
  [
    'span with an unknown event',
    frame('span', { ...spanStart, event: 'middle' }),
    'subagent',
    'payload.event',
  ],
  ['span with string data', frame('span', { ...spanStart, data: 'x' }), 'subagent', 'payload.data'],
  [
    'checkpoint_pause without checkpointId',
    frame('run', { ...checkpoint, checkpointId: undefined }),
    'checkpoint_pause',
    'payload.checkpointId',
  ],
  [
    'checkpoint_pause with string pendingToolCallIds',
    frame('run', { ...checkpoint, pendingToolCallIds: 'tool-1' }),
    'checkpoint_pause',
    'payload.pendingToolCallIds',
  ],
  [
    'steering_applied without steeringId',
    frame('run', { kind: 'steering_applied', eventSeq: 3 }),
    'steering_applied',
    'payload.steeringId',
  ],
  [
    'complete with an unknown status',
    frame('complete', { ...complete, status: 'done' }),
    'none',
    'payload.status',
  ],
  [
    'complete with string usage tokens',
    frame('complete', { ...complete, usage: { input_tokens: '12' } }),
    'none',
    'payload.usage.input_tokens',
  ],
  [
    'error carrying only the `error` alias',
    frame('error', { error: 'boom' }),
    'none',
    'payload.message',
  ],
  [
    'session start with string data',
    frame('session', { kind: 'start', data: 'x' }),
    'start',
    'payload.data',
  ],
  [
    'scope with a numeric spanId',
    frame(
      'text',
      { channel: 'assistant', text: 'hi' },
      { scope: { lane: 'subagent', agentId: 'research', spanId: 7 } }
    ),
    'none',
    'scope.spanId',
  ],
]

let clock = Date.UTC(2026, 10, 23)

describe('parseIngestedStreamEventEnvelope', () => {
  beforeEach(() => {
    // Each test starts past the previous one's log window, so no test sees another's dedupe.
    vi.useFakeTimers()
    clock += 24 * 60 * 60 * 1000
    vi.setSystemTime(clock)
  })

  it.each(SCHEMA_ONLY_REJECTS)(
    'keeps accepting %s and reports the schema rejecting it',
    (_name, value, variant, path) => {
      const result = parseIngestedStreamEventEnvelope(value)

      expect(result).toEqual(parsePersistedStreamEventEnvelope(value))
      expect(result.ok && result.event).toBe(value)
      expect(recordStreamContractDisagreement).toHaveBeenCalledExactlyOnceWith(
        'schema_rejects',
        value.type,
        variant
      )
      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
        'Stream contract schema disagrees with the stream validator',
        expect.objectContaining({
          direction: 'schema_rejects',
          eventType: value.type,
          issues: expect.arrayContaining([expect.stringMatching(new RegExp(`^${path}: `))]),
        })
      )
    }
  )

  it('keeps a rejection the schema would accept and reports it', () => {
    // The validator rejects a null activityReceipt; the schema does not declare the key and
    // strips it. This fails by design once the two are aligned: then pick another real split.
    const value = frame('run', { kind: 'compaction_start', activityReceipt: null })
    const result = parseIngestedStreamEventEnvelope(value)

    expect(result.ok).toBe(false)
    expect(result).toEqual(parsePersistedStreamEventEnvelope(value))
    expect(recordStreamContractDisagreement).toHaveBeenCalledExactlyOnceWith(
      'schema_accepts',
      'run',
      'compaction_start'
    )
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      'Stream contract schema disagrees with the stream validator',
      expect.objectContaining({
        direction: 'schema_accepts',
        eventType: 'run',
        variant: 'compaction_start',
      })
    )
  })

  it('reports nothing when both accept or both reject', () => {
    const accepted = frame('tool', toolCall)
    expect(parseIngestedStreamEventEnvelope(accepted)).toEqual({ ok: true, event: accepted })
    expect(parseIngestedStreamEventEnvelope(frame('nope', { kind: 'start' })).ok).toBe(false)
    expect(
      parseIngestedStreamEventEnvelope(frame('run', { kind: 'replay_end', reason: 'cap' })).ok
    ).toBe(false)

    expect(recordStreamContractDisagreement).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('skips Sim synthetic file-preview frames, which are outside the contract', () => {
    const preview = frame('tool', {
      previewPhase: 'file_preview_start',
      toolCallId: 'tool-1',
      toolName: 'prepare_file_edit',
    })
    expect(parseIngestedStreamEventEnvelope(preview).ok).toBe(true)
    expect(recordStreamContractDisagreement).not.toHaveBeenCalled()
  })

  it('still compares a worker frame that carries a stray previewPhase', () => {
    // Shaped to pass the synthetic check too, but the contract check accepts it first.
    const stray = frame('tool', {
      phase: 'call',
      previewPhase: 'file_preview_start',
      toolCallId: 'tool-stray',
      toolName: 'prepare_file_edit',
    })
    expect(parseIngestedStreamEventEnvelope(stray)).toEqual({ ok: true, event: stray })
    expect(recordStreamContractDisagreement).toHaveBeenCalledExactlyOnceWith(
      'schema_rejects',
      'tool',
      'call'
    )
  })

  it('logs a repeated disagreement once per window but counts every frame', () => {
    const value = frame('complete', { status: 'complete', usage: { output_tokens: 'many' } })

    for (let i = 0; i < 3; i++) parseIngestedStreamEventEnvelope(value)
    expect(recordStreamContractDisagreement).toHaveBeenCalledTimes(3)
    expect(logger.warn).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(10 * 60 * 1000 + 1)
    parseIngestedStreamEventEnvelope(value)
    expect(recordStreamContractDisagreement).toHaveBeenCalledTimes(4)
    expect(logger.warn).toHaveBeenCalledTimes(2)
    expect(logger.warn).toHaveBeenLastCalledWith(
      'Stream contract schema disagrees with the stream validator',
      expect.objectContaining({ suppressedSinceLastLog: 2 })
    )
  })

  it('rate-limits the warning when the shadow check itself keeps failing', () => {
    recordStreamContractDisagreement.mockImplementation(() => {
      throw new Error('meter unavailable')
    })
    const value = frame('tool', { ...argsDelta, argumentsDelta: 7, toolCallId: 'tool-meter' })

    for (let i = 0; i < 3; i++) expect(parseIngestedStreamEventEnvelope(value).ok).toBe(true)
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith('Stream contract shadow check failed', {
      error: 'meter unavailable',
    })
  })
})
