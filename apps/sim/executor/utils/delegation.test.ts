/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { executionScopeForTarget } from '@/executor/utils/delegation'

describe('executionScopeForTarget', () => {
  it('binds the execution when the target is the running workflow', () => {
    expect(
      executionScopeForTarget({ workflowId: 'workflow-1', executionId: 'run-1' }, 'workflow-1')
    ).toEqual({ executionId: 'run-1' })
  })

  it('omits the execution for a child workflow, which binds on its own id', () => {
    expect(
      executionScopeForTarget({ workflowId: 'parent', executionId: 'run-1' }, 'child')
    ).toEqual({})
  })

  it('omits the execution outside an active run', () => {
    expect(executionScopeForTarget({ workflowId: 'workflow-1' }, 'workflow-1')).toEqual({})
  })

  it('omits the execution when the context has no workflow to compare', () => {
    expect(executionScopeForTarget({ executionId: 'run-1' }, 'workflow-1')).toEqual({})
  })
})
