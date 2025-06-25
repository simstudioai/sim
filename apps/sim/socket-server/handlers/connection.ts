import { createLogger } from '../../lib/logs/console-logger'
import type { AuthenticatedSocket } from '../middleware/auth'
import type { RoomManager } from '../rooms/manager'
import type { HandlerDependencies } from './workflow'

const logger = createLogger('ConnectionHandlers')

export function setupConnectionHandlers(
  socket: AuthenticatedSocket,
  deps: HandlerDependencies | RoomManager
) {
  const roomManager =
    deps instanceof Object && 'roomManager' in deps ? deps.roomManager : (deps as RoomManager)

  socket.on('error', (error) => {
    logger.error(`Socket ${socket.id} error:`, error)
  })

  socket.conn.on('error', (error) => {
    logger.error(`Socket ${socket.id} connection error:`, error)
  })

  socket.on('disconnect', (reason) => {
    const workflowId = roomManager.getWorkflowIdForSocket(socket.id)
    const session = roomManager.getUserSession(socket.id)

    if (workflowId && session) {
      roomManager.cleanupUserFromRoom(socket.id, workflowId)
      roomManager.broadcastPresenceUpdate(workflowId)
    }

    roomManager.clearPendingOperations(socket.id)
  })
}
