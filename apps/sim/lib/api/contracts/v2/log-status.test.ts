import { describe, expect, it } from 'vitest'
import { v2LogStatusSchema } from '@/lib/api/contracts/v2/logs'
import { PERSISTED_WORKFLOW_EXECUTION_STATUSES } from '@/lib/logs/types'

/**
 * Both log endpoints pass `workflow_execution_logs.status` through verbatim — unlike the
 * run endpoints there is no `paused` overlay and no `queued` — so any drift between the
 * reported enum and the persisted list 500s a whole page of results.
 */
describe('v2 log status schema', () => {
  it('publishes exactly the persisted statuses', () => {
    expect(v2LogStatusSchema.options).toEqual([
      'pending',
      'running',
      'paused',
      'redacting',
      'completed',
      'failed',
      'cancelled',
    ])
  })

  it('stays derived from the persisted status list', () => {
    expect(v2LogStatusSchema.options).toEqual([...PERSISTED_WORKFLOW_EXECUTION_STATUSES])
  })
})
