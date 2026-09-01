import { ROOM_TYPES } from '@sim/realtime-protocol/rooms'
import { setupConnectionHandlers } from '@/handlers/connection'
import { setupWorkspaceFileDocHandlers } from '@/handlers/file-doc'
import { setupOperationsHandlers } from '@/handlers/operations'
import { setupPresenceHandlers } from '@/handlers/presence'
import { setupSubblocksHandlers } from '@/handlers/subblocks'
import { setupTablesHandlers } from '@/handlers/tables'
import { setupVariablesHandlers } from '@/handlers/variables'
import { setupWorkflowHandlers } from '@/handlers/workflow'
import { setupWorkspaceInvalidationRoom } from '@/handlers/workspace-invalidation-room'
import type { AuthenticatedSocket } from '@/middleware/auth'
import type { IRoomManager } from '@/rooms'

export function setupAllHandlers(socket: AuthenticatedSocket, roomManager: IRoomManager) {
  setupWorkflowHandlers(socket, roomManager)
  setupOperationsHandlers(socket, roomManager)
  setupSubblocksHandlers(socket, roomManager)
  setupVariablesHandlers(socket, roomManager)
  setupPresenceHandlers(socket, roomManager)
  // Presence-free, workspace-scoped live-list rooms (share one implementation).
  setupWorkspaceInvalidationRoom(socket, roomManager, ROOM_TYPES.WORKSPACE_FILES)
  setupWorkspaceInvalidationRoom(socket, roomManager, ROOM_TYPES.WORKSPACE_TABLES)
  setupWorkspaceFileDocHandlers(socket, roomManager)
  setupTablesHandlers(socket, roomManager)
  setupConnectionHandlers(socket, roomManager)
}
