#!/usr/bin/env bun

/**
 * Starts the projection source and ACL backfill that script migration
 * `0021_embedding_search_connector` leaves to the background: on a deployment with Trigger.dev it
 * enqueues the `projection-source-acl-backfill` task, which chains bounded runs until both ranking
 * projections are filled; without one it fills them here, paced the same way. Safe to run again at
 * any time — a run only fills rows still unset.
 *
 * Usage:
 *   bun apps/sim/scripts/backfill-projection-source-acl.ts
 */

import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { enqueueProjectionSourceAclBackfill } from '@/lib/knowledge/search/projection-source-acl-backfill'

const logger = createLogger('BackfillProjectionSourceAcl')

if (import.meta.main) {
  enqueueProjectionSourceAclBackfill().then(
    (handle) => {
      logger.info(
        handle ? 'Backfill enqueued on the Trigger.dev worker' : 'Backfill complete',
        handle ?? {}
      )
      process.exit(0)
    },
    (error) => {
      logger.error('Backfill failed', toError(error))
      process.exit(1)
    }
  )
}
