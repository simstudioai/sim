import { normalizeEmail } from '@sim/utils/string'
import { fetchAppConfigProfile } from '@/lib/core/config/appconfig'
import { env } from '@/lib/core/config/env'
import { isAppConfigEnabled } from '@/lib/core/config/env-flags'

/**
 * Name of the AppConfig configuration profile holding the signup/login gating
 * lists. This is a cross-repo contract: it must match the `CfnConfigurationProfile`
 * name created by the infra stack.
 */
const ACCESS_CONTROL_PROFILE = 'access-control'

/**
 * Normalized signup/login gating lists. All entries are trimmed, lowercased, and
 * de-duplicated. Domains are bare hostnames; MX hosts are substrings matched
 * against resolved MX exchanges; emails are full addresses.
 */
export interface AccessControlConfig {
  blockedSignupDomains: string[]
  blockedEmails: string[]
  allowedLoginEmails: string[]
  allowedLoginDomains: string[]
  blockedEmailMxHosts: string[]
}

/**
 * True when the email's domain matches a denylist entry exactly or is a
 * subdomain of one.
 */
export function isEmailInDenylist(
  email: string | undefined | null,
  denylist: readonly string[] | null
): boolean {
  if (!denylist || denylist.length === 0 || !email) return false
  const domain = email.split('@')[1]?.toLowerCase()
  if (!domain) return false
  return denylist.some((entry) => domain === entry || domain.endsWith(`.${entry}`))
}

/**
 * True when the email is individually banned (`blockedEmails`) or its domain
 * is in the blocked-domains list. The single predicate for "this email must
 * not sign up, sign in, or execute anything".
 */
export function isEmailBlockedByAccessControl(
  email: string | undefined | null,
  config: AccessControlConfig
): boolean {
  if (!email) return false
  const normalized = normalizeEmail(email)
  if (config.blockedEmails.includes(normalized)) return true
  return isEmailInDenylist(normalized, config.blockedSignupDomains)
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
 * Reads the same env vars the app used before AppConfig.
 */
function fromEnv(): AccessControlConfig {
  return {
    blockedSignupDomains: parseCsv(env.BLOCKED_SIGNUP_DOMAINS),
    blockedEmails: parseCsv(env.BLOCKED_EMAILS),
    allowedLoginEmails: parseCsv(env.ALLOWED_LOGIN_EMAILS),
    allowedLoginDomains: parseCsv(env.ALLOWED_LOGIN_DOMAINS),
    blockedEmailMxHosts: parseCsv(env.BLOCKED_EMAIL_MX_HOSTS),
  }
}

function parseConfig(json: unknown): AccessControlConfig {
  const obj = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>
  return {
    blockedSignupDomains: normalizeList(obj.blockedSignupDomains),
    blockedEmails: normalizeList(obj.blockedEmails),
    allowedLoginEmails: normalizeList(obj.allowedLoginEmails),
    allowedLoginDomains: normalizeList(obj.allowedLoginDomains),
    blockedEmailMxHosts: normalizeList(obj.blockedEmailMxHosts),
  }
}

/**
 * Resolve the current signup/login gating lists. Reads from AWS AppConfig on
 * hosted deployments (cached, ~30s TTL, never blocks after the first fetch),
 * otherwise falls back to env vars so self-hosted/OSS works with no AWS.
 */
export async function getAccessControlConfig(): Promise<AccessControlConfig> {
  if (!isAppConfigEnabled) return fromEnv()

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
