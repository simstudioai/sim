'use client'

import { API_ENDPOINTS } from '../../constants'
import { createSingletonSyncManager } from '../../sync'
import { useEnvironmentStore } from './store'
import { EnvironmentVariable } from './types'

// Flag to prevent immediate sync back to DB after loading from DB
let isLoadingFromDB = false

// Function to fetch environment variables from the DB and update the store
export async function fetchEnvironmentVariables(): Promise<void> {
  if (typeof window === 'undefined') return

  try {
    // Set flag to prevent sync back to DB during loading
    isLoadingFromDB = true

    // Call the API endpoint directly - session handling is now done in the API route
    const response = await fetch(API_ENDPOINTS.ENVIRONMENT)

    if (!response.ok) {
      // Handle unauthorized or other errors
      if (response.status === 401) {
        console.warn('User not authenticated for environment variables')
        return
      }

      console.error('Failed to fetch environment variables:', response.statusText)
      return
    }

    const { data } = await response.json()

    if (data && Object.keys(data).length > 0) {
      // Convert the DB format to the format expected by setVariables
      const formattedVariables = Object.entries(data).reduce((acc, [key, envVar]) => {
        const variable = envVar as EnvironmentVariable
        return {
          ...acc,
          [key]: variable.value,
        }
      }, {})

      // Update the local store with the fetched variables
      useEnvironmentStore.getState().setVariables(formattedVariables)

      console.log('Environment variables loaded from DB')
    }
  } catch (error) {
    console.error('Error fetching environment variables:', error)
  } finally {
    // Reset the flag after a short delay to allow state to settle
    setTimeout(() => {
      isLoadingFromDB = false
    }, 500)
  }
}

export const environmentSync = createSingletonSyncManager('environment-sync', () => ({
  endpoint: API_ENDPOINTS.ENVIRONMENT,
  preparePayload: () => {
    if (typeof window === 'undefined') return {}

    // Skip sync if we're currently loading from DB to prevent overwriting DB data
    if (isLoadingFromDB) {
      console.log('Skipping environment sync while loading from DB')
      return { skipSync: true }
    }

    // Get all environment variables
    const variables = useEnvironmentStore.getState().variables

    // Skip sync if there are no variables to sync
    if (Object.keys(variables).length === 0) {
      console.log('Skipping environment sync - no variables to sync')
      return { skipSync: true }
    }

    return {
      variables: Object.entries(variables).reduce(
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
  onSyncSuccess: (data) => {
    console.log('Environment variables synced to DB successfully')
  },
}))
