import { metadata } from '@trigger.dev/sdk'
import { validateBoundedCleanupOptions } from '@/lib/api/contracts/cleanup'
import { type CleanupJobPayload, forEachCleanupChunk } from '@/lib/billing/cleanup-dispatcher'
import { BoundedCleanup, CleanupTimeBudgetReached } from '@/lib/cleanup/bounded'
import {
  type BoundedCleanupJobType,
  type BoundedCleanupPayload,
  LOG_CLEANUP_TYPES,
  SOFT_DELETE_CLEANUP_TYPES,
} from '@/lib/cleanup/bounded-types'
import { isBillingEnabled, isDataRetentionEnabled } from '@/lib/core/config/env-flags'

/** Execute scopes in this run; never fan out budgets into child jobs. */
export async function runBoundedCleanup(
  jobType: BoundedCleanupJobType,
  payload: BoundedCleanupPayload,
  runScope: (payload: CleanupJobPayload, control: BoundedCleanup) => Promise<void>
) {
  const options = validateBoundedCleanupOptions(
    payload.options,
    jobType === 'cleanup-logs' ? LOG_CLEANUP_TYPES : SOFT_DELETE_CLEANUP_TYPES
  )
  const control = new BoundedCleanup(options, async (progress) => {
    metadata.set('cleanup', progress)
    await metadata.flush()
  })
  try {
    if (!isBillingEnabled && !isDataRetentionEnabled) throw new Error('Data retention is disabled')
    await control.checkpoint()
    await forEachCleanupChunk(
      jobType,
      async (scope) => {
        await runScope(scope, control)
        control.progress.stage = 'scopes'
        await control.checkpoint()
      },
      {
        shouldStop: () => control.stopped(),
        strict: true,
        query: control.query,
      }
    )
    return await control.finish()
  } catch (error) {
    if (error instanceof CleanupTimeBudgetReached) return control.finish()
    await control.fail(error)
    throw error
  }
}
