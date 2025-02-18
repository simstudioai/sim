import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

interface General {
  isAutoConnectEnabled: boolean
  isDebugModeEnabled: boolean
}

interface GeneralActions {
  toggleAutoConnect: () => void
  toggleDebugMode: () => void
}

type GeneralStore = General & GeneralActions

export const useGeneralStore = create<GeneralStore>()(
  devtools(
    persist(
      (set) => ({
        isAutoConnectEnabled: true,
        isDebugModeEnabled: false,
        toggleAutoConnect: () =>
          set((state) => ({ isAutoConnectEnabled: !state.isAutoConnectEnabled })),
        toggleDebugMode: () => set((state) => ({ isDebugModeEnabled: !state.isDebugModeEnabled })),
      }),
      {
        name: 'general-settings',
      }
    ),
    { name: 'general-store' }
  )
)
