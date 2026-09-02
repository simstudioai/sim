import { db } from '@sim/db'
import { settings, user } from '@sim/db/schema'
import { eq, inArray } from 'drizzle-orm'
import type { UserSettingsApi } from '@/lib/api/contracts/user'
import { normalizeStringArray } from '@/lib/core/utils/arrays'

const MAX_USER_EMAIL_BATCH = 1000

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
  superUserModeEnabled: false,
  mothershipEnvironment: 'default',
  errorNotificationsEnabled: true,
  snapToGridSize: 0,
  showActionBar: true,
  autoFocusOnClick: true,
  copilotAutoAllowedTools: [],
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
      superUserModeEnabled: settings.superUserModeEnabled,
      mothershipEnvironment: settings.mothershipEnvironment,
      errorNotificationsEnabled: settings.errorNotificationsEnabled,
      snapToGridSize: settings.snapToGridSize,
      showActionBar: settings.showActionBar,
      autoFocusOnClick: settings.autoFocusOnClick,
      copilotAutoAllowedTools: settings.copilotAutoAllowedTools,
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
    superUserModeEnabled: userSettings.superUserModeEnabled ?? false,
    mothershipEnvironment:
      (userSettings.mothershipEnvironment as UserSettingsApi['mothershipEnvironment']) ?? 'default',
    errorNotificationsEnabled: userSettings.errorNotificationsEnabled ?? true,
    snapToGridSize: userSettings.snapToGridSize ?? 0,
    showActionBar: userSettings.showActionBar ?? true,
    autoFocusOnClick: userSettings.autoFocusOnClick ?? true,
    copilotAutoAllowedTools: normalizeStringArray(userSettings.copilotAutoAllowedTools),
    timezone: userSettings.timezone ?? null,
    lastActiveWorkspaceId: userSettings.lastActiveWorkspaceId ?? null,
  }
}

/**
 * Loads the email for a trusted Sim-user subject. A missing user or email is an
 * execution-identity integrity failure and must abort metadata construction.
 */
export async function getUserEmailById(userId: string): Promise<string> {
  const [userRecord] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)

  if (!userRecord?.email) throw new Error(`Authenticated user ${userId} has no email address`)
  return userRecord.email
}

/**
 * Resolves a bounded set of user IDs to current email addresses in one query.
 * A non-existent user is an integrity failure for public attribution and is
 * never replaced with the raw ID or a placeholder.
 */
export async function getUserEmailsByIds(userIds: readonly string[]): Promise<Map<string, string>> {
  const uniqueIds = Array.from(new Set(userIds))
  if (uniqueIds.length === 0) return new Map()
  if (uniqueIds.length > MAX_USER_EMAIL_BATCH) {
    throw new Error(`Cannot resolve more than ${MAX_USER_EMAIL_BATCH} user emails at once`)
  }

  const rows = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(inArray(user.id, uniqueIds))

  const emailByUserId = new Map(rows.map((row) => [row.id, row.email]))
  const missingIds = uniqueIds.filter((id) => !emailByUserId.has(id))
  if (missingIds.length > 0) {
    throw new Error(`Unable to resolve email for user IDs: ${missingIds.join(', ')}`)
  }

  return emailByUserId
}

/** Returns one previously resolved email or throws on an incomplete projection. */
export function requireResolvedUserEmail(
  emailByUserId: ReadonlyMap<string, string>,
  userId: string
): string {
  const email = emailByUserId.get(userId)
  if (!email) throw new Error(`Unable to resolve email for user ID: ${userId}`)
  return email
}

/** Resolves one required public attribution email. */
export async function getRequiredUserEmail(userId: string): Promise<string> {
  return requireResolvedUserEmail(await getUserEmailsByIds([userId]), userId)
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
