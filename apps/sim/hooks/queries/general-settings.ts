import { useEffect } from 'react'
import { createLogger } from '@sim/logger'
import type { QueryClient } from '@tanstack/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import { getUserSettingsContract, updateUserSettingsContract } from '@/lib/api/contracts/user'
import { syncThemeToNextThemes } from '@/lib/core/utils/theme'
import { getBrowserTimezone, isValidTimezone } from '@/lib/core/utils/timezone'
import {
  GENERAL_SETTINGS_STALE_TIME,
  type GeneralSettings,
  generalSettingsKeys,
  mapGeneralSettingsResponse,
} from '@/hooks/queries/general-settings-data'

const logger = createLogger('GeneralSettingsQuery')

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
  const query = useQuery({
    queryKey: generalSettingsKeys.settings(),
    queryFn: ({ signal }) => fetchGeneralSettings(signal),
    staleTime: GENERAL_SETTINGS_STALE_TIME,
  })

  useEffect(() => {
    if (query.data?.theme) syncThemeToNextThemes(query.data.theme)
  }, [query.data?.theme])

  return query
}

/**
 * Prefetch general settings into a QueryClient cache.
 * Use on hover to warm data before navigation.
 */
export function prefetchGeneralSettings(queryClient: QueryClient) {
  queryClient.prefetchQuery({
    queryKey: generalSettingsKeys.settings(),
    queryFn: ({ signal }) => fetchGeneralSettings(signal),
    staleTime: GENERAL_SETTINGS_STALE_TIME,
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

export function useSnapToGridSize(): number {
  const { data } = useGeneralSettings()
  return data?.snapToGridSize ?? 0
}

export function useShowActionBar(): boolean {
  const { data } = useGeneralSettings()
  return data?.showActionBar ?? true
}

/**
 * Whether the canvas camera animates to center a block when it is clicked.
 *
 * Scoped to clicks only. Arrow-key navigation and block creation deliberately
 * keep following the camera regardless — both move selection to a block that
 * may be off-screen, so suppressing the move would leave the user with no way
 * to tell where the selection went.
 */
export function useAutoFocusOnClick(): boolean {
  const { data } = useGeneralSettings()
  return data?.autoFocusOnClick ?? true
}

export function useBillingUsageNotifications(): boolean {
  const { data } = useGeneralSettings()
  return data?.billingUsageNotificationsEnabled ?? true
}

/**
 * The user's effective timezone: a valid saved preference, otherwise the browser zone.
 * Callers that must distinguish Auto from invalid or unavailable settings use
 * {@link useTimezoneState} instead.
 */
export function useTimezone(): string {
  return useTimezoneState().timezone
}

export interface TimezoneState {
  /** Effective, always-valid timezone used by read-only consumers. */
  timezone: string
  /** Raw saved preference, or `null` when the browser timezone is intentional. */
  savedTimezone: string | null
  status: 'loading' | 'ready' | 'invalid' | 'error'
}

/**
 * The effective timezone together with the raw preference's validity. Time-based
 * editors use the status so only an intentional Auto preference may write with the
 * browser fallback; loading, invalid, and unavailable preferences remain read-only.
 */
export function useTimezoneState(): TimezoneState {
  const { data, isError } = useGeneralSettings()
  if (!data) {
    return {
      timezone: getBrowserTimezone(),
      savedTimezone: null,
      status: isError ? 'error' : 'loading',
    }
  }

  const savedTimezone = data.timezone
  if (savedTimezone === null) {
    return {
      timezone: getBrowserTimezone(),
      savedTimezone: null,
      status: 'ready',
    }
  }
  if (isValidTimezone(savedTimezone)) {
    return { timezone: savedTimezone, savedTimezone, status: 'ready' }
  }
  return {
    timezone: getBrowserTimezone(),
    savedTimezone,
    status: 'invalid',
  }
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
      return queryClient.invalidateQueries({ queryKey: generalSettingsKeys.settings() })
    },
  })
}
