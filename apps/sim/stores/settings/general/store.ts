import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console/logger'
import type { General, GeneralStore } from '@/stores/settings/general/types'

const logger = createLogger('GeneralStore')

const initialState: General = {
  isAutoConnectEnabled: true,
  isAutoPanEnabled: true,
  isConsoleExpandedByDefault: true,
  showFloatingControls: true,
  showTrainingControls: false,
  superUserModeEnabled: true,
  theme: 'system',
  telemetryEnabled: true,
  isBillingUsageNotificationsEnabled: true,
  isErrorNotificationsEnabled: true,
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
