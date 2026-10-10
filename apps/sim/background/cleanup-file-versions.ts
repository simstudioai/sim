import { createLogger } from '@sim/logger'
import { task } from '@trigger.dev/sdk'
import type { CleanupJobPayload } from '@/lib/billing/cleanup-dispatcher'
import { DEFAULT_BATCH_SIZE, DEFAULT_MAX_BATCHES_PER_TABLE } from '@/lib/cleanup/batch-delete'
import { retentionCleanupQueue } from '@/lib/cleanup/queue'
import { cleanupFileVersions, fileRetentionOwners } from '@/lib/file-retention'

const logger = createLogger('CleanupFileVersions')
const MAX_VERSIONS_PER_RUN = DEFAULT_BATCH_SIZE * DEFAULT_MAX_BATCHES_PER_TABLE

export async function runCleanupFileVersions(payload: CleanupJobPayload): Promise<void> {
  const startTime = Date.now()
  const owners = fileRetentionOwners(payload)
  const deleted = await cleanupFileVersions(
    owners,
    {
      plan: payload.plan,
      cutoff: new Date(Date.now() - payload.retentionHours * 60 * 60 * 1000),
      label: payload.label,
    },
    MAX_VERSIONS_PER_RUN
  )
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
  logger.info(`[${payload.label}] File version cleanup: ${deleted} released in ${elapsed}s`)
}

export const cleanupFileVersionsTask = task({
  id: 'cleanup-file-versions',
  machine: 'large-1x',
  queue: retentionCleanupQueue,
  retry: { maxAttempts: 1 },
  run: runCleanupFileVersions,
})
