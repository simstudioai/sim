/**
 * @vitest-environment node
 *
 * The delivery decisions of a chat's outgoing messages, with no hook around them.
 * Failure modes: a send steers its own turn, or another one while it may be a turn
 * itself (the model reads it twice); a message not delivered blocks every later
 * send; a message overtakes one that may yet be applied; a closed tab's message
 * goes out as a billed turn days later; a re-marked row is adopted again; a turn
 * that applied the only message on it counts as having more to do; a message goes
 * out on its own after an errored turn; bookkeeping is lost across a reload, so a
 * restored message that may be a turn steers.
 */
import { describe, expect, it } from 'vitest'
import {
  admittedMessageIds,
  adoptOrphanRow,
  afterDispositionRead,
  afterRetry,
  afterUnsentAttempt,
  deliveryOf,
  fromJournaled,
  hasOutgoingFollowUp,
  holdAfterErroredTurn,
  MAX_OUTGOING_DELIVERY_ATTEMPTS,
  nextOutgoingStep,
  ORPHAN_AUTO_SEND_MAX_AGE_MS,
  type OutgoingMessage,
  orphanSteeringRows,
  toJournaled,
} from '@/app/workspace/[workspaceId]/home/hooks/outgoing-state'
import type { MothershipChatHistory } from '@/hooks/queries/mothership-chats'

const NOW = 1_800_000_000_000

function entry(id: string, patch: Partial<OutgoingMessage> = {}): OutgoingMessage {
  return {
    id,
    chatKey: 'chat',
    payload: { content: id },
    display: { id, role: 'user', content: id },
    status: 'pending',
    attempts: 0,
    ...patch,
  }
}

const view = (patch: Partial<{ liveStreamId: string; admittedIds: ReadonlySet<string> }> = {}) => ({
  liveStreamId: undefined,
  admittedIds: new Set<string>(),
  now: NOW,
  ...patch,
})

function history(messages: MothershipChatHistory['messages']): MothershipChatHistory {
  return { id: 'chat', mode: 'agent', title: 'Chat', messages, activeStreamId: null, resources: [] }
}

const row = (
  id: string,
  patch: Partial<MothershipChatHistory['messages'][number]> = {}
): MothershipChatHistory['messages'][number] => ({
  id,
  role: 'user',
  content: 'Hello',
  timestamp: new Date(NOW).toISOString(),
  ...patch,
})

describe('nextOutgoingStep', () => {
  it('drops a message that is the running turn, rather than steering it into itself', () => {
    expect(nextOutgoingStep([entry('a')], view({ liveStreamId: 'a' })).kind).toBe('drop')
  })

  it('drops a message the chat already holds as a turn, past any retry delay', () => {
    const message = entry('a', { notBefore: NOW + 60_000 })
    expect(nextOutgoingStep([message], view({ admittedIds: new Set(['a']) })).kind).toBe('drop')
  })

  it('never steers a message that may already be a turn', () => {
    const message = entry('a', { unconfirmed: true })
    expect(nextOutgoingStep([message], view({ liveStreamId: 'turn' })).kind).toBe('idle')
    expect(nextOutgoingStep([message], view()).kind).toBe('send')
  })

  it('does not let a message not delivered hold back one written after it', () => {
    const failed = entry('a', { status: 'failed', streamId: 'turn' })
    expect(nextOutgoingStep([failed, entry('b')], view())).toMatchObject({
      kind: 'send',
      message: { id: 'b' },
    })
  })

  it('holds a message behind one on its way out or still being settled', () => {
    for (const status of ['sending', 'steering', 'steered'] as const) {
      expect(nextOutgoingStep([entry('a', { status }), entry('b')], view()).kind).toBe('idle')
    }
  })

  it('does not overtake a steer with no answer, but follows one the worker took', () => {
    const live = view({ liveStreamId: 'turn' })
    const held = entry('a', { status: 'steered', streamId: 'turn' })
    const unconfirmed = { ...held, unconfirmed: true }
    expect(nextOutgoingStep([unconfirmed, entry('b')], live).kind).toBe('idle')
    expect(nextOutgoingStep([held, entry('b')], live)).toMatchObject({
      kind: 'steer',
      streamId: 'turn',
    })
  })

  it('leaves a message with the turn that refused it, until a different one runs', () => {
    const refused = entry('a', { refusedBy: 'turn' })
    expect(nextOutgoingStep([refused], view({ liveStreamId: 'turn' })).kind).toBe('idle')
    expect(nextOutgoingStep([refused], view({ liveStreamId: 'next' })).kind).toBe('steer')
  })

  it('waits out a retry delay', () => {
    expect(nextOutgoingStep([entry('a', { notBefore: NOW + 1 })], view()).kind).toBe('idle')
    expect(nextOutgoingStep([entry('a', { notBefore: NOW })], view()).kind).toBe('send')
  })
})

