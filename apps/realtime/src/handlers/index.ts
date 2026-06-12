import { setupConnectionHandlers } from '@/handlers/connection'
import { setupOperationsHandlers } from '@/handlers/operations'
import { setupPresenceHandlers } from '@/handlers/presence'
import { setupSubblocksHandlers } from '@/handlers/subblocks'
import { setupVariablesHandlers } from '@/handlers/variables'
import { setupWorkflowHandlers } from '@/handlers/workflow'
import type { AuthenticatedSocket } from '@/middleware/auth'
import type { IRoomManager } from '@/rooms'

export function setupAllHandlers(socket: AuthenticatedSocket, roomManager: IRoomManager) {
  setupWorkflowHandlers(socket, roomManager)
  setupOperationsHandlers(socket, roomManager)
  setupSubblocksHandlers(socket, roomManager)
  setupVariablesHandlers(socket, roomManager)
  setupPresenceHandlers(socket, roomManager)
  setupConnectionHandlers(socket, roomManager)
}
