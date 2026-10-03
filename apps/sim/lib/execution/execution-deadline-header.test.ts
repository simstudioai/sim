import { describe, expect, it } from 'vitest'
import {
  INTERNAL_EXECUTION_DEADLINE_HEADER,
  parseExecutionDeadlineHeader,
} from '@/lib/execution/execution-deadline-header'

describe('internal execution deadline header', () => {
  it('parses an absolute deadline', () => {
    const headers = new Headers({ [INTERNAL_EXECUTION_DEADLINE_HEADER]: '12000' })

    expect(parseExecutionDeadlineHeader(headers)).toBe(12000)
  })

  it.each(['', 'invalid', '1.5', '-1'])('ignores invalid deadline %j', (value) => {
    const headers = new Headers({ [INTERNAL_EXECUTION_DEADLINE_HEADER]: value })

    expect(parseExecutionDeadlineHeader(headers)).toBeUndefined()
  })
})
