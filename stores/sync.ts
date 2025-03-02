// Core sync manager for all stores
import { useEffect, useRef } from 'react'

// Debounce configuration
interface DebounceConfig {
  delay: number
  maxWait?: number
}

// Default debounce settings
const DEFAULT_DEBOUNCE: DebounceConfig = {
  delay: 1000, // 1 second default delay
  maxWait: 5000, // 5 seconds maximum wait time
}

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
  debounce?: DebounceConfig | boolean // Debounce configuration or true for defaults
}

export interface SyncManager {
  sync: () => Promise<boolean>
  startIntervalSync: () => void
  stopIntervalSync: () => void
  debouncedSync: () => Promise<boolean> // Debounced sync method
  fireAndForgetSync: () => void // New optimistic sync method
}

// Global registry of sync managers
const syncManagers: SyncManager[] = []

// Debounce utility function
function createDebouncedFunction(
  fn: () => Promise<any>,
  { delay, maxWait = delay * 5 }: DebounceConfig
) {
  let timeoutId: NodeJS.Timeout | null = null
  let lastCallTime = 0
  let lastInvokeTime = 0
  let pendingPromise: Promise<any> | null = null
  let pendingResolve: ((value: any) => void) | null = null
  let pendingReject: ((reason?: any) => void) | null = null

  // Function to clear timeout
  const clearDebounceTimeout = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
  }

  // Function to invoke the original function
  const invoke = () => {
    const time = Date.now()
    lastInvokeTime = time

    const result = fn()

    if (pendingResolve) {
      pendingResolve(result)
      pendingPromise = null
      pendingResolve = null
      pendingReject = null
    }

    return result
  }

  // Function to handle the timeout
  const timeoutFunc = () => {
    const timeSinceLastCall = Date.now() - lastCallTime

    if (timeSinceLastCall >= delay) {
      clearDebounceTimeout()
      invoke()
    } else {
      // More time needed, schedule another timeout
      timeoutId = setTimeout(timeoutFunc, delay - timeSinceLastCall)
    }
  }

  // The debounced function
  const debounced = () => {
    lastCallTime = Date.now()
    const timeSinceLastInvoke = lastCallTime - lastInvokeTime

    // Clear any existing timeout
    clearDebounceTimeout()

    // Create a new promise if there isn't one pending
    if (!pendingPromise) {
      pendingPromise = new Promise((resolve, reject) => {
        pendingResolve = resolve
        pendingReject = reject
      })
    }

    // If we've waited longer than maxWait, invoke immediately
    if (maxWait !== undefined && timeSinceLastInvoke >= maxWait) {
      invoke()
    } else {
      // Otherwise set a new timeout
      timeoutId = setTimeout(timeoutFunc, delay)
    }

    return pendingPromise
  }

  // Add a method to cancel the debounced call
  debounced.cancel = () => {
    clearDebounceTimeout()
    if (pendingReject) {
      pendingReject(new Error('Debounced function canceled'))
      pendingPromise = null
      pendingResolve = null
      pendingReject = null
    }
  }

  return debounced
}

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
    debounce = false,
  } = config

  let intervalId: NodeJS.Timeout | null = null

  // Core sync function
  const syncImpl = async (): Promise<boolean> => {
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

  // Create debounced version if configured
  const debounceConfig = debounce === true ? DEFAULT_DEBOUNCE : debounce ? debounce : null

  const debouncedSyncImpl = debounceConfig
    ? createDebouncedFunction(syncImpl, debounceConfig)
    : null

  // Public sync method - uses debounced version if available
  const sync = async (): Promise<boolean> => {
    return await syncImpl()
  }

  // Public debounced sync method
  const debouncedSync = async (): Promise<boolean> => {
    if (debouncedSyncImpl) {
      return await debouncedSyncImpl()
    }
    return await syncImpl()
  }

  // Fire and forget sync - optimistic update pattern
  // This method doesn't wait for the response and doesn't return a promise
  const fireAndForgetSync = (): void => {
    // Use setTimeout to move the sync operation to the next event loop tick
    // This ensures the UI update completes before any sync work begins
    setTimeout(async () => {
      try {
        if (!shouldSync()) return

        const payload = await preparePayload()
        if (!payload) return

        // Use fetch with keepalive to ensure the request completes
        // even if the page is unloaded
        fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          keepalive: true,
        })
          .then((response) => {
            if (!response.ok) {
              if (response.status === 401) {
                // Don't redirect immediately for fire-and-forget
                console.error('Authentication required for sync')
                return
              }
              throw new Error(`Sync failed: ${response.statusText}`)
            }
            return response.json()
          })
          .then((data) => {
            onSyncSuccess(data)
          })
          .catch((error) => {
            onSyncError(error)
          })
      } catch (error) {
        onSyncError(error)
      }
    }, 0)
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
    debouncedSync,
    fireAndForgetSync,
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
        await manager.sync() // Use immediate sync
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
