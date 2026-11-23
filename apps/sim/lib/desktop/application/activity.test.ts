import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { presence, rows } = vi.hoisted(() => ({
  presence: { present: vi.fn() },
  rows: vi.fn(),
}))

vi.mock('@/lib/desktop/executor/presence', () => ({
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

  it('calls a desktop blocked when its presence is gone', async () => {
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
