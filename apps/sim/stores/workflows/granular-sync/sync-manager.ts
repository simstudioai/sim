/**
 * Granular sync manager for the new workflow sync system
 * Handles component-level syncing with conflict resolution
 */

import { createLogger } from '@/lib/logs/console-logger'
import { changeTracker } from './change-tracker'
import type {
  ConflictResolution,
  GranularSyncConfig,
  GranularSyncPayload,
  GranularSyncResponse,
  GranularWorkflowEdge,
  GranularWorkflowLoop,
  GranularWorkflowNode,
  GranularWorkflowParallel,
} from './types'

const logger = createLogger('GranularSyncManager')

export class GranularSyncManager {
  private config: GranularSyncConfig
  private isActive = false
  private syncInProgress = false
  private intervalId: NodeJS.Timeout | null = null
  private lastSyncTimestamp: Date | null = null

  constructor(config: GranularSyncConfig) {
    this.config = {
      syncInterval: 30000, // 30 seconds
      syncOnInterval: true,
      syncOnExit: true,
      maxRetries: 3,
      retryBackoff: 1000,
      conflictResolutionStrategy: 'merge',
      ...config,
    }
  }

  /**
   * Start the sync manager
   */
  start(): void {
    if (this.isActive) {
      logger.warn(`Sync manager for workflow ${this.config.workflowId} is already active`)
      return
    }

    this.isActive = true
    changeTracker.startTracking(this.config.workflowId)

    if (this.config.syncOnInterval && this.config.syncInterval) {
      this.startIntervalSync()
    }

    // Register cleanup on page unload
    if (typeof window !== 'undefined' && this.config.syncOnExit) {
      window.addEventListener('beforeunload', this.handleBeforeUnload)
    }

    logger.info(`Started granular sync manager for workflow ${this.config.workflowId}`)
  }

