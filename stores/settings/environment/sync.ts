import { SyncManager, createSyncManager } from '@/stores/sync'
import { useEnvironmentStore } from './store'

// API endpoint for environment variables
const ENVIRONMENT_ENDPOINT = '/api/db/environment'

/**
 * Prepares the environment variables payload for syncing
 * Transforms the store's variable format to the API expected format
 */
const prepareEnvironmentPayload = () => {
  const { variables } = useEnvironmentStore.getState()

  // Convert from store format to API format
  // API expects { variables: Record<string, string> }
  const variableValues = Object.entries(variables).reduce(
    (acc, [key, value]) => ({
      ...acc,
      [key]: value.value,
    }),
    {}
  )

  return { variables: variableValues }
}

/**
 * Creates a sync manager instance for environment variables
 * This sync manager is designed for event-based syncing with debouncing
 */
export const environmentSyncManager: SyncManager = createSyncManager({
  endpoint: ENVIRONMENT_ENDPOINT,
  preparePayload: prepareEnvironmentPayload,
  syncInterval: null, // No interval syncing
  syncOnExit: true, // Sync on exit to prevent data loss

  // Configure debouncing for environment variables
  debounce: {
    delay: 800, // 800ms delay is responsive yet efficient
    maxWait: 3000, // Maximum 3 seconds before forced sync
  },

  // Optional handlers
  onSyncSuccess: () => {
    console.debug('Environment variables synced successfully')
  },
  onSyncError: (error) => {
    console.error('Failed to sync environment variables:', error)
  },

  // Only sync if there are variables to sync
  shouldSync: () => {
    const { variables } = useEnvironmentStore.getState()
    return Object.keys(variables).length > 0
  },
})

/**
 * Syncs environment variables with the database
 * Uses optimistic updates - doesn't wait for server response
 */
export function syncEnvironmentVariables(): void {
  environmentSyncManager.fireAndForgetSync()
}

/**
 * Syncs environment variables with the database
 * Returns a promise for cases where you need to know the result
 */
export async function syncEnvironmentVariablesWithResult(): Promise<boolean> {
  return environmentSyncManager.sync()
}
