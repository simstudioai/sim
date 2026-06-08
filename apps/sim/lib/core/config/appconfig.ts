import {
  AppConfigDataClient,
  GetLatestConfigurationCommand,
  type GetLatestConfigurationCommandOutput,
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
  /** Last successfully parsed value, or `null` if the config is empty/unseeded. */
  value: T | null
  /** True once any poll has completed (success, empty payload, or error). */
  loaded: boolean
  /** Token for the next `GetLatestConfiguration` poll, rotated on each call. */
  nextToken: string | undefined
  expiresAt: number
  /** In-flight poll, shared so concurrent callers don't each hit AppConfig. */
  inflight: Promise<T | null> | null
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
 * calls `GetLatestConfiguration`. An empty payload means "unchanged" (or an
 * unseeded profile) and the previous value is kept. Any error is logged and the
 * last good value is retained. Marks the entry `loaded` on any outcome so callers
 * never re-block on the cold path, and honors AppConfig's `NextPollInterval` so we
 * don't poll faster than the server allows (which would throttle).
 */
async function poll<T>(
  ids: AppConfigProfileIdentifiers,
  parse: (json: unknown) => T,
  entry: CacheEntry<T>
): Promise<T | null> {
  let response: GetLatestConfigurationCommandOutput
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

    response = await dataClient.send(
      new GetLatestConfigurationCommand({ ConfigurationToken: entry.nextToken })
    )
    entry.nextToken = response.NextPollConfigurationToken ?? entry.nextToken
  } catch (error) {
    // Network/session failure: drop the token so the next attempt starts a fresh
    // session (handles expired or invalid tokens). Mark loaded + back off so we
    // serve the fallback and retry in the background rather than blocking every
    // request during an outage.
    entry.nextToken = undefined
    entry.expiresAt = Date.now() + DEFAULT_TTL_MS
    entry.loaded = true
    logger.error('AppConfig fetch failed; serving last known value', {
      profile: cacheKey(ids),
      error: getErrorMessage(error),
    })
    return entry.value
  }

  // Parse outside the network try: a decode/parse error must NOT discard the
  // already-rotated session token — the round trip succeeded, so the next poll
  // can reuse it instead of opening a new session. Keep the last good value.
  try {
    if (response.Configuration && response.Configuration.length > 0) {
      const text = new TextDecoder().decode(response.Configuration)
      entry.value = parse(JSON.parse(text))
    }
  } catch (error) {
    logger.error('AppConfig response parse failed; serving last known value', {
      profile: cacheKey(ids),
      error: getErrorMessage(error),
    })
  }

  const intervalMs = (response.NextPollIntervalInSeconds ?? 60) * 1000
  entry.expiresAt = Date.now() + Math.max(DEFAULT_TTL_MS, intervalMs)
  entry.loaded = true
  return entry.value
}

/**
 * Fetch and cache a single AppConfig configuration profile as JSON.
 *
 * Profile-agnostic: pass the `application`/`environment` (from env) and a
 * `profile` constant owned by the calling feature. Uses an in-process TTL cache
 * with stale-while-revalidate — a warm cache returns immediately and refreshes
 * in the background once the TTL lapses, so no request blocks on the AppConfig
 * round trip after the first (cold) fetch. Concurrent callers share one in-flight
 * poll (avoids racing the rotating session token). Returns `null` when the config
 * is empty/unseeded or the first fetch fails.
 */
export async function fetchAppConfigProfile<T>(
  ids: AppConfigProfileIdentifiers,
  parse: (json: unknown) => T
): Promise<T | null> {
  const key = cacheKey(ids)
  const entry = (cache.get(key) as CacheEntry<T> | undefined) ?? {
    value: null,
    loaded: false,
    nextToken: undefined,
    expiresAt: 0,
    inflight: null,
  }
  cache.set(key, entry)

  // Cold: never polled — await a single shared poll so concurrent callers don't
  // each hit AppConfig (and don't race the rotating session token).
  if (!entry.loaded) {
    entry.inflight ??= poll(ids, parse, entry).finally(() => {
      entry.inflight = null
    })
    return entry.inflight
  }

  // Warm but stale: serve cached value, refresh once in the background.
  if (Date.now() >= entry.expiresAt && !entry.inflight) {
    entry.inflight = poll(ids, parse, entry).finally(() => {
      entry.inflight = null
    })
  }

  return entry.value
}
