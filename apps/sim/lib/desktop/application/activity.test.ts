import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { presence, rows } = vi.hoisted(() => ({
  presence: { available: vi.fn(), present: vi.fn() },
  rows: vi.fn(),
}))

vi.mock('@/lib/desktop/executor/presence', () => ({
  isDesktopPresenceAvailable: presence.available,
  isDesktopPresent: presence.present,
}))
vi.mock('@/lib/desktop/executor/repository', () => ({ listDesktopActivityRows: rows }))

import { listDesktopActivity } from '@/lib/desktop/application/activity'

const principal = createSessionPrincipal({ userId: 'user-1', sessionId: 'session-1' })

describe('desktop activity presence', () => {
  beforeEach(() => {
    rows.mockResolvedValue([
      {
        chatId: 'chat-1',
        streamId: 's-1',
        deviceId: 'device-1',
        deviceName: 'Studio Mac',
        needsInput: false,
      },
    ])
  })

  it('does not call a desktop blocked when Sim cannot track presence at all', async () => {
    presence.available.mockReturnValue(false)
    presence.present.mockResolvedValue(false)

    const { chats } = await listDesktopActivity.execute({
      principal,
      input: { workspaceId: 'ws-1' },
    })

    expect(chats).toEqual([
      { chatId: 'chat-1', streamId: 's-1', state: 'running', deviceName: 'Studio Mac' },
    ])
  })

  it('calls a desktop blocked when presence is tracked and it is gone', async () => {
    presence.available.mockReturnValue(true)
    presence.present.mockResolvedValue(false)

    const { chats } = await listDesktopActivity.execute({
      principal,
      input: { workspaceId: 'ws-1' },
    })

    expect(chats).toEqual([
      { chatId: 'chat-1', streamId: 's-1', state: 'blocked', deviceName: 'Studio Mac' },
    ])
  })
})
