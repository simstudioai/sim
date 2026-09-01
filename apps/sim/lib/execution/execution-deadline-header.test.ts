/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  INTERNAL_EXECUTION_DEADLINE_HEADER,
  parseExecutionDeadlineHeader,
  parseRemainingExecutionDeadlineMs,
} from '@/lib/execution/execution-deadline-header'

describe('internal execution deadline header', () => {
  it('returns the remaining budget from an absolute deadline', () => {
    const headers = new Headers({ [INTERNAL_EXECUTION_DEADLINE_HEADER]: '12000' })

    expect(parseExecutionDeadlineHeader(headers)).toBe(12000)
    expect(parseRemainingExecutionDeadlineMs(headers, 5000)).toBe(7000)
  })

  it('returns a one millisecond budget for an expired deadline', () => {
    const headers = new Headers({ [INTERNAL_EXECUTION_DEADLINE_HEADER]: '4000' })

    expect(parseRemainingExecutionDeadlineMs(headers, 5000)).toBe(1)
  })

  it.each(['', 'invalid', '1.5', '-1'])('ignores invalid deadline %j', (value) => {
    const headers = new Headers({ [INTERNAL_EXECUTION_DEADLINE_HEADER]: value })

    expect(parseExecutionDeadlineHeader(headers)).toBeUndefined()
    expect(parseRemainingExecutionDeadlineMs(headers, 5000)).toBeUndefined()
  })
})
