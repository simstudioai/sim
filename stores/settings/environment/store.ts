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
    }),
    {
      name: 'environment-store',
    }
  )
)
