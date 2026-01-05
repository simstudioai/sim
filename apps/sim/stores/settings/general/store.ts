import { createLogger } from '@sim/logger'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { General, GeneralStore } from './types'

const logger = createLogger('GeneralStore')

const initialState: General = {
  isAutoConnectEnabled: true,
  showTrainingControls: false,
  superUserModeEnabled: true,
  theme: 'system',
  telemetryEnabled: true,
  isBillingUsageNotificationsEnabled: true,
  isErrorNotificationsEnabled: true,
  snapToGridSize: 0,
}

export const useGeneralStore = create<GeneralStore>()(
  devtools(
    (set) => ({
      ...initialState,
      setSettings: (settings) => {
        logger.debug('Updating general settings store', {
          keys: Object.keys(settings),
        })
        set((state) => ({
          ...state,
          ...settings,
        }))
      },
      reset: () => set(initialState),
    }),
    { name: 'general-store' }
  )
)
