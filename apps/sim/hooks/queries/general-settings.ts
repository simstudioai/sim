import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { syncThemeToNextThemes } from '@/lib/core/utils/theme'
import { useGeneralStore } from '@/stores/settings/general'

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
  showTrainingControls: boolean
  superUserModeEnabled: boolean
  theme: 'light' | 'dark' | 'system'
  telemetryEnabled: boolean
  billingUsageNotificationsEnabled: boolean
  errorNotificationsEnabled: boolean
  snapToGridSize: number
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
    showTrainingControls: data.showTrainingControls ?? false,
    superUserModeEnabled: data.superUserModeEnabled ?? true,
    theme: data.theme || 'dark',
    telemetryEnabled: data.telemetryEnabled ?? true,
    billingUsageNotificationsEnabled: data.billingUsageNotificationsEnabled ?? true,
    errorNotificationsEnabled: data.errorNotificationsEnabled ?? true,
    snapToGridSize: data.snapToGridSize ?? 0,
  }
}

/**
 * Sync React Query cache to Zustand store and next-themes.
 * This ensures the rest of the app (which uses Zustand) stays in sync.
 * Uses shallow comparison to prevent unnecessary updates and flickering.
 * @param settings - The general settings to sync
 */
function syncSettingsToZustand(settings: GeneralSettings) {
  const store = useGeneralStore.getState()

  const newSettings = {
    isAutoConnectEnabled: settings.autoConnect,
    showTrainingControls: settings.showTrainingControls,
    superUserModeEnabled: settings.superUserModeEnabled,
    theme: settings.theme,
    telemetryEnabled: settings.telemetryEnabled,
    isBillingUsageNotificationsEnabled: settings.billingUsageNotificationsEnabled,
    isErrorNotificationsEnabled: settings.errorNotificationsEnabled,
    snapToGridSize: settings.snapToGridSize,
  }

  const hasChanges = Object.entries(newSettings).some(
    ([key, value]) => store[key as keyof typeof newSettings] !== value
  )

  if (hasChanges) {
    store.setSettings(newSettings)
  }

  syncThemeToNextThemes(settings.theme)
}

/**
 * Hook to fetch general settings.
 * Syncs to Zustand store only on successful fetch (not on cache updates from mutations).
 */
export function useGeneralSettings() {
  return useQuery({
    queryKey: generalSettingsKeys.settings(),
    queryFn: async () => {
      const settings = await fetchGeneralSettings()
      syncSettingsToZustand(settings)
      return settings
    },
    staleTime: 60 * 60 * 1000,
    placeholderData: keepPreviousData,
  })
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
  })
}
