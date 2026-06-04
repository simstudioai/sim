import { createLogger } from '@sim/logger'
import type { QueryClient } from '@tanstack/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  getUserSettingsContract,
  type MothershipEnvironment,
  type UserSettingsApi,
  updateUserSettingsContract,
} from '@/lib/api/contracts'
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
  mothershipEnvironment: MothershipEnvironment
  theme: 'light' | 'dark' | 'system'
  telemetryEnabled: boolean
  billingUsageNotificationsEnabled: boolean
  errorNotificationsEnabled: boolean
  snapToGridSize: number
  showActionBar: boolean
}

/**
 * Map raw API response data to GeneralSettings with defaults.
 * Shared by both client fetch and server prefetch to prevent shape drift.
 */
export function mapGeneralSettingsResponse(data: UserSettingsApi): GeneralSettings {
  return {
    autoConnect: data.autoConnect,
    showTrainingControls: data.showTrainingControls,
    superUserModeEnabled: data.superUserModeEnabled,
    mothershipEnvironment: data.mothershipEnvironment,
    theme: data.theme,
    telemetryEnabled: data.telemetryEnabled,
    billingUsageNotificationsEnabled: data.billingUsageNotificationsEnabled,
    errorNotificationsEnabled: data.errorNotificationsEnabled,
    snapToGridSize: data.snapToGridSize,
    showActionBar: data.showActionBar,
  }
}

/**
 * Fetch general settings from API
 */
async function fetchGeneralSettings(signal?: AbortSignal): Promise<GeneralSettings> {
  const { data } = await requestJson(getUserSettingsContract, { signal })
  return mapGeneralSettingsResponse(data)
}

/**
 * Hook to fetch general settings.
 * TanStack Query is now the single source of truth for general settings.
 */
export function useGeneralSettings() {
  return useQuery({
    queryKey: generalSettingsKeys.settings(),
    queryFn: async ({ signal }) => {
      const settings = await fetchGeneralSettings(signal)
      syncThemeToNextThemes(settings.theme)
      return settings
    },
    staleTime: 60 * 60 * 1000,
  })
}

/**
 * Prefetch general settings into a QueryClient cache.
 * Use on hover to warm data before navigation.
 */
export function prefetchGeneralSettings(queryClient: QueryClient) {
  queryClient.prefetchQuery({
    queryKey: generalSettingsKeys.settings(),
    queryFn: async ({ signal }) => {
      const settings = await fetchGeneralSettings(signal)
      syncThemeToNextThemes(settings.theme)
      return settings
    },
    staleTime: 60 * 60 * 1000,
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
type UpdateSettingParams = {
  [K in keyof GeneralSettings]: {
    key: K
    value: GeneralSettings[K]
  }
}[keyof GeneralSettings]

export function useUpdateGeneralSetting() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ key, value }: UpdateSettingParams) => {
      return requestJson(updateUserSettingsContract, { body: { [key]: value } })
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
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: generalSettingsKeys.settings() })
    },
  })
}
