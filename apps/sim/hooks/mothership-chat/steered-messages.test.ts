/**
 * Where a steered message shows. Failure modes: an applied message is shown at
 * the end instead of in its turn; the response after it is not split off; an
 * applied disposition with no frame yet is placed somewhere other than where the
 * frame will put it; a message both marked and reported applied shows twice; a
 * record with no marker (an orphan) disappears.
 */
import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@/lib/mothership/chat/types'
import { findLiveResponseId, placeSteeredMessages } from '@/hooks/mothership-chat/steered-messages'

const owner: ChatMessage = { id: 'turn', role: 'user', content: 'Count' }
const steering: ChatMessage = {
  id: 'steer',
  role: 'user',
  content: 'Stop at two',
  steering: { streamId: 'turn' },
}
const answer = (blocks: ChatMessage['contentBlocks']): ChatMessage => ({
  id: 'answer',
  streamId: 'turn',
  role: 'assistant',
  content: '',
  contentBlocks: blocks,
})
const text = (content: string) => ({ type: 'text' as const, content })
const marker = { type: 'steering' as const, steering: { steeringId: 'steer' } }
const shape = (messages: ChatMessage[]) => messages.map((m) => [m.role, m.content, m.id])

describe('findLiveResponseId', () => {
  const answer: ChatMessage = { id: 'answer', role: 'assistant', content: 'Done' }
  const user: ChatMessage = { id: 'turn', role: 'user', content: 'Go' }

  it('is the last response, past what is on its way into it', () => {
    expect(
      findLiveResponseId([
        user,
        answer,
        { ...user, id: 'sending', delivery: 'sending' },
        { ...user, id: 'held', steering: { streamId: 'turn' } },
      ])
    ).toBe('answer')
  })

  it("is none while the running turn's own message has no response after it", () => {
    expect(findLiveResponseId([user, answer, { ...user, id: 'next-turn' }])).toBeUndefined()
  })
})

describe('placeSteeredMessages', () => {
  it('splits the answer at the turn marker and shows the message there', () => {
    const placed = placeSteeredMessages(
      [owner, steering, answer([text('1 '), marker, text('2.')])],
      []
    )
    expect(shape(placed)).toEqual([
      ['user', 'Count', 'turn'],
      ['assistant', '1 ', 'answer:before:steer'],
      ['user', 'Stop at two', 'steer'],
      ['assistant', '2.', 'answer'],
    ])
  })

  it('places an applied disposition at its offset exactly where the frame would', () => {
    const fromFrame = placeSteeredMessages(
      [owner, answer([text('1 '), marker, text('2.')])],
      [{ message: steering }]
    )
    const fromOffset = placeSteeredMessages(
      [owner, answer([text('1 2.')])],
      [{ message: steering, streamId: 'turn', textOffset: 2 }]
    )
    expect(shape(fromOffset)).toEqual(shape(fromFrame))
  })

  it('shows a message marked by the turn and reported applied only once', () => {
    const placed = placeSteeredMessages(
      [owner, steering, answer([text('1 '), marker, text('2.')])],
      [{ message: steering, streamId: 'turn', textOffset: 2 }]
    )
    expect(placed.filter((message) => message.id === 'steer')).toHaveLength(1)
  })

  it('never hides a steering record its turn did not mark', () => {
    const placed = placeSteeredMessages([owner, steering, answer([text('done')])], [])
    expect(shape(placed).at(-1)).toEqual(['user', 'Stop at two', 'steer'])
  })
})
