import { fetchAppConfigProfile } from '@/lib/core/config/appconfig'
import { env } from '@/lib/core/config/env'

/**
 * Name of the AppConfig configuration profile holding the signup/login gating
 * lists. This is a cross-repo contract: it must match the `CfnConfigurationProfile`
 * name created by the infra stack.
 */
const ACCESS_CONTROL_PROFILE = 'access-control'

/**
 * Normalized signup/login gating lists. All entries are trimmed, lowercased, and
 * de-duplicated. Domains are bare hostnames; emails are full addresses; MX hosts
 * are substrings matched against resolved MX exchanges.
 */
export interface AccessControlConfig {
  blockedSignupDomains: string[]
  allowedLoginEmails: string[]
  allowedLoginDomains: string[]
  blockedEmailMxHosts: string[]
  bannedEmails: string[]
}

function normalizeList(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  return Array.from(new Set(values.map((v) => String(v).trim().toLowerCase()).filter(Boolean)))
}

function parseCsv(value: string | undefined): string[] {
  return normalizeList(value?.split(','))
}

/**
 * Fallback source for self-hosted/OSS/local deployments that have no AppConfig.
 * Reads the same env vars the app used before AppConfig. There is no env
 * equivalent for `bannedEmails` — that list is AppConfig-only.
 */
function fromEnv(): AccessControlConfig {
  return {
    blockedSignupDomains: parseCsv(env.BLOCKED_SIGNUP_DOMAINS),
    allowedLoginEmails: parseCsv(env.ALLOWED_LOGIN_EMAILS),
    allowedLoginDomains: parseCsv(env.ALLOWED_LOGIN_DOMAINS),
    blockedEmailMxHosts: parseCsv(env.BLOCKED_EMAIL_MX_HOSTS),
    bannedEmails: [],
  }
}

function parseConfig(json: unknown): AccessControlConfig {
  const obj = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>
  return {
    blockedSignupDomains: normalizeList(obj.blockedSignupDomains),
    allowedLoginEmails: normalizeList(obj.allowedLoginEmails),
    allowedLoginDomains: normalizeList(obj.allowedLoginDomains),
    blockedEmailMxHosts: normalizeList(obj.blockedEmailMxHosts),
    bannedEmails: normalizeList(obj.bannedEmails),
  }
}

/**
 * AppConfig is the source of truth only when both identifiers are present
 * (injected by the infra stack). Mirrors the `hasS3Config` presence-check
 * pattern — the AppConfig client is never constructed otherwise.
 */
function isAppConfigEnabled(): boolean {
  return Boolean(env.APPCONFIG_APPLICATION && env.APPCONFIG_ENVIRONMENT)
}

/**
 * Resolve the current signup/login gating lists. Reads from AWS AppConfig when
 * configured (cached, ~30s TTL, never blocks after the first fetch), otherwise
 * falls back to env vars so self-hosted/OSS deployments work with no AWS.
 */
export async function getAccessControlConfig(): Promise<AccessControlConfig> {
  if (!isAppConfigEnabled()) return fromEnv()

  const value = await fetchAppConfigProfile(
    {
      application: env.APPCONFIG_APPLICATION as string,
      environment: env.APPCONFIG_ENVIRONMENT as string,
      profile: ACCESS_CONTROL_PROFILE,
    },
    parseConfig
  )

  return value ?? fromEnv()
}
