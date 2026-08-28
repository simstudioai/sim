/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { logsGetExecutionTool } from '@/tools/logs/get_execution'
import { logsGetTool } from '@/tools/logs/get_log'
import { logsGetRunDetailsTool } from '@/tools/logs/get_run_details'
import { logsQueryTool } from '@/tools/logs/query'
import { logsQueryRunsTool } from '@/tools/logs/query_runs'

describe('Logs operation inputs', () => {
  it('materializes semantic identifiers without HTTP route metadata', () => {
    expect(logsGetTool.request).toBeUndefined()
    expect(logsGetTool.operation.input({ id: 'log-1' })).toEqual({ id: 'log-1' })
    expect(logsGetRunDetailsTool.operation.input({ runId: 'execution-1' })).toEqual({
      executionId: 'execution-1',
    })
    expect(logsGetExecutionTool.operation.input({ executionId: 'execution-1' })).toEqual({
      executionId: 'execution-1',
    })
  })

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