describe('admittedMessageIds', () => {
  it("counts a turn's own row and a re-marked one, never a steering record", () => {
    const rows = history([
      row('turn'),
      row('remarked', { steering: { streamId: 'remarked' } }),
      row('steered', { steering: { streamId: 'turn' } }),
      row('answer', { role: 'assistant' }),
    ])
    expect([...admittedMessageIds(rows)]).toEqual(['turn', 'remarked'])
  })
})

describe('orphan steering records', () => {
  const none = new Set<string>()
  const context = { known: none, applied: none, marked: none, liveStreamId: undefined }

  it('skips a re-marked row, and those another path settles', () => {
    const rows = history([
      row('remarked', { steering: { streamId: 'remarked' } }),
      row('known', { steering: { streamId: 'turn' } }),
      row('live', { steering: { streamId: 'running' } }),
      row('orphan', { steering: { streamId: 'turn' } }),
    ])
    const ids = orphanSteeringRows(rows, {
      ...context,
      known: new Set(['known']),
      liveStreamId: 'running',
    }).map((orphan) => orphan.id)
    expect(ids).toEqual(['orphan'])
  })

  it('settles a recent one, and only shows an old one as not delivered', () => {
    const at = (age: number) =>
      row('orphan', {
        timestamp: new Date(NOW - age).toISOString(),
        steering: { streamId: 'turn' },
      })
    const adopt = (age: number) => adoptOrphanRow(at(age), 'chat', NOW)
    expect(adopt(ORPHAN_AUTO_SEND_MAX_AGE_MS - 1).status).toBe('steered')
    expect(adopt(ORPHAN_AUTO_SEND_MAX_AGE_MS).status).toBe('failed')
  })

  it('reads a timestamp it cannot parse as old', () => {
    const adopted = adoptOrphanRow(
      row('orphan', { timestamp: 'never', steering: { streamId: 'turn' } }),
      'chat',
      NOW
    )
    expect(adopted.status).toBe('failed')
  })

  it('keeps the mentions it can send, dropping one it cannot', () => {
    const adopted = adoptOrphanRow(
      row('orphan', {
        steering: { streamId: 'turn' },
        contexts: [
          { kind: 'workflow', label: 'Invoices', workflowId: 'workflow-1' },
          { kind: 'workflow', label: 'Gone' },
        ],
      }),
      'chat',
      NOW
    )
    expect(adopted.payload.contexts).toEqual([
      expect.objectContaining({ label: 'Invoices', workflowId: 'workflow-1' }),
    ])
  })
})

