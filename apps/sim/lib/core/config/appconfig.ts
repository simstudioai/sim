import {
  AppConfigDataClient,
  GetLatestConfigurationCommand,
  type GetLatestConfigurationCommandOutput,
  StartConfigurationSessionCommand,
} from '@aws-sdk/client-appconfigdata'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { toRecordOrNull } from '@sim/utils/object'
import { LRUCache } from 'lru-cache'
import { getAwsCredentialsFromEnv } from '@/lib/core/config/aws'
import { env } from '@/lib/core/config/env'

const logger = createLogger('AppConfig')

const DEFAULT_TTL_MS = 30_000

/**
 * Oldest shared snapshot a Trigger.dev run adopts. Long-lived app processes
 * republish on every poll (at most every 60s each), so a healthy fleet keeps the
 * snapshot well inside this window; anything older falls back to AppConfig.
 */
const SHARED_SNAPSHOT_MAX_AGE_MS = 120_000
/** Publisher and reader clocks differ; a snapshot this far in the future is still current. */
const SHARED_SNAPSHOT_CLOCK_SKEW_MS = 5_000
const SHARED_SNAPSHOT_KEY_TTL_MS = 600_000
const SHARED_SNAPSHOT_KEY_PREFIX = 'appconfig:snapshot:v1:'

/**
 * Stores a snapshot only when its `validatedAt` is later than the one already held.
 * `validatedAt` records when a process last confirmed its document, not which
 * revision it holds: after a deployment, a process that has not polled yet can
 * still overwrite the new document, for at most one poll interval.
 */
const PUBLISH_SNAPSHOT_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if current then
  local ok, decoded = pcall(cjson.decode, current)
  if ok and type(decoded) == 'table' and tonumber(decoded.validatedAt) and tonumber(decoded.validatedAt) >= tonumber(ARGV[2]) then
    return 0
  end
end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[3])
return 1
`

export interface AppConfigProfileIdentifiers {
  application: string
  environment: string
  profile: string
}

interface CacheEntry<T> {
  /** Last successfully parsed value, or `null` if the config is empty/unseeded. */
  value: T | null
  /** Raw document behind `value`, republished so other processes run their own `parse`. */
  raw: string | null
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
  shared: boolean
}

interface AppConfigProfileOptions {
  /**
   * Publish this profile to Redis from app processes, and let Trigger.dev runs
   * adopt it there instead of opening their own AppConfig session. Only for
   * profiles whose readers tolerate up to {@link SHARED_SNAPSHOT_MAX_AGE_MS}
   * of extra propagation delay inside runs.
   */
  shareWithTriggerRuns?: boolean
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
      raw: null,
      nextToken: undefined,
      validatedAt: null,
      remoteMatchesValue: false,
      strict: context.strict,
    }
    if (!entry.nextToken && context.shared && (await adoptSharedSnapshot(context, entry))) {
      options.ttl = DEFAULT_TTL_MS
      return entry
    }
    options.ttl = await poll(context.ids, context.parse, entry)
    if (context.shared) publishSharedSnapshot(context.ids, entry)
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
      entry.raw = text
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

function sharedSnapshotKey(ids: AppConfigProfileIdentifiers): string {
  return `${SHARED_SNAPSHOT_KEY_PREFIX}${cacheKey(ids)}`
}

/**
 * Every Trigger.dev run starts a fresh process, and each new AppConfig session is
 * billed for the full configuration it receives. A run therefore adopts the
 * snapshot the long-lived app processes publish, and opens its own session only
 * when that snapshot is missing, stale, unreadable, or fails `parse`.
 */
async function adoptSharedSnapshot(
  context: PollContext,
  entry: CacheEntry<unknown>
): Promise<boolean> {
  try {
    const { isInsideTriggerRun } = await import('@/lib/core/config/trigger-runtime')
    if (!isInsideTriggerRun()) return false
    const { getRedisClient } = await import('@/lib/core/config/redis')
    const redis = getRedisClient()
    if (!redis) return false
    const stored = await redis.get(sharedSnapshotKey(context.ids))
    if (!stored) return false
    const snapshot = toRecordOrNull(JSON.parse(stored))
    const raw = snapshot?.raw
    const validatedAt = snapshot?.validatedAt
    if (typeof raw !== 'string' || typeof validatedAt !== 'number') return false
    const age = Date.now() - validatedAt
    if (age < -SHARED_SNAPSHOT_CLOCK_SKEW_MS || age >= SHARED_SNAPSHOT_MAX_AGE_MS) return false
    entry.value = context.parse(JSON.parse(raw))
    entry.raw = raw
    entry.validatedAt = validatedAt
    return true
  } catch (error) {
    logger.warn('Shared AppConfig snapshot unavailable; polling AppConfig', {
      profile: cacheKey(context.ids),
      error: getErrorMessage(error),
    })
    return false
  }
}

/**
 * Fire-and-forget: publishing never delays or fails the caller's read. Only app
 * processes publish, so every stored `validatedAt` comes from one fleet's clock.
 */
function publishSharedSnapshot(ids: AppConfigProfileIdentifiers, entry: CacheEntry<unknown>): void {
  const { raw, validatedAt } = entry
  if (raw === null || validatedAt === null || !entry.remoteMatchesValue) return
  void (async () => {
    const { isInsideTriggerRun } = await import('@/lib/core/config/trigger-runtime')
    if (isInsideTriggerRun()) return
    const { getRedisClient } = await import('@/lib/core/config/redis')
    const redis = getRedisClient()
    if (!redis) return
    await redis.eval(
      PUBLISH_SNAPSHOT_SCRIPT,
      1,
      sharedSnapshotKey(ids),
      JSON.stringify({ raw, validatedAt }),
      String(validatedAt),
      String(SHARED_SNAPSHOT_KEY_TTL_MS)
    )
  })().catch((error) => {
    logger.warn('Failed to publish shared AppConfig snapshot', {
      profile: cacheKey(ids),
      error: getErrorMessage(error),
    })
  })
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
 *
 * With `shareWithTriggerRuns`, a cold cache inside a Trigger.dev run first adopts
 * the snapshot that app processes publish to Redis (see {@link adoptSharedSnapshot}).
 */
export async function fetchAppConfigProfile<T>(
  ids: AppConfigProfileIdentifiers,
  parse: (json: unknown) => T,
  options: AppConfigProfileOptions = {}
): Promise<T | null> {
  const entry = await cache.fetch(cacheKey(ids), {
    context: { ids, parse, strict: false, shared: options.shareWithTriggerRuns === true },
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
    context: { ids, parse, strict: true, shared: false },
    allowStale: false,
  })
  return Object.freeze({
    value: (entry?.value ?? null) as T | null,
    validatedAt: entry?.validatedAt ?? null,
  })
}
