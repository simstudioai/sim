import { createLogger } from '@sim/logger'
import { getRedisClient } from '@/lib/core/config/redis'
import { runWithOutboundOrganization } from '@/lib/core/network/context.server'
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { faviconHostCandidates } from '@/lib/favicon/hosts'
import { classifyProviderResponse, MAX_ICON_BYTES } from '@/lib/favicon/probe'

const logger = createLogger('Favicon')

const PROVIDER_TIMEOUT_MS = 1500
const RESOLVE_DEADLINE_MS = 4000
const HIT_TTL_SECONDS = 30 * 24 * 60 * 60
const MISS_TTL_SECONDS = 24 * 60 * 60
/** A parent's icon chosen because the host's own lookup timed out: retried a day later, not a month. */
const PROVISIONAL_HIT_TTL_SECONDS = 24 * 60 * 60
const UNAVAILABLE_TTL_SECONDS = 5 * 60
/**
 * Cached values: a hit is one prefix byte — definite or provisional, which a host reusing it
 * must inherit — followed by the icon; the markers stand for no icon and for an outage.
 */
const DEFINITE_HIT_PREFIX = 'h'
const PROVISIONAL_HIT_PREFIX = 'p'
const MISS_MARKER = ''
const UNAVAILABLE_MARKER = '-'

/**
 * Icon providers, most complete first. Both answer a host they don't know with a 404, which
 * is what lets a miss fall through to the next provider and then to the parent domain.
 */
const PROVIDERS: readonly ((host: string) => string)[] = [
  (host) =>
    `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${host}&size=64`,
  (host) => `https://icons.duckduckgo.com/ip3/${host}.ico`,
]

type FaviconResolution =
  | { kind: 'hit'; contentType: string; bytes: Buffer; provisional?: true }
  | { kind: 'miss' }
  | { kind: 'unavailable' }

const inFlight = new Map<string, Promise<FaviconResolution>>()

const cacheKey = (host: string) => `favicon:v3:${host}`

/** A host's key holds the result of the walk that starts at that host. */
async function readCache(host: string): Promise<FaviconResolution | null> {
  const redis = getRedisClient()
  if (!redis) return null
  try {
    const cached = await redis.getBuffer(cacheKey(host))
    if (cached === null) return null
    if (cached.toString() === UNAVAILABLE_MARKER) return { kind: 'unavailable' }
    const prefix = cached.subarray(0, 1).toString()
    const bytes = cached.subarray(1)
    // Cached under an earlier, larger cap: look it up again rather than serve it or call it a miss.
    if (bytes.length > MAX_ICON_BYTES) return null
    const result = classifyProviderResponse(200, bytes)
    if (result.kind !== 'hit') return { kind: 'miss' }
    return prefix === PROVISIONAL_HIT_PREFIX
      ? { ...result, bytes, provisional: true }
      : { ...result, bytes }
  } catch (error) {
    logger.warn('Favicon cache read failed', { error })
    return null
  }
}

async function writeCache(host: string, resolution: FaviconResolution): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return
  const [value, ttl] =
    resolution.kind === 'hit'
      ? resolution.provisional
        ? ([
            Buffer.concat([Buffer.from(PROVISIONAL_HIT_PREFIX), resolution.bytes]),
            PROVISIONAL_HIT_TTL_SECONDS,
          ] as const)
        : ([
            Buffer.concat([Buffer.from(DEFINITE_HIT_PREFIX), resolution.bytes]),
            HIT_TTL_SECONDS,
          ] as const)
      : resolution.kind === 'miss'
        ? ([MISS_MARKER, MISS_TTL_SECONDS] as const)
        : ([UNAVAILABLE_MARKER, UNAVAILABLE_TTL_SECONDS] as const)
  try {
    await redis.set(cacheKey(host), value, 'EX', ttl)
  } catch (error) {
    logger.warn('Favicon cache write failed', { error })
  }
}