  /**
   * Stop the sync manager
   */
  stop(): void {
    if (!this.isActive) return

    this.isActive = false
    this.stopIntervalSync()
    changeTracker.stopTracking(this.config.workflowId)

    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this.handleBeforeUnload)
    }

    logger.info(`Stopped granular sync manager for workflow ${this.config.workflowId}`)
  }

  /**
   * Manually trigger a sync
   */
  async sync(): Promise<GranularSyncResponse | null> {
    if (!this.isActive) {
      logger.warn(`Cannot sync inactive manager for workflow ${this.config.workflowId}`)
      return null
    }

    if (this.syncInProgress) {
      logger.debug(`Sync already in progress for workflow ${this.config.workflowId}`)
      return null
    }

    if (!changeTracker.hasChanges(this.config.workflowId)) {
      logger.debug(`No changes to sync for workflow ${this.config.workflowId}`)
      return null
    }

    this.syncInProgress = true

    try {
      logger.info(`Starting sync for workflow ${this.config.workflowId}`)

      // Get pending changes
      const groupedChanges = changeTracker.getGroupedChanges(this.config.workflowId)
      const changesSummary = changeTracker.getChangesSummary(this.config.workflowId)

      logger.info(`Syncing changes: ${changesSummary}`)

      // Prepare sync payload
      const payload: GranularSyncPayload = {
        workflowId: this.config.workflowId,
        clientId: changeTracker.getClientId(),
        sessionId: changeTracker.getSessionId(),
        lastSyncTimestamp: this.lastSyncTimestamp || undefined,
        changes: {
          nodes: this.prepareNodeChanges(groupedChanges.nodes),
          edges: this.prepareEdgeChanges(groupedChanges.edges),
          loops: this.prepareLoopChanges(groupedChanges.loops),
          parallels: this.prepareParallelChanges(groupedChanges.parallels),
        },
      }

      // Validate payload before sending
      const validation = this.validateSyncPayload(payload)
      if (!validation.isValid) {
        logger.error(`Invalid sync payload: ${validation.errors.join(', ')}`)
        return null
      }

      // Send sync request
      const response = await this.sendSyncRequest(payload)

      if (response.success) {
        // Clear pending changes on successful sync
        changeTracker.clearPendingChanges(this.config.workflowId)
        this.lastSyncTimestamp = response.serverTimestamp

        // Handle conflicts if any
        if (response.conflicts && response.conflicts.length > 0) {
          await this.handleConflicts(response.conflicts)
        }

        // Apply server changes if any
        if (response.serverChanges) {
          await this.applyServerChanges(response.serverChanges)
        }

        logger.info(`Sync completed successfully for workflow ${this.config.workflowId}`, {
          appliedChanges: response.appliedChanges,
          conflicts: response.conflicts?.length || 0,
        })

        if (this.config.onSyncSuccess) {
          this.config.onSyncSuccess(response)
        }
      } else {
        logger.error(`Sync failed for workflow ${this.config.workflowId}`)
      }

      return response
    } catch (error) {
      logger.error(`Sync error for workflow ${this.config.workflowId}:`, error)

      if (this.config.onSyncError) {
        this.config.onSyncError(error)
      }

      return null
    } finally {
      this.syncInProgress = false
    }
  }

  private startIntervalSync(): void {
    if (this.intervalId) return

    this.intervalId = setInterval(() => {
      this.sync().catch((error) => {
        logger.error(`Interval sync error for workflow ${this.config.workflowId}:`, error)
      })
    }, this.config.syncInterval)
  }

  private stopIntervalSync(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }

  private handleBeforeUnload = (): void => {
    if (changeTracker.hasChanges(this.config.workflowId)) {
      // Attempt synchronous sync on page unload
      // Note: This has limitations in modern browsers
      this.sync().catch((error) => {
        logger.error(`Exit sync error for workflow ${this.config.workflowId}:`, error)
      })
    }
  }

  private prepareNodeChanges(nodeChanges: any) {
    return {
      created: nodeChanges.created.map((change: any) => change.data).filter(Boolean),
      updated: nodeChanges.updated.map((change: any) => change.data).filter(Boolean),
      deleted: nodeChanges.deleted.map((change: any) => change.entityId),
    }
  }

  private prepareEdgeChanges(edgeChanges: any) {
    return {
      created: edgeChanges.created.map((change: any) => change.data).filter(Boolean),
      updated: edgeChanges.updated.map((change: any) => change.data).filter(Boolean),
      deleted: edgeChanges.deleted.map((change: any) => change.entityId),
    }
  }

  private prepareLoopChanges(loopChanges: any) {
    return {
      created: loopChanges.created.map((change: any) => change.data).filter(Boolean),
      updated: loopChanges.updated.map((change: any) => change.data).filter(Boolean),
      deleted: loopChanges.deleted.map((change: any) => change.entityId),
    }
  }

  private prepareParallelChanges(parallelChanges: any) {
    return {
      created: parallelChanges.created.map((change: any) => change.data).filter(Boolean),
      updated: parallelChanges.updated.map((change: any) => change.data).filter(Boolean),
      deleted: parallelChanges.deleted.map((change: any) => change.entityId),
    }
  }

  private validateSyncPayload(payload: GranularSyncPayload): {
    isValid: boolean
    errors: string[]
  } {
    const errors: string[] = []

    if (!payload.workflowId) {
      errors.push('Missing workflow ID')
    }

    if (!payload.clientId) {
      errors.push('Missing client ID')
    }

    // Validate individual entities
    const allNodes = [
      ...(payload.changes.nodes?.created || []),
      ...(payload.changes.nodes?.updated || []),
    ]

    const allEdges = [
      ...(payload.changes.edges?.created || []),
      ...(payload.changes.edges?.updated || []),
    ]

    // Basic validation for nodes
    allNodes.forEach((node, index) => {
      if (!node.id || !node.type || !node.name) {
        errors.push(`Node ${index} is missing required fields`)
      }
    })

    // Basic validation for edges
    allEdges.forEach((edge, index) => {
      if (!edge.id || !edge.source || !edge.target) {
        errors.push(`Edge ${index} is missing required fields`)
      }
    })

    return {
      isValid: errors.length === 0,
      errors,
    }
  }

  private async sendSyncRequest(payload: GranularSyncPayload): Promise<GranularSyncResponse> {
    const response = await fetch(this.config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      throw new Error(`Sync request failed: ${response.status} ${response.statusText}`)
    }

    return await response.json()
  }

  private async handleConflicts(conflicts: ConflictResolution[]): Promise<void> {
    logger.warn(`Handling ${conflicts.length} conflicts for workflow ${this.config.workflowId}`)

    for (const conflict of conflicts) {
      logger.warn(
        `Conflict: ${conflict.conflictType} for ${conflict.entityType} ${conflict.entityId}`,
        {
          resolution: conflict.resolution,
          reason: conflict.reason,
        }
      )
    }

    if (this.config.onConflict) {
      this.config.onConflict(conflicts)
    }
  }

  private async applyServerChanges(serverChanges: {
    nodes?: GranularWorkflowNode[]
    edges?: GranularWorkflowEdge[]
    loops?: GranularWorkflowLoop[]
    parallels?: GranularWorkflowParallel[]
  }): Promise<void> {
    logger.info(`Applying server changes for workflow ${this.config.workflowId}`)

    // This would integrate with your existing workflow store
    // For now, we'll just log what changes would be applied
    if (serverChanges.nodes?.length) {
      logger.info(`Would apply ${serverChanges.nodes.length} node changes`)
    }

    if (serverChanges.edges?.length) {
      logger.info(`Would apply ${serverChanges.edges.length} edge changes`)
    }

    if (serverChanges.loops?.length) {
      logger.info(`Would apply ${serverChanges.loops.length} loop changes`)
    }

    if (serverChanges.parallels?.length) {
      logger.info(`Would apply ${serverChanges.parallels.length} parallel changes`)
    }

    // TODO: Implement integration with workflow store
    // This would call the appropriate store actions to update the UI
  }

  /**
   * Get sync status information
   */
  getStatus(): {
    isActive: boolean
    syncInProgress: boolean
    lastSyncTimestamp: Date | null
    pendingChanges: number
    changesSummary: string
  } {
    return {
      isActive: this.isActive,
      syncInProgress: this.syncInProgress,
      lastSyncTimestamp: this.lastSyncTimestamp,
      pendingChanges: changeTracker.getPendingChanges(this.config.workflowId).length,
      changesSummary: changeTracker.getChangesSummary(this.config.workflowId),
    }
  }

  /**
   * Update sync configuration
   */
  updateConfig(newConfig: Partial<GranularSyncConfig>): void {
    this.config = { ...this.config, ...newConfig }

    // Restart interval sync if configuration changed
    if (this.isActive && (newConfig.syncInterval || newConfig.syncOnInterval !== undefined)) {
      this.stopIntervalSync()
      if (this.config.syncOnInterval && this.config.syncInterval) {
        this.startIntervalSync()
      }
    }

    logger.info(`Updated sync configuration for workflow ${this.config.workflowId}`)
  }
}
