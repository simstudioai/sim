#!/usr/bin/env bun

/**
 * Starts the projection source and ACL backfill that script migration
 * `0021_embedding_search_connector` leaves to the background, by hand. The migration's outbox
 * event already starts it after a deploy; this is for starting it again — on a deployment with
 * Trigger.dev it enqueues the `projection-source-acl-backfill` task, which chains bounded runs
 * until both ranking projections are filled; without one it fills them here, paced the same way.
 * Safe to run at any time — a run only fills rows still unset.
 *
 * Usage:
 *   bun apps/sim/scripts/backfill-projection-source-acl.ts
 */

import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import {
  enqueueProjectionSourceAclBackfill,
  projectionSourceAclBackfillUsesTrigger,
  runProjectionSourceAclBackfill,
} from '@/lib/knowledge/search/projection-source-acl-backfill'

const logger = createLogger('BackfillProjectionSourceAcl')

async function main(): Promise<void> {
  if (projectionSourceAclBackfillUsesTrigger()) {
    const handle = await enqueueProjectionSourceAclBackfill()
    logger.info('Backfill enqueued on the Trigger.dev worker', handle)
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
