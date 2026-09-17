/** @vitest-environment jsdom */
import { expect, it } from 'vitest'
import {
  MOTHERSHIP_SEND_MESSAGE_EVENT,
  type MothershipSendMessageDetail,
  sendMothershipMessage,
} from './events'

it.each(['fast', 'adaptive', 'max'] as const)(
  'retains captured %s through a claimed mounted-chat handoff',
  (level) => {
    let received: MothershipSendMessageDetail | undefined
    const listener = (event: Event) => {
      received = (event as CustomEvent<MothershipSendMessageDetail>).detail
      event.preventDefault()
    }
    window.addEventListener(MOTHERSHIP_SEND_MESSAGE_EVENT, listener)
    try {
      expect(
        sendMothershipMessage(
          'Search',
          undefined,
          undefined,
          'original-user-message',
          'assistant',
          { source: 'slack' },
          level
        )
      ).toBe(true)
      expect(received).toMatchObject({
        assistantSearchLevel: level,
        requestMode: 'assistant',
        resumeUserMessageId: 'original-user-message',
        assistantSearch: { source: 'slack' },
      })
      expect(received).not.toHaveProperty('assistantFast')
    } finally {
      window.removeEventListener(MOTHERSHIP_SEND_MESSAGE_EVENT, listener)
    }
  }
)
