import { createLogger } from '@sim/logger'
import { ROOM_TYPES, type RoomRef, roomName } from '@sim/realtime-protocol/rooms'
import type { IRoomManager } from '@/rooms/types'

const logger = createLogger('WorkflowRoomService')

/** The workflow room ref for a workflow id. Its Socket.IO room name is the bare id. */
export function workflowRoom(workflowId: string): RoomRef {
  return { type: ROOM_TYPES.WORKFLOW, id: workflowId }
}

/**
 * Workflow-domain lifecycle broadcasts, composed over a domain-neutral
 * {@link IRoomManager}. Keeps workflow-specific concerns (deletion, revert,
 * update, deploy notifications) out of the generic manager, mirroring how the
 * workflow socket handlers own workflow semantics.
 */
export class WorkflowRoomService {
  constructor(private readonly manager: IRoomManager) {}

  async handleWorkflowDeletion(workflowId: string): Promise<void> {
    logger.info(`Handling workflow deletion notification for ${workflowId}`)
    const room = workflowRoom(workflowId)

    const users = await this.manager.getRoomUsers(room)

    if (users.length > 0) {
      this.manager.emitToRoom(room, 'workflow-deleted', {
        workflowId,
        message: 'This workflow has been deleted',
        timestamp: Date.now(),
      })
    }

    // Remove every socket from the Socket.IO room (cross-pod via the Redis adapter).
    const name = roomName(room)
    await this.manager.io.in(name).socketsLeave(name)

    // Drop presence state for each socket.
    for (const user of users) {
      await this.manager.removeUserFromRoom(room, user.socketId)
    }

    // Final unconditional wipe — the workflow is gone, so no state may linger even
    // if a per-socket removal failed or a socket joined mid-teardown (matches the
    // pre-refactor managers, which ended deletion with an unconditional room drop).
    await this.manager.deleteRoom(room)

    logger.info(
      `Cleaned up workflow room ${workflowId} after deletion (${users.length} users disconnected)`
    )
  }

  async handleWorkflowRevert(workflowId: string, timestamp: number): Promise<void> {
    logger.info(`Handling workflow revert notification for ${workflowId}`)
    const room = workflowRoom(workflowId)

    if (!(await this.manager.hasRoom(room))) {
      logger.debug(`No active room found for reverted workflow ${workflowId}`)
      return
    }

    this.manager.emitToRoom(room, 'workflow-reverted', {
      workflowId,
      message: 'Workflow has been reverted to deployed state',
      timestamp,
    })

    await this.manager.updateRoomLastModified(room)

    const userCount = await this.manager.getUniqueUserCount(room)
    logger.info(`Notified ${userCount} users about workflow revert: ${workflowId}`)
  }

  async handleWorkflowUpdate(workflowId: string): Promise<void> {
    logger.info(`Handling workflow update notification for ${workflowId}`)
    const room = workflowRoom(workflowId)

    if (!(await this.manager.hasRoom(room))) {
      logger.debug(`No active room found for updated workflow ${workflowId}`)
      return
    }

    this.manager.emitToRoom(room, 'workflow-updated', {
      workflowId,
      message: 'Workflow has been updated externally',
      timestamp: Date.now(),
    })

    await this.manager.updateRoomLastModified(room)

    const userCount = await this.manager.getUniqueUserCount(room)
    logger.info(`Notified ${userCount} users about workflow update: ${workflowId}`)
  }

  async handleWorkflowDeployed(workflowId: string): Promise<void> {
    logger.info(`Handling workflow deployed notification for ${workflowId}`)
    const room = workflowRoom(workflowId)

    if (!(await this.manager.hasRoom(room))) {
      logger.debug(`No active room found for deployed workflow ${workflowId}`)
      return
    }

    this.manager.emitToRoom(room, 'workflow-deployed', {
      workflowId,
      timestamp: Date.now(),
    })

    const userCount = await this.manager.getUniqueUserCount(room)
    logger.info(`Notified ${userCount} users about workflow deployment change: ${workflowId}`)
  }
}
