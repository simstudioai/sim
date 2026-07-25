import { setupConnectionHandlers } from '@/handlers/connection'
import { setupWorkspaceFileDocHandlers } from '@/handlers/file-doc'
import { setupOperationsHandlers } from '@/handlers/operations'
import { setupPresenceHandlers } from '@/handlers/presence'
import { setupSubblocksHandlers } from '@/handlers/subblocks'
import { setupTablesHandlers } from '@/handlers/tables'
import { setupVariablesHandlers } from '@/handlers/variables'
import { setupWorkflowHandlers } from '@/handlers/workflow'
import { setupWorkspaceFilesHandlers } from '@/handlers/workspace-files'
import type { AuthenticatedSocket } from '@/middleware/auth'
import type { IRoomManager } from '@/rooms'

export function setupAllHandlers(socket: AuthenticatedSocket, roomManager: IRoomManager) {
  setupWorkflowHandlers(socket, roomManager)
  setupOperationsHandlers(socket, roomManager)
  setupSubblocksHandlers(socket, roomManager)
  setupVariablesHandlers(socket, roomManager)
  setupPresenceHandlers(socket, roomManager)
  setupWorkspaceFilesHandlers(socket, roomManager)
  setupWorkspaceFileDocHandlers(socket, roomManager)
  setupTablesHandlers(socket, roomManager)
  setupConnectionHandlers(socket, roomManager)
}
