'use client'

import { environmentSync, fetchEnvironmentVariables } from './settings/environment/sync'
import { SyncManager } from './sync'
import { workflowSync } from './workflows/sync'

// Initialize managers lazily
let initialized = false
let initializing = false
let managers: SyncManager[] = []

export async function initializeSyncManagers() {
  if (typeof window === 'undefined' || initialized || initializing) return

  initializing = true
  managers = [workflowSync, environmentSync]

  try {
    // Fetch data from DB on initialization to replace local storage
    await Promise.all([
      fetchEnvironmentVariables(),
      // Add other fetch functions here as needed for other stores
    ])

    initialized = true
  } catch (error) {
    console.error('Error initializing data from DB:', error)
  } finally {
    initializing = false
  }
}

export function getSyncManagers(): SyncManager[] {
  // Return the current managers regardless of initialization state
  // This ensures we don't block the UI while fetching data
  return managers
}

// Export individual sync managers for direct use
export { workflowSync, environmentSync }
