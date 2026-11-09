import 'server-only'
import { isPlatformFixtureBuild } from '@/lib/core/config/platform-fixtures'

type PlatformMode = 'fixture' | 'live'

/**
 * Where this build's data comes from. Live reads run the application's use cases in process;
 * example data is the fixture build's design preview, chosen when the app is built
 * (`isPlatformFixtureBuild`). A gate that only answers not found reads this; a branch that imports
 * fixture code tests the inlined constant itself so a normal build drops it.
 */
export function resolvePlatformMode(): PlatformMode {
  return isPlatformFixtureBuild() ? 'fixture' : 'live'
}
