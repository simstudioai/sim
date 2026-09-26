import { describe, expect, it } from 'vitest'
import { isSocketWorkflowVisible } from '@/app/workspace/providers/socket-join-target'

describe('socket join target helpers', () => {
  it('rejects mismatched workflow visibility', () => {
    expect(
      isSocketWorkflowVisible({
        workflowId: 'workflow-other',
        routeWorkflowId: 'workflow-route',
        explicitWorkflowId: null,
      })
    ).toBe(false)
  })
})
