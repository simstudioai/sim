/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { logOperations } from '@/lib/logs/application/operations'

describe('logs operation registry', () => {
  it('admits workflow execution only to the three semantic read operations it needs', () => {
    expect(logOperations.list.workflowExecution).toBe('allow')
    expect(logOperations.readDetail.workflowExecution).toBe('allow')
    expect(logOperations.readExecutionSnapshot.workflowExecution).toBe('allow')
    expect(logOperations.readStats.workflowExecution).toBeUndefined()

    for (const operation of Object.values(logOperations)) {
      expect(operation.minimumRole).toBe('read')
    }
  })
})
