import 'server-only'

type PlatformMode = 'fixture' | 'live' | 'none'

/**
 * Where this server's data comes from, read once per request by each server entry. Fixtures win so
 * a design session stays on its examples even with an API origin in its environment. With neither,
 * routes render their empty fixture-off states.
 */
export function resolvePlatformMode(): PlatformMode {
  if (process.env.SIM_PLATFORM_FIXTURES === '1') return 'fixture'
  return process.env.SIM_PLATFORM_API_ORIGIN ? 'live' : 'none'
}
