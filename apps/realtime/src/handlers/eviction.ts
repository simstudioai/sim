import { createLogger } from '@sim/logger'
import type { AuthenticatedSocket } from '@/middleware/auth'
import type { IRoomManager } from '@/rooms'

const logger = createLogger('SocketEviction')

/**
 * Removes the calling socket from a workflow room after its access has been
 * revoked mid-session, so it immediately stops receiving broadcasts and can no
 * longer mutate workflow state.
 */
export async function evictRevokedSocket(
  roomManager: IRoomManager,
  socket: AuthenticatedSocket,
  workflowId: string
): Promise<void> {
  try {
    socket.leave(workflowId)
    await roomManager.removeUserFromRoom(socket.id, workflowId)
    await roomManager.broadcastPresenceUpdate(workflowId)
  } catch (error) {
    logger.error(`Failed to evict revoked socket ${socket.id} from workflow ${workflowId}`, error)
  }
}
