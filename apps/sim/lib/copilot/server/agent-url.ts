import { db } from '@sim/db'
import { settings, user } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { type MothershipEnvironment, mothershipEnvironmentSchema } from '@/lib/api/contracts'
import { SIM_AGENT_API_URL, SIM_AGENT_API_URL_DEFAULT } from '@/lib/copilot/constants'
import { env } from '@/lib/core/config/env'

export interface GetMothershipBaseURLOptions {
  userId?: string | null
  environment?: MothershipEnvironment
  fallbackUrl?: string | null
}

type ConcreteMothershipEnvironment = Exclude<MothershipEnvironment, 'default'>

const ENVIRONMENT_URLS: Record<ConcreteMothershipEnvironment, string | undefined> = {
  dev: env.COPILOT_DEV_URL,
  staging: env.COPILOT_STAGING_URL,
  prod: env.COPILOT_PROD_URL,
}

function normalizeUrl(url: string | undefined): string | null {
  if (!url) return null
  return url.startsWith('http://') || url.startsWith('https://') ? url : null
}

function getConfiguredEnvironmentUrl(environment: MothershipEnvironment): string | null {
  if (environment === 'default') return null
  return normalizeUrl(ENVIRONMENT_URLS[environment])
}

function getDefaultMothershipBaseURL(fallbackUrl?: string | null): string {
  const fallback = typeof fallbackUrl === 'string' ? fallbackUrl : undefined
  return normalizeUrl(fallback) ?? normalizeUrl(SIM_AGENT_API_URL) ?? SIM_AGENT_API_URL_DEFAULT
}

export async function getMothershipBaseURL(
  options: GetMothershipBaseURLOptions = {}
): Promise<string> {
  const defaultUrl = getDefaultMothershipBaseURL(options.fallbackUrl)

  const { userId } = options
  if (!userId) return defaultUrl

  const [row] = await db
    .select({
      role: user.role,
      superUserModeEnabled: settings.superUserModeEnabled,
      mothershipEnvironment: settings.mothershipEnvironment,
    })
    .from(user)
    .leftJoin(settings, eq(settings.userId, user.id))
    .where(eq(user.id, userId))
    .limit(1)

  const effectiveSuperUser = row?.role === 'admin' && (row.superUserModeEnabled ?? false)
  if (!effectiveSuperUser) return defaultUrl

  const selectedEnvironment = options.environment ?? row.mothershipEnvironment
  const parsedEnvironment = mothershipEnvironmentSchema.safeParse(selectedEnvironment)
  const environment = parsedEnvironment.success ? parsedEnvironment.data : 'default'

  return getConfiguredEnvironmentUrl(environment) ?? defaultUrl
}
