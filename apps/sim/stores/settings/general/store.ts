import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console-logger'
import type { GeneralStore } from './types'

const logger = createLogger('GeneralStore')

const CACHE_TIMEOUT = 5000
const MAX_ERROR_RETRIES = 2

export const useGeneralStore = create<GeneralStore>()(
  devtools(
    persist(
      (set, get) => {
        let lastLoadTime = 0
        let errorRetryCount = 0

        return {
          isAutoConnectEnabled: true,
          isDebugModeEnabled: false,
          isAutoFillEnvVarsEnabled: true,
          isAutoPanEnabled: true,
          theme: 'system',
          telemetryEnabled: true,
          telemetryNotifiedUser: false,
          isLoading: false,
          error: null,

          // Basic Actions
          toggleAutoConnect: () => {
            const newValue = !get().isAutoConnectEnabled
            set({ isAutoConnectEnabled: newValue })
            get().updateSetting('autoConnect', newValue)
          },

          toggleDebugMode: () => {
            const newValue = !get().isDebugModeEnabled
            set({ isDebugModeEnabled: newValue })
            get().updateSetting('debugMode', newValue)
          },

          toggleAutoFillEnvVars: () => {
            const newValue = !get().isAutoFillEnvVarsEnabled
            set({ isAutoFillEnvVarsEnabled: newValue })
            get().updateSetting('autoFillEnvVars', newValue)
          },

          toggleAutoPan: () => {
            const newValue = !get().isAutoPanEnabled
            set({ isAutoPanEnabled: newValue })
            get().updateSetting('autoPan', newValue)
          },

          setTheme: (theme) => {
            set({ theme })
            get().updateSetting('theme', theme)
          },

          setTelemetryEnabled: (enabled) => {
            set({ telemetryEnabled: enabled })
            get().updateSetting('telemetryEnabled', enabled)
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
                isDebugModeEnabled: data.debugMode,
                isAutoFillEnvVarsEnabled: data.autoFillEnvVars,
                isAutoPanEnabled: data.autoPan ?? true, // Default to true if undefined
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

              if (errorRetryCount < MAX_ERROR_RETRIES) {
                errorRetryCount++
                logger.debug(`Retry attempt ${errorRetryCount} after error`)
                get().loadSettings(true)
              } else {
                logger.warn(
                  `Max retries (${MAX_ERROR_RETRIES}) exceeded, skipping automatic loadSettings`
                )
              }
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
