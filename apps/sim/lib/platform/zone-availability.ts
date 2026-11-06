import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { LRUCache } from 'lru-cache'
import { getEnv } from '@/lib/core/config/env'
import { PLATFORM_BASE_PATH } from '@/lib/platform/routes'

const logger = createLogger('PlatformZoneAvailability')

/** How stale a verdict may get; a request past it is answered at once and triggers the next probe. */
const PROBE_INTERVAL_MS = 5_000
/** Only the first request after a start waits this long: every later one reads the last verdict. */
const PROBE_TIMEOUT_MS = 2_000
/**
 * No route answers this, so the zone renders its own not-found page. It reads nothing from the main
 * app, so a slow main app cannot read as a dead zone.
 */
const PROBE_PATH = `${PLATFORM_BASE_PATH}/__availability`

async function probe(origin: string): Promise<boolean> {
  try {
    // boundary-raw-fetch: a liveness probe of the zone's internal origin, which has no contract
    const response = await fetch(new URL(PROBE_PATH, origin), {
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    if (response.status < 500) return true
    logger.warn('Platform zone is failing; organizations stay on the main app', {
      status: response.status,
    })
    return false
  } catch (error) {
    logger.warn('Platform zone is unreachable; organizations stay on the main app', {
      error: getErrorMessage(error),
    })
    return false
  }
}

const verdicts = new LRUCache<string, boolean>({
  max: 4,
  ttl: PROBE_INTERVAL_MS,
  ttlResolution: 0,
  allowStale: true,
  fetchMethod: (origin) => probe(origin),
})

/** Whether this deployment has a Platform zone at all: configured, and built with its rewrite. */
export function isPlatformZoneDeployed(): boolean {
  return Boolean(getEnv('SIM_PLATFORM_ORIGIN')) && process.env.SIM_PLATFORM_ZONE_REWRITE === '1'
}

/**
 * Whether the zone can take a request. Next answers a rewrite it cannot complete with a bare 500 and
 * no way back, so the proxy reads this before sending anyone there. An outage therefore costs an
 * organization its Platform views, never the app: the main app still serves `/o` for all of them.
 */
export async function isPlatformZoneAvailable(): Promise<boolean> {
  const origin = getEnv('SIM_PLATFORM_ORIGIN')
  if (!origin) return false
  return (await verdicts.fetch(origin)) ?? false
}
