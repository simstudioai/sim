import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

interface General {
  isAutoConnectEnabled: boolean
}

interface GeneralActions {
  toggleAutoConnect: () => void
}

type GeneralStore = General & GeneralActions

export const useGeneralStore = create<GeneralStore>()(
  devtools(
    persist(
      (set) => ({
        isAutoConnectEnabled: true,

        toggleAutoConnect: () =>
          set((state) => ({ isAutoConnectEnabled: !state.isAutoConnectEnabled })),
      }),
      {
        name: 'general-settings',
      }
    ),
    { name: 'general-store' }
  )
)
