import { setupConnectionHandlers } from '@/socket-server/handlers/connection'
import { setupOperationsHandlers } from '@/socket-server/handlers/operations'
import { setupPresenceHandlers } from '@/socket-server/handlers/presence'
import { setupSubblocksHandlers } from '@/socket-server/handlers/subblocks'
import { setupWorkflowHandlers } from '@/socket-server/handlers/workflow'
import type { AuthenticatedSocket } from '@/socket-server/middleware/auth'
import type { RoomManager, UserPresence, WorkflowRoom } from '@/socket-server/rooms/manager'

export type { UserPresence, WorkflowRoom }

/**
 * Sets up all socket event handlers for an authenticated socket connection
 * @param socket - The authenticated socket instance
 * @param roomManager - Room manager instance for state management
 */
export function setupAllHandlers(socket: AuthenticatedSocket, roomManager: RoomManager) {
  setupWorkflowHandlers(socket, roomManager)
  setupOperationsHandlers(socket, roomManager)
  setupSubblocksHandlers(socket, roomManager)
  setupPresenceHandlers(socket, roomManager)
  setupConnectionHandlers(socket, roomManager)
}

export {
  setupWorkflowHandlers,
  setupOperationsHandlers,
  setupSubblocksHandlers,
  setupPresenceHandlers,
  setupConnectionHandlers,
}
