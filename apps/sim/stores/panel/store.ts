import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import type { PanelStore, PanelTab } from '@/stores/panel/types'

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
          // Ensure minimum width of 308px and maximum of 800px
          const clampedWidth = Math.max(308, Math.min(800, width))
          set({ panelWidth: clampedWidth })
        },
      }),
      {
        name: 'panel-store',
      }
    )
  )
)
