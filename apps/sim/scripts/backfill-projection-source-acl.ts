#!/usr/bin/env bun

/**
 * Starts the projection source and ACL backfill that script migration
 * `0022_projection_source_acl_backfill` leaves to the background. On a deployment with Trigger.dev
 * it enqueues the `projection-source-acl-backfill` task, which chains bounded runs until both
 * ranking projections are filled; without one it fills them here, paced the same way. Safe to run
 * again at any time — a run only fills rows still unset.
 *
 * Usage:
 *   bun apps/sim/scripts/backfill-projection-source-acl.ts
 */

import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { env } from '@/lib/core/config/env'
import { isTriggerDevEnabled } from '@/lib/core/config/env-flags'
import {
  enqueueProjectionSourceAclBackfill,
  runProjectionSourceAclBackfill,
} from '@/lib/knowledge/search/projection-source-acl-backfill'

const logger = createLogger('BackfillProjectionSourceAcl')

/** A script has no long-lived process to detach into, so without a worker it fills inline. */
async function main(): Promise<void> {
  if (isTriggerDevEnabled && env.TRIGGER_SECRET_KEY) {
    const handle = await enqueueProjectionSourceAclBackfill({}, true)
    logger.info('Backfill enqueued on the Trigger.dev worker', handle ?? {})
    return
  }
  await runProjectionSourceAclBackfill({})
  logger.info('Backfill complete')
}

if (import.meta.main) {
  main().then(
    () => process.exit(0),
    (error) => {
      logger.error('Backfill failed', toError(error))
      process.exit(1)
    }
  )
}
