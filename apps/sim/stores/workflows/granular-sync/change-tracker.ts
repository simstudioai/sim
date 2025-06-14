/**
 * Change tracker for monitoring workflow modifications
 * Tracks changes at the component level for efficient syncing
 */

import type { Edge } from 'reactflow'
import { createLogger } from '@/lib/logs/console-logger'
import type { BlockState } from '../workflow/types'
import type { ChangeTracker, PendingChange } from './types'

const logger = createLogger('ChangeTracker')

// Define proper types for granular API format
interface GranularNode {
  id: string
  type: string
  name: string
  positionX: number
  positionY: number
  subBlocks: Record<string, any>
  outputs: Record<string, any>
  enabled: boolean
  version: number
  horizontalHandles?: boolean
  isWide?: boolean
  height?: number
  advancedMode?: boolean
  data?: Record<string, any>
  parentId?: string
  extent?: string
}

interface GranularEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
  type?: string
  animated?: boolean
  style?: Record<string, any>
  data?: Record<string, any>
  version: number
}

interface GroupedChanges {
  nodes: { created: GranularNode[]; updated: GranularNode[]; deleted: string[] }
  edges: { created: GranularEdge[]; updated: GranularEdge[]; deleted: string[] }
  loops: { created: any[]; updated: any[]; deleted: string[] }
  parallels: { created: any[]; updated: any[]; deleted: string[] }
}

/**
 * Convert workflow store block format to API granular format
 */
function convertBlockToGranularNode(block: BlockState): GranularNode {
  const granularNode: GranularNode = {
    id: block.id,
    type: block.type,
    name: block.name,
    positionX: Math.round(block.position?.x || 0),
    positionY: Math.round(block.position?.y || 0),
    subBlocks: block.subBlocks || {},
    outputs: block.outputs || {},
    enabled: block.enabled ?? true,
    version: 1,
  }

  // Only add optional fields if they have actual values
  if (block.horizontalHandles !== undefined) {
    granularNode.horizontalHandles = block.horizontalHandles
  }
  if (block.isWide !== undefined) {
    granularNode.isWide = block.isWide
  }
  if (block.height !== undefined) {
    granularNode.height = block.height
  }
  if (block.advancedMode !== undefined) {
    granularNode.advancedMode = block.advancedMode
  }
  if (block.data !== undefined) {
    granularNode.data = block.data
  }
  if (block.data?.parentId && typeof block.data.parentId === 'string') {
    granularNode.parentId = block.data.parentId
  }
  if (block.data?.extent && typeof block.data.extent === 'string') {
    granularNode.extent = block.data.extent
  }

  return granularNode
}

/**
 * Convert workflow store edge format to API granular format
 */
function convertEdgeToGranularEdge(edge: Edge): GranularEdge {
  const granularEdge: GranularEdge = {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    version: 1,
  }

  // Only add optional fields if they have actual values
  if (edge.sourceHandle !== undefined) {
    granularEdge.sourceHandle = edge.sourceHandle
  }
  if (edge.targetHandle !== undefined) {
    granularEdge.targetHandle = edge.targetHandle
  }
  if (edge.type !== undefined) {
    granularEdge.type = edge.type
  }
  if (edge.animated !== undefined) {
    granularEdge.animated = edge.animated
  }
  if (edge.style !== undefined) {
    granularEdge.style = edge.style
  }
  if (edge.data !== undefined) {
    granularEdge.data = edge.data
  }

  return granularEdge
}

class GranularChangeTracker implements ChangeTracker {
  private pendingChanges = new Map<string, PendingChange[]>() // workflowId -> changes
  private trackingWorkflows = new Set<string>()
  private clientId: string
  private sessionId: string

  constructor() {
    this.clientId = this.generateClientId()
    this.sessionId = this.generateSessionId()
  }

