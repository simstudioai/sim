import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console-logger'
import type { General, GeneralStore, UserSettings } from './types'

const logger = createLogger('GeneralStore')

const CACHE_TIMEOUT = 5000
const MAX_ERROR_RETRIES = 2

export const useGeneralStore = create<GeneralStore>()(
  devtools(
    persist(
      (set, get) => {
        let lastLoadTime = 0
        let errorRetryCount = 0

        const store: General = {
          isAutoConnectEnabled: true,
          isAutoFillEnvVarsEnabled: true,
          isAutoPanEnabled: true,
          isConsoleExpandedByDefault: true,
          isDebugModeEnabled: false,
          theme: 'system' as const,
          telemetryEnabled: true,
          telemetryNotifiedUser: false,
          isLoading: false,
          error: null,
          // Individual loading states
          isAutoConnectLoading: false,
          isAutoFillEnvVarsLoading: false,
          isAutoPanLoading: false,
          isConsoleExpandedByDefaultLoading: false,
          isThemeLoading: false,
          isTelemetryLoading: false,
        }

        // Optimistic update helper
        const updateSettingOptimistic = async <K extends keyof UserSettings>(
          key: K,
          value: UserSettings[K],
          loadingKey: keyof General,
          stateKey: keyof General
        ) => {
          // Prevent multiple simultaneous updates
          if ((get() as any)[loadingKey]) return

          const originalValue = (get() as any)[stateKey]

          // Optimistic update
          set({ [stateKey]: value, [loadingKey]: true } as any)

          try {
            await get().updateSetting(key, value)
            set({ [loadingKey]: false } as any)
          } catch (error) {
            // Rollback on error
            set({ [stateKey]: originalValue, [loadingKey]: false } as any)
            logger.error(`Failed to update ${String(key)}, rolled back:`, error)
          }
        }

        return {
          ...store,
          // Basic Actions with optimistic updates
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

          toggleAutoFillEnvVars: async () => {
            if (get().isAutoFillEnvVarsLoading) return
            const newValue = !get().isAutoFillEnvVarsEnabled
            await updateSettingOptimistic(
              'autoFillEnvVars',
              newValue,
              'isAutoFillEnvVarsLoading',
              'isAutoFillEnvVarsEnabled'
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

          toggleDebugMode: () => {
            set({ isDebugModeEnabled: !get().isDebugModeEnabled })
          },

          setTheme: async (theme) => {
            if (get().isThemeLoading) return
            await updateSettingOptimistic('theme', theme, 'isThemeLoading', 'theme')
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

          setTelemetryNotifiedUser: (notified) => {
            set({ telemetryNotifiedUser: notified })
            get().updateSetting('telemetryNotifiedUser', notified)
          },

          // API Actions
          loadSettings: async (force = false) => {
            // Skip loading if on a subdomain or chat path
            if (
              typeof window !== 'undefined' &&
              (window.location.pathname.startsWith('/chat/') ||
                (window.location.hostname !== 'simstudio.ai' &&
                  window.location.hostname !== 'localhost' &&
                  window.location.hostname !== '127.0.0.1' &&
                  !window.location.hostname.startsWith('www.')))
            ) {
              logger.debug('Skipping settings load - on chat or subdomain page')
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
                isAutoFillEnvVarsEnabled: data.autoFillEnvVars,
                isAutoPanEnabled: data.autoPan ?? true, // Default to true if undefined
                isConsoleExpandedByDefault: data.consoleExpandedByDefault ?? true, // Default to true if undefined
                theme: data.theme,
                telemetryEnabled: data.telemetryEnabled,
                telemetryNotifiedUser: data.telemetryNotifiedUser,
                isLoading: false,
              })

              lastLoadTime = now
              errorRetryCount = 0
            } catch (error) {
              logger.error('Error loading settings:', error)
              set({
                error: error instanceof Error ? error.message : 'Unknown error',
                isLoading: false,
              })
            }
          },

          updateSetting: async (key, value) => {
            if (
              typeof window !== 'undefined' &&
              (window.location.pathname.startsWith('/chat/') ||
                (window.location.hostname !== 'simstudio.ai' &&
                  window.location.hostname !== 'localhost' &&
                  window.location.hostname !== '127.0.0.1' &&
                  !window.location.hostname.startsWith('www.')))
            ) {
              logger.debug(`Skipping setting update for ${key} on chat or subdomain page`)
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
