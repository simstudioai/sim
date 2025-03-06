'use client'

import { environmentSync, fetchEnvironmentVariables } from './settings/environment/sync'
import { SyncManager } from './sync'
import { isLocalStorageMode } from './sync-core'
import { fetchWorkflowsFromDB, workflowSync } from './workflows/sync'

// Initialize managers lazily
let initialized = false
let initializing = false
let managers: SyncManager[] = []

/**
 * Initialize sync managers and fetch data from DB
 * Returns a promise that resolves when initialization is complete
 *
 * Note: Workflow scheduling is handled automatically by the workflowSync manager
 * when workflows are synced to the database. The scheduling logic checks if a
 * workflow has scheduling enabled in its starter block and updates the schedule
 * accordingly.
 */
export async function initializeSyncManagers(): Promise<boolean> {
  if (typeof window === 'undefined') return false

  // If already initialized, return immediately
  if (initialized) return true

  // If currently initializing, wait for it to complete
  if (initializing) {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (initialized) {
          clearInterval(checkInterval)
          resolve(true)
        }
      }, 100)
    })
  }

  initializing = true
  managers = [workflowSync, environmentSync]

  try {
    // Use our centralized function to check for localStorage mode
    if (isLocalStorageMode()) {
      console.log('Running in local storage mode - skipping DB sync')
      // In local storage mode, we don't need to fetch from DB
      // Just load from localStorage directly
      initialized = true
      return true
    }

    // Fetch data from DB on initialization to replace local storage
    await Promise.all([
      fetchEnvironmentVariables(),
      fetchWorkflowsFromDB(),
      // Add other fetch functions here as needed for other stores
    ])

    initialized = true
    return true
  } catch (error) {
    console.error('Error initializing sync managers:', error)
    // Even if there's an error, mark as initialized so the app can continue
    initialized = true
    return false
  } finally {
    initializing = false
  }
}

/**
 * Check if the sync system is initialized
 */
export function isSyncInitialized(): boolean {
  return initialized
}

export function getSyncManagers(): SyncManager[] {
  // Return the current managers regardless of initialization state
  // This ensures we don't block the UI while fetching data
  return managers
}

/**
 * Reset all sync managers
 * This is used during sign-out to ensure clean state for the next user
 */
export function resetSyncManagers(): void {
  // Dispose all existing managers
  managers.forEach((manager) => manager.dispose())

  // Reset the managers array
  managers = []

  // Reset initialization flags
  initialized = false
  initializing = false
}

// Export individual sync managers for direct use
export { workflowSync, environmentSync }
