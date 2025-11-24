import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console/logger'
import type { CustomToolsState, CustomToolsStore } from '@/stores/custom-tools/types'

const logger = createLogger('CustomToolsStore')

const initialState: CustomToolsState = {
  tools: [],
}

export const useCustomToolsStore = create<CustomToolsStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      setTools: (tools) => {
        logger.info(`Synced ${tools.length} custom tools`)
        set({ tools })
      },

      getTool: (id: string) => {
        return get().tools.find((tool) => tool.id === id)
      },

      getAllTools: () => {
        return get().tools
      },

      reset: () => set(initialState),
    }),
    {
      name: 'custom-tools-store',
    }
  )
)
