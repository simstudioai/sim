import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

interface General {
  isAutoConnectEnabled: boolean
  isDebugModeEnabled: boolean
  theme: 'light' | 'dark'
}

interface GeneralActions {
  toggleAutoConnect: () => void
  toggleDebugMode: () => void
  setTheme: (theme: 'light' | 'dark') => void
}

type GeneralStore = General & GeneralActions

export const useGeneralStore = create<GeneralStore>()(
  devtools(
    persist(
      (set) => ({
        isAutoConnectEnabled: true,
        isDebugModeEnabled: false,
        theme: 'light',
        toggleAutoConnect: () =>
          set((state) => ({ isAutoConnectEnabled: !state.isAutoConnectEnabled })),
        toggleDebugMode: () => set((state) => ({ isDebugModeEnabled: !state.isDebugModeEnabled })),
        setTheme: (theme: 'light' | 'dark') => set({ theme }),
      }),
      {
        name: 'general-settings',
      }
    ),
    { name: 'general-store' }
  )
)
