import { createLogger } from '@sim/logger'
import type { AuthenticatedSocket } from '@/middleware/auth'
import { verifyTableAccess } from '@/middleware/permissions'
import { type IRoomManager, tableRoomName } from '@/rooms/types'

const logger = createLogger('TableHandlers')

/**
 * Wires `join-table` / `leave-table` socket events. Tables don't track presence
 * or last-modified state — joining is a thin wrapper around `socket.join` so the
 * Sim API → Realtime HTTP bridge can broadcast row updates back to subscribed clients.
 */
export function setupTableHandlers(socket: AuthenticatedSocket, _roomManager: IRoomManager) {
  socket.on('join-table', async ({ tableId }: { tableId?: string }) => {
    try {
      if (!tableId || typeof tableId !== 'string') {
        socket.emit('join-table-error', {
          tableId: tableId ?? null,
          error: 'tableId required',
          code: 'INVALID_TABLE_ID',
          retryable: false,
        })
        return
      }

      const userId = socket.userId
      if (!userId) {
        socket.emit('join-table-error', {
          tableId,
          error: 'Authentication required',
          code: 'AUTHENTICATION_REQUIRED',
          retryable: false,
        })
        return
      }

      const { hasAccess } = await verifyTableAccess(userId, tableId)
      if (!hasAccess) {
        socket.emit('join-table-error', {
          tableId,
          error: 'Access denied to table',
          code: 'ACCESS_DENIED',
          retryable: false,
        })
        return
      }

      const room = tableRoomName(tableId)
      socket.join(room)
      socket.emit('join-table-success', { tableId, socketId: socket.id })
      logger.debug(`Socket ${socket.id} (user ${userId}) joined ${room}`)
    } catch (error) {
      logger.error(`Error joining table room:`, error)
      socket.emit('join-table-error', {
        tableId: null,
        error: 'Failed to join table',
        code: 'JOIN_TABLE_FAILED',
        retryable: true,
      })
    }
  })

  socket.on('leave-table', async ({ tableId }: { tableId?: string }) => {
    try {
      if (!tableId || typeof tableId !== 'string') return
      const room = tableRoomName(tableId)
      socket.leave(room)
      logger.debug(`Socket ${socket.id} left ${room}`)
    } catch (error) {
      logger.error(`Error leaving table room:`, error)
    }
  })
}