async function askProvider(url: string, signal: AbortSignal): Promise<FaviconResolution> {
  try {
    const response = await secureFetchWithValidation(url, {
      profile: 'contentFetch',
      timeout: PROVIDER_TIMEOUT_MS,
      maxRedirects: 2,
      maxResponseBytes: MAX_ICON_BYTES,
      signal,
      headers: { Accept: 'image/png,image/x-icon,image/jpeg,image/gif,image/webp' },
    })
    let bytes = Buffer.alloc(0)
    if (response.status === 200) bytes = Buffer.from(await response.arrayBuffer())
    else await response.body?.cancel().catch(() => {})
    const result = classifyProviderResponse(response.status, bytes)
    return result.kind === 'hit' ? { ...result, bytes } : result
  } catch (error) {
    return isPayloadSizeLimitError(error) ? { kind: 'miss' } : { kind: 'unavailable' }
  }
}

/** One provider at a time, so the next only learns a host the previous had no icon for. */
async function askProviders(host: string, signal: AbortSignal): Promise<FaviconResolution> {
  let unavailable = false
  for (const provider of PROVIDERS) {
    const result = await askProvider(provider(host), signal)
    if (result.kind === 'hit') return result
    if (result.kind === 'unavailable') unavailable = true
  }
  return unavailable ? { kind: 'unavailable' } : { kind: 'miss' }
}

/**
 * The most specific host first, so a tenant's own icon beats its platform's. A parent already
 * resolved for a sibling subdomain is reused from the cache instead of asked again. A parent's
 * icon reached only because a more specific lookup was unavailable is `provisional`: the host's
 * own icon may exist, so it is not remembered for long.
 */
async function walk(candidates: string[], signal: AbortSignal): Promise<FaviconResolution> {
  let unavailable = false
  const covered = new Set<string>()
  for (const [index, host] of candidates.entries()) {
    if (covered.has(host)) continue
    const parent = index > 0
    const cached = parent ? await readCache(host) : null
    if (cached?.kind === 'hit') {
      return unavailable || cached.provisional ? { ...cached, provisional: true } : cached
    }
    if (cached) {
      if (cached.kind === 'unavailable') unavailable = true
      for (const reached of faviconHostCandidates(host)) covered.add(reached)
      continue
    }
    const result = await askProviders(host, signal)
    if (result.kind === 'hit') {
      if (parent) await writeCache(host, result)
      return unavailable ? { ...result, provisional: true } : result
    }
    if (result.kind === 'unavailable') unavailable = true
  }
  return unavailable ? { kind: 'unavailable' } : { kind: 'miss' }
}

/**
 * The icon for a host, or its nearest parent domain's, from public icon providers — Sim never
 * contacts the destination itself (a provider may, from its own servers), so a host behind a
 * login still gets its platform's icon. Results are cached per host (30 days for an icon, a day
 * for none or for a parent's icon chosen after a timeout, minutes after an outage), and
 * concurrent lookups of one host in this process share a single resolution. `admitLookup` is
 * the caller's own budget, asked only when nothing is cached and no lookup of the host is already
 * running: refused, the host is reported unavailable to this caller alone and nothing is cached,
 * so cached icons and lookups shared with another caller stay free.
 */
export async function resolveFavicon(
  host: string,
  admitLookup: () => Promise<boolean> = async () => true
): Promise<FaviconResolution> {
  const candidates = faviconHostCandidates(host)
  const requested = candidates[0]
  if (!requested) return { kind: 'miss' }
  const joined = inFlight.get(requested)
  if (joined) return joined
  const cached = await readCache(requested)
  if (cached) return cached
  if (!(await admitLookup())) return { kind: 'unavailable' }
  // Another caller may have started the same lookup while this one read the cache and its budget.
  const pending = inFlight.get(requested)
  if (pending) return pending

  const resolution = (async (): Promise<FaviconResolution> => {
    const resolved = await runWithOutboundOrganization(null, () =>
      walk(candidates, AbortSignal.timeout(RESOLVE_DEADLINE_MS))
    ).catch((): FaviconResolution => ({ kind: 'unavailable' }))
    await writeCache(requested, resolved)
    return resolved
  })().finally(() => inFlight.delete(requested))
  inFlight.set(requested, resolution)
  return resolution
}
