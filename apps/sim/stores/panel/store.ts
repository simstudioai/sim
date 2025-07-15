import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import type { PanelStore, PanelTab } from './types'

export const usePanelStore = create<PanelStore>()(
  devtools(
    persist(
      (set) => ({
        isOpen: false,
        activeTab: 'console',
        panelWidth: 308,

        togglePanel: () => {
          set((state) => ({ isOpen: !state.isOpen }))
        },

        setActiveTab: (tab: PanelTab) => {
          set({ activeTab: tab })
        },

        setPanelWidth: (width: number) => {
          // Ensure minimum width of 308px and maximum of 500px
          const clampedWidth = Math.max(308, Math.min(500, width))
          set({ panelWidth: clampedWidth })
        },
      }),
      {
        name: 'panel-store',
      }
    )
  )
)
