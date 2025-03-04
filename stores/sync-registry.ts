'use client'

import { environmentSync, fetchEnvironmentVariables } from './settings/environment/sync'
import { SyncManager } from './sync'
import { fetchWorkflowsFromDB, workflowSync } from './workflows/sync'

// Initialize managers lazily
let initialized = false
let initializing = false
let managers: SyncManager[] = []

/**
 * Initialize sync managers and fetch data from DB
 * Returns a promise that resolves when initialization is complete
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
    // Fetch data from DB on initialization to replace local storage
    await Promise.all([
      fetchEnvironmentVariables(),
      fetchWorkflowsFromDB(),
      // Add other fetch functions here as needed for other stores
    ])

    initialized = true
    return true
  } catch (error) {
    console.error('Error initializing data from DB:', error)
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

// Export individual sync managers for direct use
export { workflowSync, environmentSync }
