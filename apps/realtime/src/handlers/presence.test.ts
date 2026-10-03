import { ROOM_TYPES } from '@sim/realtime-protocol/rooms'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setupPresenceHandlers } from '@/handlers/presence'
import type { IRoomManager } from '@/rooms'

const WORKFLOW_ROOM = { type: ROOM_TYPES.WORKFLOW, id: 'workflow-1' }

const SESSION = {
  userId: 'user-1',
  userName: 'Test User',
  avatarUrl: 'avatar.png',
}

function createSocket() {
  const handlers: Record<string, (payload: unknown) => Promise<void> | void> = {}
  const toEmit = vi.fn()
  const socket = {
    id: 'socket-1',
    on: vi.fn((event: string, handler: (payload: unknown) => Promise<void> | void) => {
      handlers[event] = handler
    }),
    to: vi.fn().mockReturnValue({ emit: toEmit }),
  }
  return { handlers, socket, toEmit }
}

function createRoomManager(): IRoomManager {
  return {
    getRoomForSocket: vi.fn().mockResolvedValue(WORKFLOW_ROOM),
    getUserSession: vi.fn().mockResolvedValue(SESSION),
    updateUserActivity: vi.fn().mockResolvedValue(undefined),
  } as unknown as IRoomManager
}

describe('presence handlers', () => {
  let handlers: Record<string, (payload: unknown) => Promise<void> | void>
  let toEmit: ReturnType<typeof vi.fn>
  let roomManager: IRoomManager

  beforeEach(() => {
    const created = createSocket()
    handlers = created.handlers
    toEmit = created.toEmit
    roomManager = createRoomManager()
    setupPresenceHandlers(created.socket as never, roomManager)
  })

  describe('cursor-update', () => {
    it('strips unexpected keys instead of storing them', async () => {
      await handlers['cursor-update']({
        cursor: { x: 1, y: 2, pad: 'A'.repeat(100_000) },
      })

      expect(roomManager.updateUserActivity).toHaveBeenCalledWith(WORKFLOW_ROOM, 'socket-1', {
        cursor: { x: 1, y: 2 },
      })
      const broadcast = toEmit.mock.calls[0][1] as { cursor: Record<string, unknown> }
      expect(broadcast.cursor).toEqual({ x: 1, y: 2 })
      expect(broadcast.cursor).not.toHaveProperty('pad')
    })

    it.each([
      ['an oversized string', 'A'.repeat(100_000)],
      ['a non-numeric x', { x: 'A'.repeat(100_000), y: 1 }],
      ['a missing y', { x: 1 }],
      ['NaN coordinates', { x: Number.NaN, y: Number.NaN }],
      ['Infinity coordinates', { x: Number.POSITIVE_INFINITY, y: 0 }],
      ['an array', [1, 2, 3]],
      ['undefined', undefined],
    ])('drops %s without storing or broadcasting it', async (_label, cursor) => {
      await handlers['cursor-update']({ cursor })

      expect(roomManager.updateUserActivity).not.toHaveBeenCalled()
      expect(toEmit).not.toHaveBeenCalled()
    })
  })

  describe('selection-update', () => {
    it.each([
      ['an unknown type', { type: 'evil', id: 'x' }],
      ['a missing type', { id: 'x' }],
      ['an oversized id', { type: 'block', id: 'A'.repeat(100_000) }],
      ['a non-string id', { type: 'block', id: { nested: 'A'.repeat(100_000) } }],
      ['null', null],
      ['an oversized string', 'A'.repeat(100_000)],
    ])('drops %s without storing or broadcasting it', async (_label, selection) => {
      await handlers['selection-update']({ selection })

      expect(roomManager.updateUserActivity).not.toHaveBeenCalled()
      expect(toEmit).not.toHaveBeenCalled()
    })
  })
})