describe('transitions', () => {
  it('marks a send that got no answer as possibly a turn, and gives up at the cap', () => {
    const environment = { online: true, now: NOW }
    expect(afterUnsentAttempt(entry('a'), environment)).toMatchObject({
      status: 'pending',
      unconfirmed: true,
      attempts: 1,
    })
    expect(
      afterUnsentAttempt(entry('a', { attempts: MAX_OUTGOING_DELIVERY_ATTEMPTS - 1 }), environment)
    ).toMatchObject({ status: 'failed', unconfirmed: true })
  })

  it('waits for the browser to come back online rather than timing a retry', () => {
    expect(afterUnsentAttempt(entry('a'), { online: false, now: NOW }).notBefore).toBe(
      Number.POSITIVE_INFINITY
    )
  })

  it('sends on a message its turn did not apply, unless that turn errored', () => {
    const context = { streamId: 'turn', now: NOW }
    const steered = entry('a', { status: 'steered', streamId: 'turn' })
    const notApplied = { status: 'not_applied' } as const
    expect(afterDispositionRead(steered, notApplied, { ...context, turnErrored: false })).toEqual({
      status: 'pending',
      refusedBy: 'turn',
      streamId: undefined,
      unconfirmed: false,
    })
    expect(
      afterDispositionRead(steered, notApplied, { ...context, turnErrored: true }).status
    ).toBe('failed')
  })

  it('reads a held message again later, counting toward the one delivery cap', () => {
    const context = { streamId: 'turn', turnErrored: false, now: NOW }
    const steered = entry('a', { status: 'steered', streamId: 'turn' })
    const later = afterDispositionRead(steered, { status: 'queued' }, context)
    expect(later).toMatchObject({ attempts: 1, unconfirmed: false })
    expect(later.notBefore).toBeGreaterThan(NOW)
    expect(afterDispositionRead(steered, { status: 'unknown' }, context).unconfirmed).toBe(true)
    expect(
      afterDispositionRead(
        { ...steered, attempts: MAX_OUTGOING_DELIVERY_ATTEMPTS - 1 },
        { status: 'queued' },
        context
      ).status
    ).toBe('failed')
  })

  it('reads a steered message again on Retry, and sends one that never reached a turn', () => {
    expect(afterRetry(entry('a', { status: 'failed', streamId: 'turn' })).status).toBe('steered')
    expect(afterRetry(entry('a', { status: 'failed', refusedBy: 'turn' })).status).toBe('pending')
  })

  it('holds only what was waiting in the chat whose turn errored', () => {
    const held = holdAfterErroredTurn(
      [
        entry('a', { notBefore: NOW }),
        entry('b', { status: 'steered', streamId: 'turn' }),
        entry('c', { chatKey: 'other' }),
      ],
      'chat'
    )
    expect(held.map((message) => message.status)).toEqual(['failed', 'steered', 'pending'])
    expect(held[0].notBefore).toBeUndefined()
  })

  it('counts a message the turn itself applied as done, and one that goes out next as work', () => {
    const steered = entry('a', { status: 'steered', streamId: 'turn' })
    expect(hasOutgoingFollowUp([steered], new Set(['a']))).toBe(false)
    expect(hasOutgoingFollowUp([steered], new Set())).toBe(true)
    expect(hasOutgoingFollowUp([entry('a', { status: 'failed' })], new Set())).toBe(false)
    expect(hasOutgoingFollowUp([entry('a')], new Set())).toBe(true)
  })
})

describe('journal', () => {
  it('restores a send or steer that was out as possibly held, so it cannot steer again', () => {
    for (const status of ['sending', 'steering'] as const) {
      const restored = fromJournaled('chat', toJournaled(entry('a', { status })))
      expect(restored.unconfirmed).toBe(true)
    }
  })

  it('keeps what a reload needs to go on where it stood', () => {
    const restored = fromJournaled(
      'chat',
      toJournaled(
        entry('a', { status: 'applied', streamId: 'turn', textOffset: 4, refusedBy: 'earlier' })
      )
    )
    expect(restored).toMatchObject({
      status: 'applied',
      streamId: 'turn',
      textOffset: 4,
      refusedBy: 'earlier',
    })
  })
})

describe('deliveryOf', () => {
  it('says a message waits for the turn only when it cannot steer it', () => {
    expect(deliveryOf(entry('a', { unconfirmed: true }), true)).toBe('waiting')
    expect(deliveryOf(entry('a', { refusedBy: 'turn' }), true)).toBe('waiting')
    expect(deliveryOf(entry('a'), true)).toBe('sending')
    expect(deliveryOf(entry('a', { unconfirmed: true }), false)).toBe('sending')
  })

  it('stops talking about a message the worker took', () => {
    const steered = entry('a', { status: 'steered', streamId: 'turn' })
    expect(deliveryOf(steered, true)).toBeUndefined()
    expect(deliveryOf({ ...steered, unconfirmed: true }, true)).toBe('sending')
    expect(deliveryOf(entry('a', { status: 'failed' }), true)).toBe('failed')
  })
})
