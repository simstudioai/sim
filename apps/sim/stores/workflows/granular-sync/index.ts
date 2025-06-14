/**
 * Granular Workflow Sync System
 *
 * A robust, component-level sync system for workflows that provides:
 * - Fine-grained change tracking
 * - Conflict resolution
 * - Real-time collaboration support
 * - Efficient bandwidth usage
 * - Better performance for large workflows
 */

export {
  changeTracker,
  createEdgeChange,
  createLoopChange,
  createNodeChange,
  createParallelChange,
} from './change-tracker'
// Conversion utilities
export {
  convertGranularToLegacy,
  convertLegacyToGranular,
  detectChanges,
  mergeGranularChangesWithLegacy,
  validateGranularData,
} from './conversion'
// Core functionality
export { GranularSyncManager } from './sync-manager'
// Core types
export type {
  ChangeTracker,
  ConflictResolution,
  ConversionResult,
  GranularSyncConfig,
  GranularSyncPayload,
  GranularSyncResponse,
  GranularWorkflowEdge,
  GranularWorkflowLoop,
  GranularWorkflowNode,
  GranularWorkflowParallel,
  LegacyWorkflowState,
  PendingChange,
  TabSyncManager,
  TabSyncMessage,
} from './types'

import { changeTracker } from './change-tracker'
import { GranularSyncManager } from './sync-manager'
// Import types and classes for internal use
import type { GranularSyncConfig } from './types'

// Constants
export const GRANULAR_SYNC_ENDPOINT = '/api/workflows/granular-sync'

/**
 * Factory function to create a granular sync manager for a workflow
 */
export function createGranularSyncManager(
  workflowId: string,
  options: Partial<GranularSyncConfig> = {}
): GranularSyncManager {
  const config: GranularSyncConfig = {
    workflowId,
    endpoint: GRANULAR_SYNC_ENDPOINT,
    syncInterval: 30000, // 30 seconds
    syncOnInterval: true,
    syncOnExit: true,
    maxRetries: 3,
    retryBackoff: 1000,
    conflictResolutionStrategy: 'merge',
    ...options,
  }

  return new GranularSyncManager(config)
}

/**
 * Utility function to start tracking changes for a workflow
 */
export function startWorkflowTracking(workflowId: string): void {
  changeTracker.startTracking(workflowId)
}

/**
 * Utility function to stop tracking changes for a workflow
 */
export function stopWorkflowTracking(workflowId: string): void {
  changeTracker.stopTracking(workflowId)
}

/**
 * Check if a workflow has pending changes
 */
export function hasWorkflowChanges(workflowId: string): boolean {
  return changeTracker.hasChanges(workflowId)
}

/**
 * Get a summary of pending changes for a workflow
 */
export function getWorkflowChangesSummary(workflowId: string): string {
  return changeTracker.getChangesSummary(workflowId)
}

/**
 * Migration helper: Check if granular sync is available for a workflow
 * This can be used during the transition period to determine which sync system to use
 */
export function isGranularSyncEnabled(): boolean {
  // For now, we can use a feature flag or environment variable
  return true // Enable by default for testing
}

/**
 * Development/debugging utility to get current sync state
 */
export function getGranularSyncDebugInfo(workflowId: string) {
  return {
    hasChanges: changeTracker.hasChanges(workflowId),
    pendingChanges: changeTracker.getPendingChanges(workflowId).length,
    changesSummary: changeTracker.getChangesSummary(workflowId),
    clientId: changeTracker.getClientId(),
    sessionId: changeTracker.getSessionId(),
  }
}
