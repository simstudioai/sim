import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('SyncCore')

/**
 * Core sync types and utilities for optimistic state synchronization
 */

/**
 * Simple utility to check if we're in localStorage mode
 * This is the single source of truth for this check
 */
export function isLocalStorageMode(): boolean {
  if (typeof window === 'undefined') return false

  return (
    localStorage.getItem('USE_LOCAL_STORAGE') === 'true' ||
    process.env.USE_LOCAL_STORAGE === 'true' ||
    process.env.NEXT_PUBLIC_USE_LOCAL_STORAGE === 'true' ||
    process.env.DISABLE_DB_SYNC === 'true'
  )
}

// Configuration for a sync operation
export interface SyncConfig {
  // Required configuration
  endpoint: string
  preparePayload: () => Promise<any> | any
  method?: 'GET' | 'POST' | 'DELETE' | 'PUT'

  // Sync triggers
  syncOnInterval?: boolean
  syncOnExit?: boolean

  // Optional configuration
  syncInterval?: number
  onSyncSuccess?: (response: any) => void
  onSyncError?: (error: any) => void

  // Enhanced retry configuration
  maxRetries?: number
  retryBackoff?: number
}

export const DEFAULT_SYNC_CONFIG: Partial<SyncConfig> = {
  syncOnInterval: true,
  syncOnExit: true,
  syncInterval: 30000, // 30 seconds
  maxRetries: 3,
  retryBackoff: 1000, // Start with 1 second, will increase exponentially
}

// Core sync operations interface
export interface SyncOperations {
  sync: () => void
  startIntervalSync: () => void
  stopIntervalSync: () => void
}

// Sync state tracking to prevent concurrent sync operations
const syncState = {
  inProgress: new Map<string, boolean>(),
  lastSyncTime: new Map<string, number>(),
}

// Returns true if a particular endpoint is currently syncing
export function isSyncing(endpoint: string): boolean {
  return syncState.inProgress.get(endpoint) === true
}

// Returns the timestamp of the last successful sync for an endpoint
export function getLastSyncTime(endpoint: string): number | undefined {
  return syncState.lastSyncTime.get(endpoint)
}

// Performs sync operation with automatic retry
export async function performSync(config: SyncConfig): Promise<boolean> {
  // Skip if sync already in progress for this endpoint
  if (syncState.inProgress.get(config.endpoint)) {
    logger.info(`Sync skipped - already in progress for ${config.endpoint}`)
    return true
  }

  // Mark sync as in progress
  syncState.inProgress.set(config.endpoint, true)

  try {
    // In localStorage mode, just return success immediately - no need to sync to server
    if (isLocalStorageMode()) {
      // Still call onSyncSuccess to maintain expected behavior
      if (config.onSyncSuccess) {
        config.onSyncSuccess({
          success: true,
          message: 'Skipped sync in localStorage mode',
        })
      }

      // Update last sync time
      syncState.lastSyncTime.set(config.endpoint, Date.now())
      return true
    }

    // Get the payload to sync
    const payload = await Promise.resolve(config.preparePayload())

    // Skip sync if the payload indicates it should be skipped
    if (payload && payload.skipSync === true) {
      // Release lock and return success
      syncState.inProgress.set(config.endpoint, false)
      return true
    }

    // Normal API sync flow with retries
    const result = await sendWithRetry(config.endpoint, payload, config)

    // If successful, update last sync time
    if (result) {
      syncState.lastSyncTime.set(config.endpoint, Date.now())
    }

    return result
  } catch (error) {
    if (config.onSyncError) {
      config.onSyncError(error)
    }
    logger.error(`Sync error for ${config.endpoint}: ${error}`)
    return false
  } finally {
    // Always release the lock when done
    syncState.inProgress.set(config.endpoint, false)
  }
}

// Sends data to endpoint with configurable retries
async function sendWithRetry(endpoint: string, payload: any, config: SyncConfig): Promise<boolean> {
  const maxRetries = config.maxRetries || DEFAULT_SYNC_CONFIG.maxRetries || 3
  const baseBackoff = config.retryBackoff || DEFAULT_SYNC_CONFIG.retryBackoff || 1000

  let lastError: Error | null = null

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const startTime = Date.now()
      const result = await sendRequest(endpoint, payload, config)
      const elapsed = Date.now() - startTime

      if (result) {
        // Only log retries if they happened
        if (attempt > 0) {
          logger.info(`Sync succeeded on attempt ${attempt + 1} for ${endpoint} after ${elapsed}ms`)
        }
        return true
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      // Calculate exponential backoff with jitter
      const jitter = Math.random() * 0.3 + 0.85 // Random between 0.85 and 1.15
      const backoff = baseBackoff * Math.pow(2, attempt) * jitter

      logger.warn(
        `Sync attempt ${attempt + 1}/${maxRetries} failed for ${endpoint}. Retrying in ${Math.round(backoff)}ms: ${lastError.message}`
      )

      // Only wait if we're going to retry
      if (attempt < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, backoff))
      }
    }
  }

  // If we got here, all retries failed
  if (lastError) {
    if (config.onSyncError) {
      config.onSyncError(lastError)
    }
    logger.error(`All ${maxRetries} sync attempts failed for ${endpoint}: ${lastError.message}`)
  }

  return false
}

// Sends a single request to the endpoint
async function sendRequest(endpoint: string, payload: any, config: SyncConfig): Promise<boolean> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 30000) // 30 second timeout

  try {
    const response = await fetch(endpoint, {
      method: config.method || 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: config.method !== 'GET' ? JSON.stringify(payload) : undefined,
      signal: controller.signal,
      // Add cache control for GET requests to prevent caching
      cache: config.method === 'GET' ? 'no-store' : undefined,
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Failed to read error response')
      throw new Error(`Sync failed: ${response.status} ${response.statusText} - ${errorText}`)
    }

    const data = await response.json()

    if (config.onSyncSuccess) {
      config.onSyncSuccess(data)
    }

    return true
  } catch (error) {
    // Handle abort (timeout) explicitly
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`Sync request timed out after 30 seconds`)
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}
