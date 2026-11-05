import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { env } from '@/lib/core/config/env'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'

const logger = createLogger('PlatformRollout')

/**
 * Whether this organization's legacy routes hand off to the Platform. The flag is never read on a
 * deployment with no Platform zone. A failed read keeps the organization on the legacy surface.
 */
export async function isPlatformOrgUiEnabled(organizationId: string): Promise<boolean> {
  if (!env.SIM_PLATFORM_ORIGIN) return false
  try {
    return await isFeatureEnabled('platform-org-ui', { orgId: organizationId })
  } catch (error) {
    logger.warn('Could not resolve the Platform rollout; staying on the legacy surface', {
      organizationId,
      error: getErrorMessage(error),
    })
    return false
  }
}
