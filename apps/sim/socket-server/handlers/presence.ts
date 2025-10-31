import { createLogger } from '@/lib/logs/console/logger'
import type { HandlerDependencies } from '@/socket-server/handlers/workflow'
import type { AuthenticatedSocket } from '@/socket-server/middleware/auth'
import type { RoomManager } from '@/socket-server/rooms/manager'

const logger = createLogger('PresenceHandlers')

export function setupPresenceHandlers(
  socket: AuthenticatedSocket,
  deps: HandlerDependencies | RoomManager
) {
  const roomManager =
    deps instanceof Object && 'roomManager' in deps ? deps.roomManager : (deps as RoomManager)
  socket.on('cursor-update', ({ cursor }) => {
    const workflowId = roomManager.getWorkflowIdForSocket(socket.id)
    const session = roomManager.getUserSession(socket.id)

    if (!workflowId || !session) return

    const room = roomManager.getWorkflowRoom(workflowId)
    if (!room) return

    const userPresence = room.users.get(socket.id)
    if (userPresence) {
      userPresence.cursor = cursor
      userPresence.lastActivity = Date.now()
    }

    socket.to(workflowId).emit('cursor-update', {
      socketId: socket.id,
      userId: session.userId,
      userName: session.userName,
      avatarUrl: session.avatarUrl,
      cursor,
    })
  })

  // Handle user selection (for showing what block/element a user has selected)
  socket.on('selection-update', ({ selection }) => {
    const workflowId = roomManager.getWorkflowIdForSocket(socket.id)
    const session = roomManager.getUserSession(socket.id)

    if (!workflowId || !session) return

    const room = roomManager.getWorkflowRoom(workflowId)
    if (!room) return

    const userPresence = room.users.get(socket.id)
    if (userPresence) {
      userPresence.selection = selection
      userPresence.lastActivity = Date.now()
    }

    socket.to(workflowId).emit('selection-update', {
      socketId: socket.id,
      userId: session.userId,
      userName: session.userName,
      avatarUrl: session.avatarUrl,
      selection,
    })
  })
}
