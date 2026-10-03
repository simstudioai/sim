import { describe, expect, it } from 'vitest'
import { resolveLogWorkflowId } from './utils'

describe('resolveLogWorkflowId', () => {
  it('returns null for Sim agent jobs even when a workflow id exists', () => {
    expect(
      resolveLogWorkflowId({
        trigger: 'mothership',
        workflowId: 'wf-3',
        workflow: { id: 'wf-3' },
      })
    ).toBeNull()
  })
})
