import type { AuthenticatedSocket } from '../middleware/auth'
import type { RoomManager, UserPresence, WorkflowRoom } from '../rooms/manager'
import { setupConnectionHandlers } from './connection'
import { setupOperationsHandlers } from './operations'
import { setupPresenceHandlers } from './presence'
import { setupSubblocksHandlers } from './subblocks'
import { setupWorkflowHandlers } from './workflow'

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
