/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

const { mockLoadCopilotChatMessages } = vi.hoisted(() => ({
  mockLoadCopilotChatMessages: vi.fn(),
}))

vi.mock('@/lib/copilot/chat/lifecycle', () => ({
  loadCopilotChatMessages: mockLoadCopilotChatMessages,
}))

import { buildLocalWorkspaceMessages } from './messages'

describe('buildLocalWorkspaceMessages', () => {
  it('replays the persisted transcript without duplicating the current user turn', async () => {
    mockLoadCopilotChatMessages.mockResolvedValue([
      { id: '1', role: 'user', content: 'First question', timestamp: '2026-07-11T00:00:00Z' },
      { id: '2', role: 'assistant', content: 'First answer', timestamp: '2026-07-11T00:00:01Z' },
      { id: '3', role: 'user', content: 'Second question', timestamp: '2026-07-11T00:00:02Z' },
    ])

    const messages = await buildLocalWorkspaceMessages({ message: 'Second question' }, 'chat-1')

    expect(messages).toEqual([
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'First answer' },
      { role: 'user', content: 'Second question' },
    ])
  })

  it('adds the current user turn when no durable chat exists', async () => {
    const messages = await buildLocalWorkspaceMessages({ message: 'New question' })
    expect(messages).toEqual([{ role: 'user', content: 'New question' }])
  })
})
