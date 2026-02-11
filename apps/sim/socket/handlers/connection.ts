import { createLogger } from '@sim/logger'
import { cleanupPendingSubblocksForSocket } from '@/socket/handlers/subblocks'
import { cleanupPendingVariablesForSocket } from '@/socket/handlers/variables'
import type { AuthenticatedSocket } from '@/socket/middleware/auth'
import type { IRoomManager } from '@/socket/rooms'

const logger = createLogger('ConnectionHandlers')

export function setupConnectionHandlers(socket: AuthenticatedSocket, roomManager: IRoomManager) {
  socket.on('error', (error) => {
    logger.error(`Socket ${socket.id} error:`, error)
  })

  socket.conn.on('error', (error) => {
    logger.error(`Socket ${socket.id} connection error:`, error)
  })

  socket.on('disconnect', async (reason) => {
    try {
      // Clean up pending debounce entries for this socket to prevent memory leaks
      cleanupPendingSubblocksForSocket(socket.id)
      cleanupPendingVariablesForSocket(socket.id)

      const workflowIdHint = [...socket.rooms].find((roomId) => roomId !== socket.id)
      const workflowId = await roomManager.removeUserFromRoom(socket.id, workflowIdHint)

      if (workflowId) {
        await roomManager.broadcastPresenceUpdate(workflowId)
        logger.info(
          `Socket ${socket.id} disconnected from workflow ${workflowId} (reason: ${reason})`
        )
      }
    } catch (error) {
      logger.error(`Error handling disconnect for socket ${socket.id}:`, error)
    }
  })
}
