import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console/logger'
// COMMENTED OUT: Theme switching disabled - dark mode is forced for workspace
// import { syncThemeToNextThemes } from '@/lib/theme-sync'
import { withOptimisticUpdate } from '@/lib/utils'
import type { General, GeneralStore, UserSettings } from '@/stores/settings/general/types'

const logger = createLogger('GeneralStore')

const CACHE_TIMEOUT = 3600000 // 1 hour - settings rarely change
const MAX_ERROR_RETRIES = 2

export const useGeneralStore = create<GeneralStore>()(
  devtools(
    persist(
      (set, get) => {
        let lastLoadTime = 0
        let errorRetryCount = 0
        let hasLoadedFromDb = false // Track if we've loaded from DB in this session

        const store: General = {
          isAutoConnectEnabled: true,
          isAutoPanEnabled: true,
          isConsoleExpandedByDefault: true,
          showFloatingControls: true,
          showTrainingControls: false,
          superUserModeEnabled: true,
          theme: 'system' as const, // Keep for compatibility but not used
          telemetryEnabled: true,
          isLoading: false,
          error: null,
          // Individual loading states
          isAutoConnectLoading: false,
          isAutoPanLoading: false,
          isConsoleExpandedByDefaultLoading: false,
          isThemeLoading: false, // Keep for compatibility but not used
          isTelemetryLoading: false,
          isBillingUsageNotificationsLoading: false,
          isBillingUsageNotificationsEnabled: true,
          isFloatingControlsLoading: false,
          isTrainingControlsLoading: false,
          isSuperUserModeLoading: false,
        }

        const updateSettingOptimistic = async <K extends keyof UserSettings>(
          key: K,
          value: UserSettings[K],
          loadingKey: keyof General,
          stateKey: keyof General
        ) => {
          if ((get() as any)[loadingKey]) return

          await withOptimisticUpdate({
            getCurrentState: () => (get() as any)[stateKey],
            optimisticUpdate: () => set({ [stateKey]: value, [loadingKey]: true } as any),
            apiCall: async () => {
              await get().updateSetting(key, value)
            },
            rollback: (originalValue) => set({ [stateKey]: originalValue } as any),
            onComplete: () => set({ [loadingKey]: false } as any),
            errorMessage: `Failed to update ${String(key)}, rolled back`,
          })
        }

        return {
          ...store,
          toggleAutoConnect: async () => {
            if (get().isAutoConnectLoading) return
            const newValue = !get().isAutoConnectEnabled
            await updateSettingOptimistic(
              'autoConnect',
              newValue,
              'isAutoConnectLoading',
              'isAutoConnectEnabled'
            )
          },

          toggleAutoPan: async () => {
            if (get().isAutoPanLoading) return
            const newValue = !get().isAutoPanEnabled
            await updateSettingOptimistic(
              'autoPan',
              newValue,
              'isAutoPanLoading',
              'isAutoPanEnabled'
            )
          },

          toggleConsoleExpandedByDefault: async () => {
            if (get().isConsoleExpandedByDefaultLoading) return
            const newValue = !get().isConsoleExpandedByDefault
            await updateSettingOptimistic(
              'consoleExpandedByDefault',
              newValue,
              'isConsoleExpandedByDefaultLoading',
              'isConsoleExpandedByDefault'
            )
          },

          toggleFloatingControls: async () => {
            if (get().isFloatingControlsLoading) return
            const newValue = !get().showFloatingControls
            await updateSettingOptimistic(
              'showFloatingControls',
              newValue,
              'isFloatingControlsLoading',
              'showFloatingControls'
            )
          },

          toggleTrainingControls: async () => {
            if (get().isTrainingControlsLoading) return
            const newValue = !get().showTrainingControls
            await updateSettingOptimistic(
              'showTrainingControls',
              newValue,
              'isTrainingControlsLoading',
              'showTrainingControls'
            )
          },

          toggleSuperUserMode: async () => {
            if (get().isSuperUserModeLoading) return
            const newValue = !get().superUserModeEnabled
            await updateSettingOptimistic(
              'superUserModeEnabled',
              newValue,
              'isSuperUserModeLoading',
              'superUserModeEnabled'
            )
          },

          // COMMENTED OUT: Theme switching disabled - dark mode is forced for workspace
          setTheme: async (theme) => {
            if (get().isThemeLoading) return

            // COMMENTED OUT: Dark mode is forced for workspace pages
            // await withOptimisticUpdate({
            //   getCurrentState: () => get().theme,
            //   optimisticUpdate: () => {
            //     set({ theme, isThemeLoading: true })
            //     syncThemeToNextThemes(theme)
            //   },
            //   apiCall: async () => {
            //     await get().updateSetting('theme', theme)
            //   },
            //   rollback: (originalTheme) => {
            //     set({ theme: originalTheme })
            //     syncThemeToNextThemes(originalTheme)
            //   },
            //   onComplete: () => set({ isThemeLoading: false }),
            //   errorMessage: 'Failed to sync theme to database',
            // })
          },

          setTelemetryEnabled: async (enabled) => {
            if (get().isTelemetryLoading) return
            await updateSettingOptimistic(
              'telemetryEnabled',
              enabled,
              'isTelemetryLoading',
              'telemetryEnabled'
            )
          },

          setBillingUsageNotificationsEnabled: async (enabled: boolean) => {
            if (get().isBillingUsageNotificationsLoading) return
            await updateSettingOptimistic(
              'isBillingUsageNotificationsEnabled',
              enabled,
              'isBillingUsageNotificationsLoading',
              'isBillingUsageNotificationsEnabled'
            )
          },

          // API Actions
          loadSettings: async (force = false) => {
            // Skip if we've already loaded from DB and not forcing
            if (hasLoadedFromDb && !force) {
              logger.debug('Already loaded settings from DB, using cached data')
              return
            }

            // If we have persisted state and not forcing, check if we need to load
            const persistedState = localStorage.getItem('general-settings')
            if (persistedState && !force) {
              try {
                const parsed = JSON.parse(persistedState)
                // If we have valid theme data, skip DB load unless forced
                if (parsed.state?.theme) {
                  logger.debug('Using cached settings from localStorage')
                  hasLoadedFromDb = true // Mark as loaded to prevent future API calls
                  return
                }
              } catch (e) {
                // If parsing fails, continue to load from DB
              }
            }
            // Skip loading if on a chat path
            if (typeof window !== 'undefined' && window.location.pathname.startsWith('/chat/')) {
              logger.debug('Skipping settings load - on chat page')
              return
            }

            // Skip loading if settings were recently loaded (within 5 seconds)
            const now = Date.now()
            if (!force && now - lastLoadTime < CACHE_TIMEOUT) {
              logger.debug('Skipping settings load - recently loaded')
              return
            }

            try {
              set({ isLoading: true, error: null })

              const response = await fetch('/api/users/me/settings')

              if (!response.ok) {
                throw new Error('Failed to fetch settings')
              }

              const { data } = await response.json()

              set({
                isAutoConnectEnabled: data.autoConnect,
                isAutoPanEnabled: data.autoPan ?? true,
                isConsoleExpandedByDefault: data.consoleExpandedByDefault ?? true,
                showFloatingControls: data.showFloatingControls ?? true,
                showTrainingControls: data.showTrainingControls ?? false,
                superUserModeEnabled: data.superUserModeEnabled ?? true,
                theme: data.theme || 'system',
                telemetryEnabled: data.telemetryEnabled,
                isBillingUsageNotificationsEnabled: data.billingUsageNotificationsEnabled ?? true,
                isLoading: false,
              })

              // COMMENTED OUT: Theme switching disabled - dark mode is forced for workspace
              // // Sync theme to next-themes if it's different
              // if (data.theme && typeof window !== 'undefined') {
              //   const currentTheme = localStorage.getItem('sim-theme')
              //   if (currentTheme !== data.theme) {
              //     syncThemeToNextThemes(data.theme)
              //   }
              // }

              lastLoadTime = now
              errorRetryCount = 0
              hasLoadedFromDb = true
            } catch (error) {
              logger.error('Error loading settings:', error)
              set({
                error: error instanceof Error ? error.message : 'Unknown error',
                isLoading: false,
              })
            }
          },

          updateSetting: async (key, value) => {
            if (typeof window !== 'undefined' && window.location.pathname.startsWith('/chat/')) {
              logger.debug(`Skipping setting update for ${key} on chat page`)
              return
            }

            try {
              const response = await fetch('/api/users/me/settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ [key]: value }),
              })

              if (!response.ok) {
                throw new Error(`Failed to update setting: ${key}`)
              }

              set({ error: null })
              lastLoadTime = Date.now()
              errorRetryCount = 0
            } catch (error) {
              logger.error(`Error updating setting ${key}:`, error)
              set({ error: error instanceof Error ? error.message : 'Unknown error' })

              // Don't auto-retry on individual setting updates to avoid conflicts
              throw error
            }
          },
        }
      },
      {
        name: 'general-settings',
      }
    ),
    { name: 'general-store' }
  )
)
