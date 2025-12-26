import { createLogger } from '@sim/logger'
import type { HandlerDependencies } from '@/socket/handlers/workflow'
import type { AuthenticatedSocket } from '@/socket/middleware/auth'
import type { RoomManager } from '@/socket/rooms/manager'

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
  })
}
