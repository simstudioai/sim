import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { syncEnvironmentVariables, syncEnvironmentVariablesWithResult } from './sync'
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

      sync: () => {
        // Use fire-and-forget pattern for optimistic updates
        syncEnvironmentVariables()
        // Return a resolved promise with true to maintain the expected return type
        return Promise.resolve(true)
      },

      // Add a method that returns a promise for cases where we need to wait
      syncWithResult: async () => {
        return await syncEnvironmentVariablesWithResult()
      },
    }),
    {
      name: 'environment-store',
    }
  )
)
