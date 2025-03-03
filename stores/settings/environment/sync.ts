'use client'

import { API_ENDPOINTS } from '../../constants'
import { createSingletonSyncManager } from '../../sync'
import { useEnvironmentStore } from './store'

export const environmentSync = createSingletonSyncManager('environment-sync', () => ({
  endpoint: API_ENDPOINTS.ENVIRONMENT,
  preparePayload: () => {
    if (typeof window === 'undefined') return {}

    return {
      variables: Object.entries(useEnvironmentStore.getState().variables).reduce(
        (acc, [key, value]) => ({
          ...acc,
          [key]: value.value,
        }),
        {}
      ),
    }
  },
  syncOnInterval: true,
  syncOnExit: true,
}))
