import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createLogger } from '@/lib/logs/console/logger'
import { useGeneralStore } from '@/stores/settings/general/store'

const logger = createLogger('GeneralSettingsQuery')

/**
 * Query key factories for general settings
 */
export const generalSettingsKeys = {
  all: ['generalSettings'] as const,
  settings: () => [...generalSettingsKeys.all, 'settings'] as const,
}

/**
 * General settings type
 */
export interface GeneralSettings {
  autoConnect: boolean
  autoPan: boolean
  consoleExpandedByDefault: boolean
  showFloatingControls: boolean
  showTrainingControls: boolean
  superUserModeEnabled: boolean
  theme: 'light' | 'dark' | 'system'
  telemetryEnabled: boolean
  billingUsageNotificationsEnabled: boolean
}

/**
 * Fetch general settings from API
 */
async function fetchGeneralSettings(): Promise<GeneralSettings> {
  const response = await fetch('/api/users/me/settings')

  if (!response.ok) {
    throw new Error('Failed to fetch general settings')
  }

  const { data } = await response.json()

  return {
    autoConnect: data.autoConnect ?? true,
    autoPan: data.autoPan ?? true,
    consoleExpandedByDefault: data.consoleExpandedByDefault ?? true,
    showFloatingControls: data.showFloatingControls ?? true,
    showTrainingControls: data.showTrainingControls ?? false,
    superUserModeEnabled: data.superUserModeEnabled ?? true,
    theme: data.theme || 'system',
    telemetryEnabled: data.telemetryEnabled ?? true,
    billingUsageNotificationsEnabled: data.billingUsageNotificationsEnabled ?? true,
  }
}

/**
 * Sync React Query cache to Zustand store
 * This ensures the rest of the app (which uses Zustand) stays in sync
 */
function syncSettingsToZustand(settings: GeneralSettings) {
  const { setSettings } = useGeneralStore.getState()

  setSettings({
    isAutoConnectEnabled: settings.autoConnect,
    isAutoPanEnabled: settings.autoPan,
    isConsoleExpandedByDefault: settings.consoleExpandedByDefault,
    showFloatingControls: settings.showFloatingControls,
    showTrainingControls: settings.showTrainingControls,
    superUserModeEnabled: settings.superUserModeEnabled,
    theme: settings.theme,
    telemetryEnabled: settings.telemetryEnabled,
    isBillingUsageNotificationsEnabled: settings.billingUsageNotificationsEnabled,
  })
}

/**
 * Hook to fetch general settings
 * Also syncs to Zustand store to keep the rest of the app in sync
 */
export function useGeneralSettings() {
  const query = useQuery({
    queryKey: generalSettingsKeys.settings(),
    queryFn: fetchGeneralSettings,
    staleTime: 60 * 60 * 1000, // 1 hour - settings rarely change
    placeholderData: keepPreviousData, // Show cached data immediately while refetching
  })

  // Sync to Zustand whenever React Query cache updates
  if (query.data) {
    syncSettingsToZustand(query.data)
  }

  return query
}

/**
 * Update general settings mutation
 */
interface UpdateSettingParams {
  key: keyof GeneralSettings
  value: any
}

export function useUpdateGeneralSetting() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ key, value }: UpdateSettingParams) => {
      const response = await fetch('/api/users/me/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      })

      if (!response.ok) {
        throw new Error(`Failed to update setting: ${key}`)
      }

      return response.json()
    },
    onMutate: async ({ key, value }) => {
      await queryClient.cancelQueries({ queryKey: generalSettingsKeys.settings() })

      const previousSettings = queryClient.getQueryData<GeneralSettings>(
        generalSettingsKeys.settings()
      )

      if (previousSettings) {
        const newSettings = {
          ...previousSettings,
          [key]: value,
        }
        queryClient.setQueryData<GeneralSettings>(generalSettingsKeys.settings(), newSettings)

        syncSettingsToZustand(newSettings)
      }

      return { previousSettings }
    },
    onError: (err, _variables, context) => {
      if (context?.previousSettings) {
        queryClient.setQueryData(generalSettingsKeys.settings(), context.previousSettings)
        syncSettingsToZustand(context.previousSettings)
      }
      logger.error('Failed to update setting:', err)
    },
    onSuccess: (_data, _variables, _context) => {
      queryClient.invalidateQueries({ queryKey: generalSettingsKeys.settings() })
    },
  })
}
