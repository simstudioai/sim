// Core sync manager for all stores
import { useEffect, useRef } from 'react'

export interface SyncConfig {
  // Required configuration
  endpoint: string
  preparePayload: () => Promise<any> | any

  // Optional configuration with defaults
  syncInterval?: number | null // null means no interval sync
  syncOnExit?: boolean
  onSyncSuccess?: (response: any) => void
  onSyncError?: (error: any) => void
  shouldSync?: () => boolean // Function to determine if sync should occur
}

export interface SyncManager {
  sync: () => Promise<boolean>
  startIntervalSync: () => void
  stopIntervalSync: () => void
}

// Global registry of sync managers
const syncManagers: SyncManager[] = []

// Create a sync manager for a specific store
export function createSyncManager(config: SyncConfig): SyncManager {
  const {
    endpoint,
    preparePayload,
    syncInterval = null,
    syncOnExit = false,
    onSyncSuccess = () => {},
    onSyncError = (error) => console.error('Sync error:', error),
    shouldSync = () => true,
  } = config

  let intervalId: NodeJS.Timeout | null = null

  // Core sync function
  const sync = async (): Promise<boolean> => {
    try {
      // Check if sync should proceed
      if (!shouldSync()) {
        return false
      }

      // Prepare the payload
      const payload = await preparePayload()
      if (!payload) {
        return false
      }

      // Send to server
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      })

      // Handle response
      if (!response.ok) {
        if (response.status === 401) {
          window.location.href = '/login'
          return false
        }
        throw new Error(`Sync failed: ${response.statusText}`)
      }

      const data = await response.json()
      onSyncSuccess(data)
      return true
    } catch (error) {
      onSyncError(error)
      return false
    }
  }

  // Start interval sync
  const startIntervalSync = () => {
    if (syncInterval && !intervalId) {
      intervalId = setInterval(sync, syncInterval)
    }
  }

  // Stop interval sync
  const stopIntervalSync = () => {
    if (intervalId) {
      clearInterval(intervalId)
      intervalId = null
    }
  }

  // Create the sync manager instance
  const syncManager: SyncManager = {
    sync,
    startIntervalSync,
    stopIntervalSync,
  }

  // Register this sync manager globally
  syncManagers.push(syncManager)

  return syncManager
}

// Initialize all sync managers
export function initializeSyncSystem(): () => void {
  if (typeof window === 'undefined') return () => {}

  // Set up beforeunload handler for exit syncing
  const handleBeforeUnload = async (event: BeforeUnloadEvent) => {
    // Collect all sync promises that need to run on exit
    const syncPromises = syncManagers.map(async (manager) => {
      try {
        await manager.sync()
      } catch (error) {
        console.error('Exit sync error:', error)
      }
    })

    // If there are sync operations pending, delay page unload
    if (syncPromises.length > 0) {
      event.preventDefault()
      event.returnValue = ''

      // Try to sync everything before unload
      await Promise.allSettled(syncPromises)
    }
  }

  // Add event listener
  window.addEventListener('beforeunload', handleBeforeUnload)

  // Start all interval syncs
  syncManagers.forEach((manager) => manager.startIntervalSync())

  // Return cleanup function
  return () => {
    window.removeEventListener('beforeunload', handleBeforeUnload)
    syncManagers.forEach((manager) => manager.stopIntervalSync())
  }
}

// React hook for components to use sync managers
export function useSyncManager(config: SyncConfig): SyncManager {
  const syncManagerRef = useRef<SyncManager | null>(null)

  if (!syncManagerRef.current) {
    syncManagerRef.current = createSyncManager(config)
  }

  useEffect(() => {
    const syncManager = syncManagerRef.current!

    // Start interval sync if configured
    if (config.syncInterval) {
      syncManager.startIntervalSync()
    }

    // Clean up on unmount
    return () => {
      syncManager.stopIntervalSync()
    }
  }, [config.syncInterval])

  return syncManagerRef.current
}
