import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { environmentSync } from './sync'
import { EnvironmentStore, EnvironmentVariable } from './types'

export const useEnvironmentStore = create<EnvironmentStore>()(
  persist(
    (set, get) => ({
      variables: {},

      setVariables: (variables: Record<string, string>) => {
        set({
          variables: Object.entries(variables).reduce(
            (acc, [key, value]) => ({
              ...acc,
              [key]: { key, value },
            }),
            {}
          ),
        })
        environmentSync.sync()
      },

      getVariable: (key: string): string | undefined => {
        return get().variables[key]?.value
      },

      getAllVariables: (): Record<string, EnvironmentVariable> => {
        return get().variables
      },
    }),
    {
      name: 'environment-store',
    }
  )
)
