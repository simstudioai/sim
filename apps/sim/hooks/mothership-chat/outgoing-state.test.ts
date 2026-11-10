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
  adoptOrphanRow,
  afterDispositionRead,
  afterRetry,
  afterUnsentAttempt,
  deliveryOf,
  fromJournaled,
  isDeliveredAsTurn,
  MAX_OUTGOING_DELIVERY_ATTEMPTS,
  nextOutgoingStep,
  nextOutgoingWake,
  type OutgoingMessage,
  toJournaled,
} from '@/hooks/mothership-chat/outgoing-state'
import type { MothershipChatHistory } from '@/hooks/queries/mothership-chats'

const NOW = 1_800_000_000_000
/** How old a message a closed tab left behind may be and still go out on its own. */
const ORPHAN_AUTO_SEND_MAX_AGE_MS = 10 * 60 * 1000

function entry(id: string, patch: Partial<OutgoingMessage> = {}): OutgoingMessage {
  return {
    id,
    chatKey: 'chat',
    payload: { content: id },
    display: { id, role: 'user', content: id },
    status: 'pending',
    attempts: 0,
    reads: 0,
    writtenAt: NOW,
    ...patch,
  }
}

const view = (patch: Partial<{ liveStreamId: string; admittedIds: ReadonlySet<string> }> = {}) => ({
  liveStreamId: undefined,
  admittedIds: new Set<string>(),
  now: NOW,
  ...patch,
})

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
  it('drops a message the chat already holds as a turn, past any retry delay', () => {
    const message = entry('a', { notBefore: NOW + 60_000 })
    expect(nextOutgoingStep([message], view({ admittedIds: new Set(['a']) })).kind).toBe('drop')
  })

  it('holds a message behind one on its way out or still being settled', () => {
    for (const status of ['sending', 'steering', 'steered'] as const) {
      expect(nextOutgoingStep([entry('a', { status }), entry('b')], view()).kind).toBe('idle')
    }
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

describe('orphan steering records', () => {
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

  it('reads a held message again later, and gives up at its own cap', () => {
    const context = { streamId: 'turn', turnErrored: false, now: NOW }
    const steered = entry('a', { status: 'steered', streamId: 'turn' })
    const later = afterDispositionRead(steered, { status: 'queued' }, context)
    expect(later).toMatchObject({ reads: 1, unconfirmed: false })
    expect(later.notBefore).toBeGreaterThan(NOW)
    expect(afterDispositionRead(steered, { status: 'unknown' }, context).unconfirmed).toBe(true)
    expect(
      afterDispositionRead(
        { ...steered, reads: MAX_OUTGOING_DELIVERY_ATTEMPTS - 1 },
        { status: 'queued' },
        context
      ).status
    ).toBe('failed')
  })

  it('sends a message read as not applied at once, whatever the reads before it took', () => {
    const steered = entry('a', { status: 'steered', streamId: 'turn', reads: 6 })
    const patch = afterDispositionRead(
      steered,
      { status: 'not_applied' },
      { streamId: 'turn', turnErrored: false, now: NOW }
    )
    expect(patch.status).toBe('pending')
    expect(patch.notBefore).toBeUndefined()
  })

  it('still backs off a message the chat kept refusing as busy', () => {
    const steered = entry('a', { status: 'steered', streamId: 'turn', attempts: 2 })
    const { notBefore } = afterDispositionRead(
      steered,
      { status: 'not_applied' },
      { streamId: 'turn', turnErrored: false, now: NOW }
    )
    expect(notBefore).toBeGreaterThan(NOW)
  })

  it('clears the retry delay on every move to not delivered or applied', () => {
    const delayed = { notBefore: NOW - 1 }
    const context = { streamId: 'turn', turnErrored: false, now: NOW }
    const steered = entry('a', { status: 'steered', streamId: 'turn', ...delayed })
    for (const patch of [
      afterUnsentAttempt(entry('a', { attempts: MAX_OUTGOING_DELIVERY_ATTEMPTS - 1, ...delayed }), {
        online: true,
        now: NOW,
      }),
      afterDispositionRead({ ...steered, reads: 7 }, { status: 'queued' }, context),
      afterDispositionRead(steered, { status: 'applied' }, context),
      afterDispositionRead(
        { ...steered, attempts: 2 },
        { status: 'not_applied' },
        { ...context, turnErrored: true }
      ),
    ]) {
      expect('notBefore' in patch && patch.notBefore === undefined).toBe(true)
    }
  })

  it('wakes only for a delay the last pass could have skipped', () => {
    const wake = (message: OutgoingMessage) => nextOutgoingWake([message], NOW)
    for (const status of ['pending', 'steered'] as const) {
      expect(wake(entry('a', { status, notBefore: NOW + 5 }))).toBe(NOW + 5)
      expect(wake(entry('a', { status, notBefore: NOW }))).toBe(Number.POSITIVE_INFINITY)
    }
    for (const status of ['failed', 'applied'] as const) {
      expect(wake(entry('a', { status, notBefore: NOW + 5 }))).toBe(Number.POSITIVE_INFINITY)
    }
    expect(wake(entry('a'))).toBe(Number.POSITIVE_INFINITY)
    expect(
      nextOutgoingWake(
        [entry('a', { notBefore: NOW + 9 }), entry('b', { notBefore: NOW + 3 })],
        NOW
      )
    ).toBe(NOW + 3)
  })

  it('leaves reads out of the budget for sends', () => {
    const read = afterDispositionRead(
      entry('a', { status: 'steered', streamId: 'turn' }),
      { status: 'queued' },
      { streamId: 'turn', turnErrored: false, now: NOW }
    )
    expect(read.attempts).toBeUndefined()
    const sent = afterUnsentAttempt(entry('a', { reads: MAX_OUTGOING_DELIVERY_ATTEMPTS }), {
      online: true,
      now: NOW,
    })
    expect(sent).toMatchObject({ status: 'pending', attempts: 1 })
  })

  it('counts a message not delivered or steered as delivered once its id is a turn', () => {
    const admitted = new Set(['a'])
    expect(isDeliveredAsTurn(entry('a', { status: 'failed' }), admitted)).toBe(true)
    expect(isDeliveredAsTurn(entry('a', { status: 'failed', streamId: 'turn' }), admitted)).toBe(
      true
    )
    expect(isDeliveredAsTurn(entry('a', { status: 'steered' }), admitted)).toBe(true)
    expect(isDeliveredAsTurn(entry('b', { status: 'failed' }), admitted)).toBe(false)
  })

  it('reads a steered message again on Retry, and sends one that never reached a turn', () => {
    expect(afterRetry(entry('a', { status: 'failed', streamId: 'turn' })).status).toBe('steered')
    expect(afterRetry(entry('a', { status: 'failed', refusedBy: 'turn' })).status).toBe('pending')
  })
})

describe('journal', () => {
  it('restores a send or steer that was out as possibly held, so it cannot steer again', () => {
    for (const status of ['sending', 'steering'] as const) {
      const restored = fromJournaled('chat', toJournaled(entry('a', { status })), NOW)
      expect(restored.unconfirmed).toBe(true)
    }
  })

  it('keeps what a reload needs to go on where it stood', () => {
    const restored = fromJournaled(
      'chat',
      toJournaled(
        entry('a', { status: 'applied', streamId: 'turn', textOffset: 4, refusedBy: 'earlier' })
      ),
      NOW
    )
    expect(restored).toMatchObject({
      status: 'applied',
      streamId: 'turn',
      textOffset: 4,
      refusedBy: 'earlier',
    })
  })
})

describe('a journal restored past the age limit', () => {
  const restore = (status: OutgoingMessage['status'], age: number) =>
    fromJournaled(
      'chat',
      toJournaled(entry('a', { status, streamId: 'turn', writtenAt: NOW - age })),
      NOW
    ).status

  it('lets the user send it once they ask, after no turn took it', () => {
    const aged = fromJournaled(
      'chat',
      toJournaled(
        entry('a', {
          status: 'steered',
          streamId: 'turn',
          writtenAt: NOW - ORPHAN_AUTO_SEND_MAX_AGE_MS,
        })
      ),
      NOW
    )
    const retried = { ...aged, ...afterRetry(aged) }
    const read = afterDispositionRead(
      retried,
      { status: 'not_applied' },
      { streamId: 'turn', turnErrored: false, now: NOW }
    )
    expect(read.status).toBe('pending')
  })

  it('sends a recent steered message no turn took on its own', () => {
    const recent = fromJournaled(
      'chat',
      toJournaled(entry('a', { status: 'steered', streamId: 'turn', writtenAt: NOW - 1 })),
      NOW
    )
    expect(
      afterDispositionRead(
        recent,
        { status: 'not_applied' },
        { streamId: 'turn', turnErrored: false, now: NOW }
      ).status
    ).toBe('pending')
  })

  it('resumes a recent one where it stood, and leaves one already applied alone', () => {
    expect(restore('pending', ORPHAN_AUTO_SEND_MAX_AGE_MS - 1)).toBe('pending')
    expect(restore('steered', ORPHAN_AUTO_SEND_MAX_AGE_MS - 1)).toBe('steered')
    expect(restore('applied', ORPHAN_AUTO_SEND_MAX_AGE_MS)).toBe('applied')
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
