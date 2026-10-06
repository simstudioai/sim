import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/events/pubsub', () => ({
  createPubSubChannel: () => ({
    publish: () => {
      throw new Error('Redis connection closed')
    },
    subscribe: vi.fn(),
    dispose: vi.fn(),
  }),
}))

import { ringDesktopInbox } from '@/lib/desktop/executor/doorbell'

describe('desktop inbox doorbell', () => {
  it('never fails its caller when the ring cannot be published', () => {
    expect(() => ringDesktopInbox('device-1', 'cancel')).not.toThrow()
  })
})
