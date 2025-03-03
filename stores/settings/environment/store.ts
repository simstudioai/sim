import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { environmentSync } from './sync'
import { EnvironmentStore } from './types'

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

      getVariable: (key: string) => {
        return get().variables[key]?.value
      },
    }),
    {
      name: 'environment-store',
    }
  )
)
