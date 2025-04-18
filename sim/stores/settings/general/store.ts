import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { GeneralStore } from './types'

export const useGeneralStore = create<GeneralStore>()(
  devtools(
    persist(
      (set) => ({
        isAutoConnectEnabled: true,
        isDebugModeEnabled: false,
        isAutoFillEnvVarsEnabled: true,
        toggleAutoConnect: () =>
          set((state) => ({
            isAutoConnectEnabled: !state.isAutoConnectEnabled,
          })),
        toggleDebugMode: () => set((state) => ({ isDebugModeEnabled: !state.isDebugModeEnabled })),
        toggleAutoFillEnvVars: () =>
          set((state) => ({ isAutoFillEnvVarsEnabled: !state.isAutoFillEnvVarsEnabled })),
      }),
      {
        name: 'general-settings',
      }
    ),
    { name: 'general-store' }
  )
)
