import { createLogger } from '@sim/logger'
import { getAppOriginStatus } from '@/lib/apps/origin'

const logger = createLogger('AppsStartup')

let validated = false

/** Idempotent startup check — call from instrumentation or first apps request. */
export function validateAppsOriginAtStartup(): void {
  if (validated) return
  validated = true

  const status = getAppOriginStatus()
  if (status.enabled) {
    logger.info('Full-stack Apps origin OK', { appPublicOrigin: status.appPublicOrigin })
  } else {
    logger.warn('Full-stack Apps disabled', { reason: status.reason })
  }
}