  private generateClientId(): string {
    return `client-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
  }

  private generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
  }

  startTracking(workflowId: string): void {
    if (!this.trackingWorkflows.has(workflowId)) {
      this.trackingWorkflows.add(workflowId)
      this.pendingChanges.set(workflowId, [])
      logger.info(`Started tracking changes for workflow ${workflowId}`)
    }
  }

  stopTracking(workflowId: string): void {
    this.trackingWorkflows.delete(workflowId)
    this.pendingChanges.delete(workflowId)
    logger.info(`Stopped tracking changes for workflow ${workflowId}`)
  }

  trackChange(change: PendingChange): void {
    if (!this.trackingWorkflows.has(change.workflowId)) {
      logger.warn(`Attempted to track change for untracked workflow ${change.workflowId}`)
      return
    }

    const workflowChanges = this.pendingChanges.get(change.workflowId) || []

    // More robust duplicate detection - check for exact same operation on same entity
    const existingChangeIndex = workflowChanges.findIndex(
      (existing) =>
        existing.entityType === change.entityType &&
        existing.entityId === change.entityId &&
        existing.operation === change.operation
    )

    if (existingChangeIndex >= 0) {
      // Update existing change with latest data and timestamp
      workflowChanges[existingChangeIndex] = {
        ...change,
        timestamp: new Date(),
        clientId: this.clientId,
      }
      logger.debug(
        `Updated existing ${change.operation} change for ${change.entityType} ${change.entityId}`
      )
    } else {
      // Check for conflicting operations (e.g., create after delete, update after delete)
      const conflictingChangeIndex = workflowChanges.findIndex(
        (existing) =>
          existing.entityType === change.entityType && existing.entityId === change.entityId
      )

      if (conflictingChangeIndex >= 0) {
        const existingChange = workflowChanges[conflictingChangeIndex]

        // Handle operation conflicts intelligently
        if (existingChange.operation === 'delete' && change.operation !== 'delete') {
          // If we deleted something but now want to create/update it, replace with new operation
          workflowChanges[conflictingChangeIndex] = {
            ...change,
            timestamp: new Date(),
            clientId: this.clientId,
          }
          logger.debug(
            `Replaced ${existingChange.operation} with ${change.operation} for ${change.entityType} ${change.entityId}`
          )
        } else if (existingChange.operation === 'create' && change.operation === 'update') {
          // If we created something and then updated it, just keep it as create with latest data
          workflowChanges[conflictingChangeIndex] = {
            ...change,
            operation: 'create', // Keep as create since it doesn't exist in DB yet
            timestamp: new Date(),
            clientId: this.clientId,
          }
          logger.debug(`Merged update into create for ${change.entityType} ${change.entityId}`)
        } else {
          // For other cases, update the existing change
          workflowChanges[conflictingChangeIndex] = {
            ...change,
            timestamp: new Date(),
            clientId: this.clientId,
          }
          logger.debug(`Updated conflicting change for ${change.entityType} ${change.entityId}`)
        }
      } else {
        // No conflicts, add new change
        workflowChanges.push({
          ...change,
          clientId: this.clientId,
          timestamp: new Date(),
        })
        logger.debug(
          `Tracked new change: ${change.operation} ${change.entityType} ${change.entityId}`
        )
      }
    }

    this.pendingChanges.set(change.workflowId, workflowChanges)
  }

  getPendingChanges(workflowId: string): PendingChange[] {
    return this.pendingChanges.get(workflowId) || []
  }

  clearPendingChanges(workflowId: string): void {
    this.pendingChanges.set(workflowId, [])
    logger.debug(`Cleared pending changes for workflow ${workflowId}`)
  }

  hasChanges(workflowId: string): boolean {
    const changes = this.pendingChanges.get(workflowId) || []
    return changes.length > 0
  }

  // Get changes grouped by entity type for easier processing
  getGroupedChanges(workflowId: string): {
    nodes: { created: GranularNode[]; updated: GranularNode[]; deleted: string[] }
    edges: { created: GranularEdge[]; updated: GranularEdge[]; deleted: string[] }
    loops: { created: any[]; updated: any[]; deleted: string[] }
    parallels: { created: any[]; updated: any[]; deleted: string[] }
  } {
    const changes = this.getPendingChanges(workflowId)

    const groupedChanges = {
      nodes: {
        created: [] as GranularNode[],
        updated: [] as GranularNode[],
        deleted: [] as string[],
      },
      edges: {
        created: [] as GranularEdge[],
        updated: [] as GranularEdge[],
        deleted: [] as string[],
      },
      loops: { created: [] as any[], updated: [] as any[], deleted: [] as string[] },
      parallels: { created: [] as any[], updated: [] as any[], deleted: [] as string[] },
    }

    changes.forEach((change) => {
      if (change.entityType === 'node') {
        if (change.operation === 'create') {
          groupedChanges.nodes.created.push({ ...change.data, workflowId })
        } else if (change.operation === 'update') {
          groupedChanges.nodes.updated.push({ ...change.data, workflowId })
        } else if (change.operation === 'delete') {
          groupedChanges.nodes.deleted.push(change.entityId)
        }
      } else if (change.entityType === 'edge') {
        if (change.operation === 'create') {
          groupedChanges.edges.created.push({ ...change.data, workflowId })
        } else if (change.operation === 'update') {
          groupedChanges.edges.updated.push({ ...change.data, workflowId })
        } else if (change.operation === 'delete') {
          groupedChanges.edges.deleted.push(change.entityId)
        }
      } else if (change.entityType === 'loop') {
        if (change.operation === 'create') {
          groupedChanges.loops.created.push({ ...change.data, workflowId })
        } else if (change.operation === 'update') {
          groupedChanges.loops.updated.push({ ...change.data, workflowId })
        } else if (change.operation === 'delete') {
          groupedChanges.loops.deleted.push(change.entityId)
        }
      } else if (change.entityType === 'parallel') {
        if (change.operation === 'create') {
          groupedChanges.parallels.created.push({ ...change.data, workflowId })
        } else if (change.operation === 'update') {
          groupedChanges.parallels.updated.push({ ...change.data, workflowId })
        } else if (change.operation === 'delete') {
          groupedChanges.parallels.deleted.push(change.entityId)
        }
      }
    })

    return groupedChanges
  }

  // Get summary of changes for logging/debugging
  getChangesSummary(workflowId: string): string {
    const grouped = this.getGroupedChanges(workflowId)
    const summary: string[] = []

    Object.entries(grouped).forEach(([entityType, operations]) => {
      const total =
        operations.created.length + operations.updated.length + operations.deleted.length
      if (total > 0) {
        summary.push(
          `${entityType}: ${operations.created.length}C/${operations.updated.length}U/${operations.deleted.length}D`
        )
      }
    })

    return summary.length > 0 ? summary.join(', ') : 'No changes'
  }

  // Cleanup old changes (useful for memory management)
  cleanupOldChanges(olderThanMs = 300000): void {
    // 5 minutes default
    const cutoff = new Date(Date.now() - olderThanMs)

    for (const [workflowId, changes] of this.pendingChanges.entries()) {
      const filteredChanges = changes.filter((change) => change.timestamp > cutoff)

      if (filteredChanges.length !== changes.length) {
        this.pendingChanges.set(workflowId, filteredChanges)
        logger.debug(
          `Cleaned up ${changes.length - filteredChanges.length} old changes for workflow ${workflowId}`
        )
      }
    }
  }

  getClientId(): string {
    return this.clientId
  }

  getSessionId(): string {
    return this.sessionId
  }
}

// Create singleton instance
export const changeTracker = new GranularChangeTracker()

// Helper functions for creating change objects
export function createNodeChange(
  workflowId: string,
  operation: 'create' | 'update' | 'delete',
  nodeId: string,
  nodeData: any
): PendingChange {
  return {
    id: `${operation}-node-${nodeId}-${Date.now()}`,
    workflowId,
    entityType: 'node',
    operation,
    entityId: nodeId,
    data: operation === 'delete' ? nodeData : convertBlockToGranularNode(nodeData),
    timestamp: new Date(),
    clientId: changeTracker.getClientId(),
  }
}

export function createEdgeChange(
  workflowId: string,
  operation: 'create' | 'update' | 'delete',
  edgeId: string,
  edgeData: any
): PendingChange {
  return {
    id: `${operation}-edge-${edgeId}-${Date.now()}`,
    workflowId,
    entityType: 'edge',
    operation,
    entityId: edgeId,
    data: operation === 'delete' ? edgeData : convertEdgeToGranularEdge(edgeData),
    timestamp: new Date(),
    clientId: changeTracker.getClientId(),
  }
}

export function createLoopChange(
  workflowId: string,
  operation: 'create' | 'update' | 'delete',
  loopId: string,
  loopData: any
): PendingChange {
  return {
    id: `${operation}-loop-${loopId}-${Date.now()}`,
    workflowId,
    entityType: 'loop',
    operation,
    entityId: loopId,
    data: loopData,
    timestamp: new Date(),
    clientId: changeTracker.getClientId(),
  }
}

export function createParallelChange(
  workflowId: string,
  operation: 'create' | 'update' | 'delete',
  parallelId: string,
  parallelData: any
): PendingChange {
  return {
    id: `${operation}-parallel-${parallelId}-${Date.now()}`,
    workflowId,
    entityType: 'parallel',
    operation,
    entityId: parallelId,
    data: parallelData,
    timestamp: new Date(),
    clientId: changeTracker.getClientId(),
  }
}
