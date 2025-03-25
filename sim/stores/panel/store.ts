import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { PanelStore, PanelTab } from './types'

export const usePanelStore = create<PanelStore>()(
  devtools(
    persist(
      (set) => ({
        isOpen: false,
        activeTab: 'console',

        togglePanel: () => {
          set((state) => ({ isOpen: !state.isOpen }))
        },

        setActiveTab: (tab: PanelTab) => {
          set({ activeTab: tab })
        },
      }),
      {
        name: 'panel-store',
      }
    )
  )
) 