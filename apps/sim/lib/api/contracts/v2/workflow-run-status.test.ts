import { describe, expect, it } from 'vitest'
import {
  v2WorkflowRunListStatusValueSchema,
  v2WorkflowRunStatusFilterSchema,
  v2WorkflowRunStatusValueSchema,
} from '@/lib/api/contracts/v2/workflows'
import { PERSISTED_WORKFLOW_EXECUTION_STATUSES } from '@/lib/logs/types'

/**
 * Both run endpoints report `workflow_execution_logs.status`, overlaid with `paused` from
 * `paused_executions`, so every reported value lands in the persisted set. These tests
 * guard the two ways that can break: the derivation being replaced by a hand-maintained
 * list again, and a status being added to the persisted set without anyone confirming it
 * belongs on the public wire (and regenerating the OpenAPI specs).
 */
describe('v2 workflow run status schemas', () => {
  it('publishes exactly the persisted statuses on the run list', () => {
    expect(v2WorkflowRunListStatusValueSchema.options).toEqual([
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
    expect(v2WorkflowRunListStatusValueSchema.options).toEqual([
      ...PERSISTED_WORKFLOW_EXECUTION_STATUSES,
    ])
    expect(v2WorkflowRunStatusValueSchema.options).toEqual([
      ...PERSISTED_WORKFLOW_EXECUTION_STATUSES,
      'queued',
    ])
  })

  it('reports queued only where the job queue is consulted', () => {
    expect(v2WorkflowRunStatusValueSchema.options).toEqual([
      'pending',
      'running',
      'paused',
      'redacting',
      'completed',
      'failed',
      'cancelled',
      'queued',
    ])
    expect(v2WorkflowRunListStatusValueSchema.safeParse('queued').success).toBe(false)
  })

  it('keeps the list filter narrower than the reported set', () => {
    expect(v2WorkflowRunStatusFilterSchema.safeParse('redacting').success).toBe(false)
    expect(v2WorkflowRunStatusFilterSchema.safeParse('queued').success).toBe(false)
    expect(v2WorkflowRunStatusFilterSchema.parse('paused')).toBe('paused')
  })
})
