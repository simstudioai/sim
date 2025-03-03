'use client'

import { environmentSync } from './settings/environment/sync'
import { SyncManager } from './sync'
import { workflowSync } from './workflows/sync'

// Initialize managers lazily
let initialized = false
let managers: SyncManager[] = []

export function initializeSyncManagers() {
  if (typeof window === 'undefined' || initialized) return

  managers = [workflowSync, environmentSync]
  initialized = true
}

export function getSyncManagers(): SyncManager[] {
  if (!initialized) {
    initializeSyncManagers()
  }
  return managers
}

// Export individual sync managers for direct use
export { workflowSync, environmentSync }
