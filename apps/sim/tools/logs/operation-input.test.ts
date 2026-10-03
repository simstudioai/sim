import { describe, expect, it } from 'vitest'
import { logsQueryTool } from '@/tools/logs/query'
import { logsQueryRunsTool } from '@/tools/logs/query_runs'

describe('Logs operation inputs', () => {
  it('preserves list filters and converts user-facing credits to dollars', () => {
    expect(
      logsQueryTool.operation.input({
        workflowIds: 'workflow-1',
        level: 'all',
        limit: 25,
      })
    ).toMatchObject({ workflowIds: 'workflow-1', level: undefined, limit: 25 })
    expect(
      logsQueryRunsTool.operation.input({
        costOperator: '>=',
        costValue: 50,
        durationOperator: '<',
        durationValue: 1000,
      })
    ).toMatchObject({
      costOperator: '>=',
      costValue: 0.25,
      durationOperator: '<',
      durationValue: 1000,
    })
  })
})
