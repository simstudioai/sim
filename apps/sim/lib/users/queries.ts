import { db } from '@sim/db'
import { settings, user } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import type { UserSettingsApi } from '@/lib/api/contracts/user'

/**
 * Default user settings returned for unauthenticated users or when no
 * settings row exists yet.
 */
export const defaultUserSettings: UserSettingsApi = {
  theme: 'system',
  autoConnect: true,
  telemetryEnabled: true,
  emailPreferences: {},
  billingUsageNotificationsEnabled: true,
  showTrainingControls: false,
  superUserModeEnabled: false,
  mothershipEnvironment: 'default',
  errorNotificationsEnabled: true,
  snapToGridSize: 0,
  showActionBar: true,
  timezone: null,
  lastActiveWorkspaceId: null,
}

/**
 * Loads a user's settings, falling back to {@link defaultUserSettings} when the
 * user is unauthenticated or has no persisted settings row.
 */
export async function getUserSettings(userId: string | null): Promise<UserSettingsApi> {
  if (!userId) {
    return defaultUserSettings
  }

  const result = await db
    .select({
      theme: settings.theme,
      autoConnect: settings.autoConnect,
      telemetryEnabled: settings.telemetryEnabled,
      emailPreferences: settings.emailPreferences,
      billingUsageNotificationsEnabled: settings.billingUsageNotificationsEnabled,
      showTrainingControls: settings.showTrainingControls,
      superUserModeEnabled: settings.superUserModeEnabled,
      mothershipEnvironment: settings.mothershipEnvironment,
      errorNotificationsEnabled: settings.errorNotificationsEnabled,
      snapToGridSize: settings.snapToGridSize,
      showActionBar: settings.showActionBar,
      timezone: settings.timezone,
      lastActiveWorkspaceId: settings.lastActiveWorkspaceId,
    })
    .from(settings)
    .where(eq(settings.userId, userId))
    .limit(1)

  if (!result.length) {
    return defaultUserSettings
  }

  const userSettings = result[0]

  return {
    theme: userSettings.theme as UserSettingsApi['theme'],
    autoConnect: userSettings.autoConnect,
    telemetryEnabled: userSettings.telemetryEnabled,
    emailPreferences: userSettings.emailPreferences ?? {},
    billingUsageNotificationsEnabled: userSettings.billingUsageNotificationsEnabled ?? true,
    showTrainingControls: userSettings.showTrainingControls ?? false,
    superUserModeEnabled: userSettings.superUserModeEnabled ?? false,
    mothershipEnvironment:
      (userSettings.mothershipEnvironment as UserSettingsApi['mothershipEnvironment']) ?? 'default',
    errorNotificationsEnabled: userSettings.errorNotificationsEnabled ?? true,
    snapToGridSize: userSettings.snapToGridSize ?? 0,
    showActionBar: userSettings.showActionBar ?? true,
    timezone: userSettings.timezone ?? null,
    lastActiveWorkspaceId: userSettings.lastActiveWorkspaceId ?? null,
  }
}

/**
 * Loads a user's email address, or `null` when no matching user exists.
 */
export async function getUserEmailById(userId: string): Promise<string | null> {
  const [userRecord] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)

  return userRecord?.email ?? null
}

/**
 * Loads a user's public profile fields, or `null` when no matching user exists.
 */
export async function getUserProfile(userId: string) {
  const [userRecord] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      emailVerified: user.emailVerified,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)

  return userRecord ?? null
}
