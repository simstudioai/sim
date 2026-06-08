import {
  AppConfigDataClient,
  GetLatestConfigurationCommand,
  StartConfigurationSessionCommand,
} from '@aws-sdk/client-appconfigdata'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { getAwsCredentialsFromEnv } from '@/lib/core/config/aws'
import { env } from '@/lib/core/config/env'

const logger = createLogger('AppConfig')

const DEFAULT_TTL_MS = 30_000

export interface AppConfigProfileIdentifiers {
  application: string
  environment: string
  profile: string
}

interface CacheEntry<T> {
  /** Last successfully parsed value, or `null` if no successful fetch yet. */
  value: T | null
  /** Token for the next `GetLatestConfiguration` poll, rotated on each call. */
  nextToken: string | undefined
  expiresAt: number
  refreshing: boolean
}

const cache = new Map<string, CacheEntry<unknown>>()

let client: AppConfigDataClient | null = null

/**
 * Lazily construct the AppConfig data-plane client. Never instantiated unless a
 * caller actually fetches a profile, so deployments without AppConfig configured
 * never reach for AWS credentials.
 */
function getClient(): AppConfigDataClient {
  if (!client) {
    client = new AppConfigDataClient({
      region: env.AWS_REGION,
      credentials: getAwsCredentialsFromEnv(),
    })
  }
  return client
}

function cacheKey(ids: AppConfigProfileIdentifiers): string {
  return `${ids.application}/${ids.environment}/${ids.profile}`
}

/**
 * Run one AppConfig poll for `entry`: starts a session if no token is held, then
 * calls `GetLatestConfiguration`. An empty payload means "unchanged" and the
 * previous value is kept. Any error is logged and the last good value is
 * retained. Returns the (possibly unchanged) value.
 */
async function poll<T>(
  ids: AppConfigProfileIdentifiers,
  parse: (json: unknown) => T,
  entry: CacheEntry<T>
): Promise<T | null> {
  try {
    const dataClient = getClient()

    if (!entry.nextToken) {
      const session = await dataClient.send(
        new StartConfigurationSessionCommand({
          ApplicationIdentifier: ids.application,
          EnvironmentIdentifier: ids.environment,
          ConfigurationProfileIdentifier: ids.profile,
        })
      )
      entry.nextToken = session.InitialConfigurationToken
    }

    const response = await dataClient.send(
      new GetLatestConfigurationCommand({ ConfigurationToken: entry.nextToken })
    )
    entry.nextToken = response.NextPollConfigurationToken ?? entry.nextToken

    if (response.Configuration && response.Configuration.length > 0) {
      const text = new TextDecoder().decode(response.Configuration)
      entry.value = parse(JSON.parse(text))
    }

    entry.expiresAt = Date.now() + DEFAULT_TTL_MS
    return entry.value
  } catch (error) {
    // Drop the token so the next attempt starts a fresh session (handles expired
    // or invalid tokens). Keep the last good value rather than failing the caller.
    entry.nextToken = undefined
    entry.expiresAt = Date.now() + DEFAULT_TTL_MS
    logger.error('AppConfig fetch failed; serving last known value', {
      profile: cacheKey(ids),
      error: getErrorMessage(error),
    })
    return entry.value
  }
}

/**
 * Fetch and cache a single AppConfig configuration profile as JSON.
 *
 * Profile-agnostic: pass the `application`/`environment` (from env) and a
 * `profile` constant owned by the calling feature. Uses an in-process TTL cache
 * with stale-while-revalidate — a warm cache returns immediately and refreshes
 * in the background once the TTL lapses, so no request blocks on the AppConfig
 * round trip after the first (cold) fetch. Returns `null` only when the very
 * first fetch fails before any value is cached.
 */
export async function fetchAppConfigProfile<T>(
  ids: AppConfigProfileIdentifiers,
  parse: (json: unknown) => T
): Promise<T | null> {
  const key = cacheKey(ids)
  const entry = (cache.get(key) as CacheEntry<T> | undefined) ?? {
    value: null,
    nextToken: undefined,
    expiresAt: 0,
    refreshing: false,
  }
  cache.set(key, entry)

  // Cold: no value yet — fetch synchronously so the caller gets real data.
  if (entry.value === null) {
    return poll(ids, parse, entry)
  }

  // Warm but stale: serve cached value, refresh in the background.
  if (Date.now() >= entry.expiresAt && !entry.refreshing) {
    entry.refreshing = true
    void poll(ids, parse, entry).finally(() => {
      entry.refreshing = false
    })
  }

  return entry.value
}
