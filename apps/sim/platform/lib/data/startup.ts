import 'server-only'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { assertDeployableMode } from '@/platform/lib/data/mode'

const logger = createLogger('PlatformZone')

/**
 * Stops a misconfigured production zone. Throwing is not enough: Next logs a failed `register()` and
 * keeps the process up answering 500, which a supervisor reads as running. Only exiting fails the
 * deployment. Apart from `mode`, because the zone's proxy imports that and has no use for this.
 */
export function exitUnlessDeployable() {
  try {
    assertDeployableMode()
  } catch (error) {
    logger.error('Refusing to start', { error: getErrorMessage(error) })
    process.exit(1)
  }
}
