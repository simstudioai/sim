/**
 * Types for the new granular workflow sync system
 * These types represent the normalized workflow data structure
 */

export interface GranularWorkflowNode {
  id: string
  workflowId: string
  type: string
  name: string
  positionX: number
  positionY: number
  subBlocks: Record<string, any>
  outputs: Record<string, any>
  enabled: boolean
  horizontalHandles?: boolean
  isWide?: boolean
  height?: number
  advancedMode?: boolean
  data?: Record<string, any>
  parentId?: string
  extent?: string
  version: number
  lastModified: Date
  modifiedBy?: string
}

export interface GranularWorkflowEdge {
  id: string
  workflowId: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
  type?: string
  animated?: boolean
  style?: Record<string, any>
  data?: Record<string, any>
  version: number
  lastModified: Date
  modifiedBy?: string
}

export interface GranularWorkflowLoop {
  id: string
  workflowId: string
  nodes: string[]
  iterations: number
  loopType: 'for' | 'forEach'
  forEachItems?: any
  executionState: Record<string, any>
  version: number
  lastModified: Date
  modifiedBy?: string
}

export interface GranularWorkflowParallel {
  id: string
  workflowId: string
  nodes: string[]
  distribution?: any
  executionState: Record<string, any>
  version: number
  lastModified: Date
  modifiedBy?: string
}

// Sync payload types
export interface GranularSyncPayload {
  workflowId: string
  workspaceId?: string
  clientId: string
  sessionId: string
  lastSyncTimestamp?: Date
  changes: {
    nodes?: {
      created?: GranularWorkflowNode[]
      updated?: GranularWorkflowNode[]
      deleted?: string[]
    }
    edges?: {
      created?: GranularWorkflowEdge[]
      updated?: GranularWorkflowEdge[]
      deleted?: string[]
    }
    loops?: {
      created?: GranularWorkflowLoop[]
      updated?: GranularWorkflowLoop[]
      deleted?: string[]
    }
    parallels?: {
      created?: GranularWorkflowParallel[]
      updated?: GranularWorkflowParallel[]
      deleted?: string[]
    }
  }
}

// Sync response types
export interface GranularSyncResponse {
  success: boolean
  workflowId: string
  serverTimestamp: Date
  conflicts?: ConflictResolution[]
  appliedChanges: {
    nodes: number
    edges: number
    loops: number
    parallels: number
  }
  // Return any server-side changes that need to be applied to client
  serverChanges?: {
    nodes?: GranularWorkflowNode[]
    edges?: GranularWorkflowEdge[]
    loops?: GranularWorkflowLoop[]
    parallels?: GranularWorkflowParallel[]
  }
}

// Conflict resolution
export interface ConflictResolution {
  entityType: 'node' | 'edge' | 'loop' | 'parallel'
  entityId: string
  conflictType: 'version_mismatch' | 'concurrent_edit' | 'dependency_missing'
  resolution: 'server_wins' | 'client_wins' | 'merged' | 'rejected'
  serverVersion: any
  clientVersion: any
  mergedVersion?: any
  reason: string
}

// Legacy workflow state for backward compatibility
export interface LegacyWorkflowState {
  blocks: Record<string, any>
  edges: any[]
  loops: Record<string, any>
  parallels: Record<string, any>
  lastSaved?: number
  lastUpdate?: number
  isDeployed?: boolean
  deployedAt?: Date
  apiKey?: string
  marketplaceData?: any
}

// Conversion utilities types
export interface ConversionResult {
  nodes: GranularWorkflowNode[]
  edges: GranularWorkflowEdge[]
  loops: GranularWorkflowLoop[]
  parallels: GranularWorkflowParallel[]
}

// Sync manager configuration
export interface GranularSyncConfig {
  workflowId: string
  endpoint: string
  syncInterval?: number
  syncOnInterval?: boolean
  syncOnExit?: boolean
  maxRetries?: number
  retryBackoff?: number
  conflictResolutionStrategy?: 'server_wins' | 'client_wins' | 'merge' | 'prompt_user'
  onSyncSuccess?: (response: GranularSyncResponse) => void
  onSyncError?: (error: any) => void
  onConflict?: (conflicts: ConflictResolution[]) => void
}

// Change tracking
export interface ChangeTracker {
  startTracking: (workflowId: string) => void
  stopTracking: (workflowId: string) => void
  trackChange: (change: PendingChange) => void
  getPendingChanges: (workflowId: string) => PendingChange[]
  clearPendingChanges: (workflowId: string) => void
  hasChanges: (workflowId: string) => boolean
}

export interface PendingChange {
  id: string
  workflowId: string
  entityType: 'node' | 'edge' | 'loop' | 'parallel'
  operation: 'create' | 'update' | 'delete'
  entityId: string
  data: any
  timestamp: Date
  clientId: string
}

// Tab sync interface for the new system
export interface TabSyncManager {
  workflowId: string
  isActive: boolean
  lastActivity: Date
  clientId: string
  sessionId: string

  // Tab communication
  sendMessage: (message: TabSyncMessage) => void
  onMessage: (callback: (message: TabSyncMessage) => void) => void

  // Sync coordination
  requestSync: () => void
  becomeLeader: () => void
  isLeader: () => boolean
}

export interface TabSyncMessage {
  type: 'sync_request' | 'sync_complete' | 'changes_available' | 'leader_election' | 'heartbeat'
  workflowId: string
  clientId: string
  sessionId: string
  data?: any
  timestamp: Date
}
