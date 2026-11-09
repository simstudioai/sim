import 'server-only'
import { isPlatformFixtureServer } from '@/lib/core/config/platform-fixtures'

type PlatformMode = 'fixture' | 'live'

/**
 * Where this server's data comes from, read once per request by each server entry. Live reads run
 * the application's use cases in process; example data is the development server's design preview.
 */
export function resolvePlatformMode(): PlatformMode {
  return isPlatformFixtureServer() ? 'fixture' : 'live'
}
