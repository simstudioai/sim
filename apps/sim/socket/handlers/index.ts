import { setupConnectionHandlers } from '@/socket/handlers/connection'
import { setupOperationsHandlers } from '@/socket/handlers/operations'
import { setupPresenceHandlers } from '@/socket/handlers/presence'
import { setupSubblocksHandlers } from '@/socket/handlers/subblocks'
import { setupVariablesHandlers } from '@/socket/handlers/variables'
import { setupWorkflowHandlers } from '@/socket/handlers/workflow'
import type { AuthenticatedSocket } from '@/socket/middleware/auth'
import type { IRoomManager } from '@/socket/rooms'

export function setupAllHandlers(socket: AuthenticatedSocket, roomManager: IRoomManager) {
  setupWorkflowHandlers(socket, roomManager)
  setupOperationsHandlers(socket, roomManager)
  setupSubblocksHandlers(socket, roomManager)
  setupVariablesHandlers(socket, roomManager)
  setupPresenceHandlers(socket, roomManager)
  setupConnectionHandlers(socket, roomManager)
}
