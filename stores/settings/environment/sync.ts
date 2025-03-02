'use client'

import { createSingletonSyncManager } from '@/stores/sync'
import { useEnvironmentStore } from './store'

const ENVIRONMENT_ENDPOINT = '/api/db/environment'

// Prepares environment variables for sync
const prepareEnvironmentPayload = () => {
  const { variables } = useEnvironmentStore.getState()

  return {
    variables: Object.entries(variables).reduce(
      (acc, [key, value]) => ({
        ...acc,
        [key]: value.value,
      }),
      {}
    ),
  }
}

// Creates environment sync manager
export const environmentSyncManager = createSingletonSyncManager('environment', () => ({
  endpoint: ENVIRONMENT_ENDPOINT,
  preparePayload: prepareEnvironmentPayload,
  syncOnInterval: false,
  syncOnExit: true,
  onSyncError: (error) => {
    console.error('Environment sync failed:', error)
  },
}))
