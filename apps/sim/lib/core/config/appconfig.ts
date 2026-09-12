import {
  AppConfigDataClient,
  GetLatestConfigurationCommand,
  type GetLatestConfigurationCommandOutput,
  StartConfigurationSessionCommand,
} from '@aws-sdk/client-appconfigdata'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { LRUCache } from 'lru-cache'
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
  /** Token for the next `GetLatestConfiguration` poll, rotated on each call. */
  nextToken: string | undefined
  validatedAt: number | null
  remoteMatchesValue: boolean
  strict: boolean
}

export interface AppConfigSnapshot<T> {
  readonly value: T | null
  readonly validatedAt: number | null
}

interface PollContext {
  ids: AppConfigProfileIdentifiers
  parse: (json: unknown) => unknown
  strict: boolean
}

const cache = new LRUCache<string, CacheEntry<unknown>, PollContext>({
  max: 64,
  ttl: DEFAULT_TTL_MS,
  ttlResolution: 0,
  ignoreFetchAbort: true,
  /** Poll intervals and snapshot freshness share the same clock. */
  perf: { now: () => Date.now() },
  fetchMethod: async (_key, stale, { context, options }) => {
    const entry = stale ?? {
      value: null,
      nextToken: undefined,
      validatedAt: null,
      remoteMatchesValue: false,
      strict: context.strict,
    }
    options.ttl = await poll(context.ids, context.parse, entry)
    return entry
  },
})

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
 * last good value is retained. Returns AppConfig's `NextPollInterval` so we
 * don't poll faster than the server allows (which would throttle).
 */
async function poll<T>(
  ids: AppConfigProfileIdentifiers,
  parse: (json: unknown) => T,
  entry: CacheEntry<T>
): Promise<number> {
  let response: GetLatestConfigurationCommandOutput
  try {
    const dataClient = getClient()

    if (!entry.nextToken) {
      entry.remoteMatchesValue = false
      const session = await dataClient.send(
        new StartConfigurationSessionCommand({
          ApplicationIdentifier: ids.application,
          EnvironmentIdentifier: ids.environment,
          ConfigurationProfileIdentifier: ids.profile,
        }),
        { abortSignal: AbortSignal.timeout(5000) }
      )
      entry.nextToken = session.InitialConfigurationToken
    }

    response = await dataClient.send(
      new GetLatestConfigurationCommand({ ConfigurationToken: entry.nextToken }),
      { abortSignal: AbortSignal.timeout(5000) }
    )
    entry.nextToken = response.NextPollConfigurationToken ?? entry.nextToken
  } catch (error) {
    /** A failed or expired session retries after backoff without renewing snapshot freshness. */
    entry.nextToken = undefined
    logger.error('AppConfig fetch failed; serving last known value', {
      profile: cacheKey(ids),
      error: getErrorMessage(error),
    })
    return DEFAULT_TTL_MS
  }

  /** Decode failures retain the rotated session token and last validated value. */
  try {
    if (response.Configuration && response.Configuration.length > 0) {
      entry.remoteMatchesValue = false
      if (entry.strict && response.Configuration.length > 1_048_576) {
        throw new Error('Configuration exceeds the maximum size')
      }
      const text = new TextDecoder().decode(response.Configuration)
      entry.value = parse(JSON.parse(text))
      entry.remoteMatchesValue = true
    }
    if (entry.remoteMatchesValue && entry.value !== null) {
      entry.validatedAt = Date.now()
    }
  } catch (error) {
    logger.error('AppConfig response parse failed; serving last known value', {
      profile: cacheKey(ids),
      error: entry.strict ? 'Configuration rejected' : getErrorMessage(error),
    })
  }

  const intervalMs = (response.NextPollIntervalInSeconds ?? 60) * 1000
  return Math.max(DEFAULT_TTL_MS, intervalMs)
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
  const entry = await cache.fetch(cacheKey(ids), {
    context: { ids, parse, strict: false },
    allowStale: true,
  })
  return (entry?.value ?? null) as T | null
}

/**
 * Security-sensitive callers receive freshness evidence instead of an implicit fallback.
 * Due polls are awaited and deduplicated. Rejected remote revisions cannot renew an old
 * snapshot through subsequent unchanged responses. The caller owns its maximum stale age.
 */
export async function fetchAppConfigSnapshot<T>(
  ids: AppConfigProfileIdentifiers,
  parse: (json: unknown) => T
): Promise<AppConfigSnapshot<T>> {
  const entry = await cache.fetch(`strict:${cacheKey(ids)}`, {
    context: { ids, parse, strict: true },
    allowStale: false,
  })
  return Object.freeze({
    value: (entry?.value ?? null) as T | null,
    validatedAt: entry?.validatedAt ?? null,
  })
}
