import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { syncThemeToNextThemes } from '@/lib/core/utils/theme'

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
  showActionBar: boolean
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
    showActionBar: data.showActionBar ?? true,
  }
}

/**
 * Hook to fetch general settings.
 * TanStack Query is now the single source of truth for general settings.
 */
export function useGeneralSettings() {
  return useQuery({
    queryKey: generalSettingsKeys.settings(),
    queryFn: async () => {
      const settings = await fetchGeneralSettings()
      syncThemeToNextThemes(settings.theme)
      return settings
    },
    staleTime: 60 * 60 * 1000,
    placeholderData: keepPreviousData,
  })
}

/**
 * Convenience selector hooks for individual settings.
 * These provide a simple API for components that only need a single setting value.
 */

export function useAutoConnect(): boolean {
  const { data } = useGeneralSettings()
  return data?.autoConnect ?? true
}

export function useShowTrainingControls(): boolean {
  const { data } = useGeneralSettings()
  return data?.showTrainingControls ?? false
}

export function useSnapToGridSize(): number {
  const { data } = useGeneralSettings()
  return data?.snapToGridSize ?? 0
}

export function useShowActionBar(): boolean {
  const { data } = useGeneralSettings()
  return data?.showActionBar ?? true
}

export function useBillingUsageNotifications(): boolean {
  const { data } = useGeneralSettings()
  return data?.billingUsageNotificationsEnabled ?? true
}

export function useErrorNotificationsEnabled(): boolean {
  const { data } = useGeneralSettings()
  return data?.errorNotificationsEnabled ?? true
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

        if (key === 'theme') {
          syncThemeToNextThemes(value as GeneralSettings['theme'])
        }
      }

      return { previousSettings }
    },
    onError: (err, _variables, context) => {
      if (context?.previousSettings) {
        queryClient.setQueryData(generalSettingsKeys.settings(), context.previousSettings)
        syncThemeToNextThemes(context.previousSettings.theme)
      }
      logger.error('Failed to update setting:', err)
    },
  })
}
