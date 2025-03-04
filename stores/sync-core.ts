/**
 * Core sync types and utilities for optimistic state synchronization
 */

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
}

export const DEFAULT_SYNC_CONFIG: Partial<SyncConfig> = {
  syncOnInterval: true,
  syncOnExit: true,
  syncInterval: 30000, // 30 seconds
}

// Core sync operations interface
export interface SyncOperations {
  sync: () => void
  startIntervalSync: () => void
  stopIntervalSync: () => void
}

// Performs sync operation with automatic retry
export async function performSync(config: SyncConfig): Promise<boolean> {
  try {
    const payload = await Promise.resolve(config.preparePayload())

    // Skip sync if the payload indicates it should be skipped
    if (payload && payload.skipSync === true) {
      return true
    }

    return await sendWithRetry(config.endpoint, payload, config)
  } catch (error) {
    if (config.onSyncError) {
      config.onSyncError(error)
    }
    return false
  }
}

// Sends data to endpoint with one retry on failure
async function sendWithRetry(endpoint: string, payload: any, config: SyncConfig): Promise<boolean> {
  try {
    const result = await sendRequest(endpoint, payload, config)
    return result
  } catch (error) {
    try {
      const retryResult = await sendRequest(endpoint, payload, config)
      return retryResult
    } catch (retryError) {
      if (config.onSyncError) {
        config.onSyncError(retryError)
      }
      return false
    }
  }
}

// Sends a single request to the endpoint
async function sendRequest(endpoint: string, payload: any, config: SyncConfig): Promise<boolean> {
  const response = await fetch(endpoint, {
    method: config.method || 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: config.method !== 'GET' ? JSON.stringify(payload) : undefined,
  })

  if (!response.ok) {
    throw new Error(`Sync failed: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()

  if (config.onSyncSuccess) {
    config.onSyncSuccess(data)
  }

  return true
}
