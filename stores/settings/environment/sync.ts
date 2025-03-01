// Environment store sync implementation
import { SyncManager, createSyncManager } from '@/stores/sync'
import { useEnvironmentStore } from './store'

// API endpoint for environment variables
const ENVIRONMENT_ENDPOINT = '/api/db/environment'

/**
 * Prepares environment variables payload for API submission
 * @returns {Object} Formatted payload with variables in the expected API format
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
 * Environment variables sync manager instance
 * Configured for event-based syncing without intervals or exit syncing
 */
export const environmentSyncManager: SyncManager = createSyncManager({
  endpoint: ENVIRONMENT_ENDPOINT,
  preparePayload: prepareEnvironmentPayload,
  syncInterval: null, // No interval syncing
  syncOnExit: false, // No exit syncing

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
 * @returns {Promise<boolean>} Success status of the sync operation
 */
export async function syncEnvironmentVariables(): Promise<boolean> {
  return environmentSyncManager.sync()
}
