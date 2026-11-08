/**
 * @vitest-environment node
 *
 * Failure mode: a message waiting behind the running response (steering, or one
 * going out next) makes that response stop rendering as live, so its running tool
 * reads as finished.
 */
import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@/lib/mothership/chat/types'
import { isRunningWait, toPlatformTurns } from '@/platform/lib/data/chat-model'

const options = {
  streaming: true,
  sentAt: () => undefined,
  now: 0,
  isPersisted: () => false,
}
const owner: ChatMessage = { id: 'turn', role: 'user', content: 'Search' }
const response: ChatMessage = {
  id: 'answer',
  role: 'assistant',
  content: '',
  contentBlocks: [
    {
      type: 'tool_call',
      toolCall: { id: 'call-1', name: 'search_docs', status: 'executing' },
    },
  ],
}
const waiting: ChatMessage = {
  id: 'next',
  role: 'user',
  content: 'Then summarize',
  delivery: 'sending',
}

describe('toPlatformTurns', () => {
  it('keeps the running response live with a message waiting behind it', () => {
    const alone = toPlatformTurns([owner, response], options).at(-1)
    const followed = toPlatformTurns([owner, response, waiting], options).find(
      (turn) => turn.id === 'answer'
    )
    expect(followed).toEqual(alone)
  })

  it('does not mark a finished answer live while the running turn has no response yet', () => {
    const running = { ...owner, id: 'running-turn' }
    const reconnecting = toPlatformTurns([owner, response, running], options)
    const finished = toPlatformTurns([owner, response, running], { ...options, streaming: false })

    expect(reconnecting.find((turn) => turn.id === 'answer')).toEqual(
      finished.find((turn) => turn.id === 'answer')
    )
  })
})

describe('isRunningWait', () => {
  const pausing: ChatMessage = {
    id: 'pausing',
    role: 'assistant',
    content: '',
    contentBlocks: [
      { type: 'tool_call', toolCall: { id: 'wait-1', name: 'wait', status: 'executing' } },
    ],
  }

  it('keeps counting down while a steered message trails the running response', () => {
    const steered: ChatMessage = {
      id: 'steered',
      role: 'user',
      content: 'Also this',
      steering: { streamId: 'turn' },
    }
    expect(isRunningWait([pausing, steered])).toBe(true)
  })

  it('stops at the next turn: a wait left in an earlier response is not running', () => {
    const next: ChatMessage = { id: 'next', role: 'user', content: 'Next' }
    expect(isRunningWait([pausing, next])).toBe(false)
  })
})
