import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

interface General {
  isAutoConnectEnabled: boolean
  isDebugModeEnabled: boolean
  theme: 'system' | 'light' | 'dark'
}

interface GeneralActions {
  toggleAutoConnect: () => void
  toggleDebugMode: () => void
  setTheme: (theme: 'system' | 'light' | 'dark') => void
}

type GeneralStore = General & GeneralActions

export const useGeneralStore = create<GeneralStore>()(
  devtools(
    persist(
      (set) => ({
        isAutoConnectEnabled: true,
        isDebugModeEnabled: false,
        theme: 'system',
        toggleAutoConnect: () =>
          set((state) => ({
            isAutoConnectEnabled: !state.isAutoConnectEnabled,
          })),
        toggleDebugMode: () => set((state) => ({ isDebugModeEnabled: !state.isDebugModeEnabled })),
        setTheme: (theme: 'system' | 'light' | 'dark') => set({ theme }),
      }),
      {
        name: 'general-settings',
      }
    ),
    { name: 'general-store' }
  )
)
