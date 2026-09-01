import { createLogger } from '@sim/logger'
import { cleanupSandboxImages } from '@/lib/execution/remote-sandbox/image-registry'

const logger = createLogger('CleanupSandboxImages')

/**
 * Days a build may go unused before the retention sweep removes it. A rebuild is
 * cheap next to keeping every abandoned dependency set alive indefinitely, and
 * E2B's docs flag possible future template-storage pricing.
 */
export const SANDBOX_IMAGE_RETENTION_DAYS = 30

export async function runCleanupSandboxImages(): Promise<{ deleted: number; failed: number }> {
  const result = await cleanupSandboxImages(SANDBOX_IMAGE_RETENTION_DAYS)
  logger.info('Swept unreferenced sandbox images', {
    ...result,
    retentionDays: SANDBOX_IMAGE_RETENTION_DAYS,
  })
  return result
}
