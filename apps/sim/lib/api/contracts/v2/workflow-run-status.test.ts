import { describe, expect, it } from 'vitest'
import {
  v2WorkflowRunListStatusValueSchema,
  v2WorkflowRunStatusFilterSchema,
  v2WorkflowRunStatusValueSchema,
} from '@/lib/api/contracts/v2/workflows'
import type { PersistedWorkflowExecutionStatus } from '@/lib/logs/types'

/**
 * The runtime mirror of the persisted union. `satisfies` keeps it honest against
 * `PersistedWorkflowExecutionStatus`, and the `AssertNever` gate in the contract keeps
 * that union honest against the reported enums, so a status added to the execution logger
 * fails compilation in both places before it can 500 a response parse.
 */
const PERSISTED_STATUSES = [
  'pending',
  'running',
  'redacting',
  'completed',
  'failed',
  'cancelled',
] as const satisfies readonly PersistedWorkflowExecutionStatus[]

describe('v2 workflow run status schemas', () => {
  it.each(PERSISTED_STATUSES)('reports the persisted status %s on both run endpoints', (status) => {
    expect(v2WorkflowRunListStatusValueSchema.parse(status)).toBe(status)
    expect(v2WorkflowRunStatusValueSchema.parse(status)).toBe(status)
  })

  it('reports the paused overlay on both run endpoints', () => {
    expect(v2WorkflowRunListStatusValueSchema.parse('paused')).toBe('paused')
    expect(v2WorkflowRunStatusValueSchema.parse('paused')).toBe('paused')
  })

  it('reports queued only where the job queue is consulted', () => {
    expect(v2WorkflowRunStatusValueSchema.parse('queued')).toBe('queued')
    expect(v2WorkflowRunListStatusValueSchema.safeParse('queued').success).toBe(false)
  })

  it('keeps the list filter narrower than the reported set', () => {
    expect(v2WorkflowRunStatusFilterSchema.safeParse('redacting').success).toBe(false)
    expect(v2WorkflowRunStatusFilterSchema.safeParse('queued').success).toBe(false)
    expect(v2WorkflowRunStatusFilterSchema.parse('paused')).toBe('paused')
  })
})
