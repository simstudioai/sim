/**
 * Core sync types and utilities for optimistic state synchronization
 */

// Configuration for a sync operation
export interface SyncConfig {
  // Required configuration
  endpoint: string
  preparePayload: () => Promise<any> | any

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
    return await sendWithRetry(config.endpoint, payload, config)
  } catch (error) {
    if (config.onSyncError) {
      config.onSyncError(error)
    }
    console.error('Sync error:', error)
    return false
  }
}

// Sends data to endpoint with one retry on failure
async function sendWithRetry(endpoint: string, payload: any, config: SyncConfig): Promise<boolean> {
  try {
    const result = await sendRequest(endpoint, payload, config)
    return result
  } catch (error) {
    console.warn('Sync failed, retrying once:', error)
    try {
      const retryResult = await sendRequest(endpoint, payload, config)
      return retryResult
    } catch (retryError) {
      throw retryError
    }
  }
}

// Sends a single request to the endpoint
async function sendRequest(endpoint: string, payload: any, config: SyncConfig): Promise<boolean> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
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
