import type {
  MothershipEnvironment,
  UserProfileApiUser,
  UserSettingsApi,
} from '@/lib/api/contracts/user'

export const USER_PROFILE_STALE_TIME = 5 * 60 * 1000

export const userProfileKeys = {
  all: ['userProfile'] as const,
  profile: () => [...userProfileKeys.all, 'profile'] as const,
}

export type UserProfile = Omit<UserProfileApiUser, 'emailVerified'>

export function mapUserProfileResponse(user: UserProfileApiUser): UserProfile {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
  }
}

export const generalSettingsKeys = {
  all: ['generalSettings'] as const,
  settings: () => [...generalSettingsKeys.all, 'settings'] as const,
}

export const GENERAL_SETTINGS_STALE_TIME = 60 * 60 * 1000

export interface GeneralSettings {
  autoConnect: boolean
  superUserModeEnabled: boolean
  mothershipEnvironment: MothershipEnvironment
  theme: 'light' | 'dark' | 'system'
  telemetryEnabled: boolean
  billingUsageNotificationsEnabled: boolean
  errorNotificationsEnabled: boolean
  snapToGridSize: number
  showActionBar: boolean
  /** Whether clicking a block on the canvas animates the camera to center it. */
  autoFocusOnClick: boolean
  /** Copilot tool ids the user picked "always allow" for. */
  copilotAutoAllowedTools: string[]
  /** Saved IANA timezone, or `null` when unset (the app falls back to the browser zone). */
  timezone: string | null
}

export function mapGeneralSettingsResponse(data: UserSettingsApi): GeneralSettings {
  return {
    autoConnect: data.autoConnect,
    superUserModeEnabled: data.superUserModeEnabled,
    mothershipEnvironment: data.mothershipEnvironment,
    theme: data.theme,
    telemetryEnabled: data.telemetryEnabled,
    billingUsageNotificationsEnabled: data.billingUsageNotificationsEnabled,
    errorNotificationsEnabled: data.errorNotificationsEnabled,
    snapToGridSize: data.snapToGridSize,
    showActionBar: data.showActionBar,
    autoFocusOnClick: data.autoFocusOnClick,
    copilotAutoAllowedTools: data.copilotAutoAllowedTools ?? [],
    timezone: data.timezone ?? null,
  }
}
