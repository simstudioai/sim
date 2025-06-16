'use client'

import { createLogger } from '@/lib/logs/console-logger'
import type { SyncManager } from './sync'
import { fetchWorkflowsFromDB, workflowSync } from './workflows/sync'

const logger = createLogger('SyncRegistry')

// Initialize managers lazily
let initialized = false
let initializing = false
let managers: SyncManager[] = []

/**
 * Simplified sync managers initialization
 */
export async function initializeSyncManagers(): Promise<boolean> {
  // Skip if already initialized or initializing
  if (initialized || initializing) {
    return initialized
  }

  initializing = true

  try {
    // Initialize sync managers
    managers = [workflowSync]

    // Fetch data from DB
    try {
      await fetchWorkflowsFromDB()
      logger.info('Workflows loaded from database')
    } catch (error) {
      logger.error('Error fetching data from DB:', error)
    }

    initialized = true
    return true
  } catch (error) {
    logger.error('Error initializing sync managers:', error)
    return false
  } finally {
    initializing = false
  }
}

/**
 * Force resync all managers
 */
export function forceSyncAll(): void {
  if (!initialized) {
    logger.warn('Sync managers not initialized, cannot force sync')
    return
  }

  managers.forEach((manager) => {
    try {
      manager.sync()
    } catch (error) {
      logger.error('Error forcing sync for manager:', error)
    }
  })
}

/**
 * Dispose all sync managers
 */
export function disposeSyncManagers(): void {
  managers.forEach((manager) => {
    try {
      manager.dispose()
    } catch (error) {
      logger.error('Error disposing sync manager:', error)
    }
  })

  managers = []
  initialized = false
  initializing = false
}
