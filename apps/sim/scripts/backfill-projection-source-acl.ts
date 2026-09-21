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

/** `--shards <n>` as given, or one; a value that is not a whole number is refused here. */
function shardsFlag(): number {
  const flag = process.argv.indexOf('--shards')
  if (flag === -1) return 1
  const shards = Number(process.argv[flag + 1])
  if (!Number.isInteger(shards) || shards < 1) {
    throw new Error(`--shards must be a positive whole number, got ${process.argv[flag + 1]}`)
  }
  return shards
}

/**
 * A script has no long-lived process to detach into, so without a worker it fills inline, one
 * pass over the whole id space. With a worker, `--shards <n>` slices the id space so that many
 * runs fill at once; inline there is nothing to slice across, so the flag is refused there.
 */
async function main(): Promise<void> {
  const shards = shardsFlag()
  if (isTriggerDevEnabled && env.TRIGGER_SECRET_KEY) {
    const started = await enqueueProjectionSourceAclBackfill({}, shards)
    logger.info('Backfill enqueued on the Trigger.dev worker', started)
    return
  }
  if (shards !== 1)
    throw new Error('--shards needs the Trigger.dev worker; the inline fill is one pass')
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
