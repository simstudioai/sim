import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { EnvironmentStore, EnvironmentVariable } from './types'

export const useEnvironmentStore = create<EnvironmentStore>()(
  persist(
    (set, get) => ({
      variables: {},

      setVariable: (key: string, value: string) => {
        set((state: EnvironmentStore) => ({
          variables: {
            ...state.variables,
            [key]: { key, value },
          },
        }))
      },

      removeVariable: (key: string) => {
        set((state: EnvironmentStore) => {
          const { [key]: _, ...rest } = state.variables
          return { variables: rest }
        })
      },

      clearVariables: () => {
        set({ variables: {} })
      },

      getVariable: (key: string) => {
        return get().variables[key]?.value
      },

      getAllVariables: () => {
        return get().variables
      },

      syncWithDatabase: async () => {
        const variables = get().variables
        const variableValues = Object.entries(variables).reduce(
          (acc, [key, value]) => ({
            ...acc,
            [key]: value.value,
          }),
          {}
        )

        try {
          const response = await fetch('/api/settings/environment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ variables: variableValues }),
          })

          if (!response.ok) {
            throw new Error('Failed to sync environment variables')
          }
        } catch (error) {
          console.error('Error syncing environment variables:', error)
          throw error
        }
      },
    }),
    {
      name: 'environment-store',
    }
  )
)
