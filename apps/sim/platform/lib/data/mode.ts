import 'server-only'

type PlatformMode = 'fixture' | 'live'

/**
 * Where this server's data comes from, read once per request by each server entry. Example data
 * is a design preview for the development server only: it renders with no login, so a production
 * build serves live data whatever its environment says. Live reads run the application's use
 * cases in process.
 */
export function resolvePlatformMode(): PlatformMode {
  return process.env.NODE_ENV !== 'production' && process.env.SIM_PLATFORM_FIXTURES === '1'
    ? 'fixture'
    : 'live'
}
