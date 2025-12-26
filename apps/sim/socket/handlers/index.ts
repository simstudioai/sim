import { setupConnectionHandlers } from '@/socket/handlers/connection'
import { setupOperationsHandlers } from '@/socket/handlers/operations'
import { setupPresenceHandlers } from '@/socket/handlers/presence'
import { setupSubblocksHandlers } from '@/socket/handlers/subblocks'
import { setupVariablesHandlers } from '@/socket/handlers/variables'
import { setupWorkflowHandlers } from '@/socket/handlers/workflow'
import type { AuthenticatedSocket } from '@/socket/middleware/auth'
import type { RoomManager, UserPresence, WorkflowRoom } from '@/socket/rooms/manager'

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
  setupVariablesHandlers(socket, roomManager)
  setupPresenceHandlers(socket, roomManager)
  setupConnectionHandlers(socket, roomManager)
}

export {
  setupWorkflowHandlers,
  setupOperationsHandlers,
  setupSubblocksHandlers,
  setupVariablesHandlers,
  setupPresenceHandlers,
  setupConnectionHandlers,
}
