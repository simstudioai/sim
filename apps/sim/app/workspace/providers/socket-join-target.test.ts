import { describe, expect, it } from 'vitest'
import {
  isSocketWorkflowVisible,
  resolveSocketWorkflowTarget,
} from '@/app/workspace/providers/socket-join-target'

describe('socket join target helpers', () => {
  it('uses the route workflow when there is no explicit workflow target', () => {
    expect(
      resolveSocketWorkflowTarget({
        routeWorkflowId: 'workflow-route',
        explicitWorkflowId: null,
      })
    ).toBe('workflow-route')
  })

  it('prefers the explicit workflow target for embedded workflows', () => {
    expect(
      resolveSocketWorkflowTarget({
        routeWorkflowId: null,
        explicitWorkflowId: 'workflow-embedded',
      })
    ).toBe('workflow-embedded')
  })

  it('lets an explicit workflow override the route workflow', () => {
    expect(
      resolveSocketWorkflowTarget({
        routeWorkflowId: 'workflow-route',
        explicitWorkflowId: 'workflow-embedded',
      })
    ).toBe('workflow-embedded')
  })

  it('treats the explicit embedded workflow as visible', () => {
    expect(
      isSocketWorkflowVisible({
        workflowId: 'workflow-embedded',
        routeWorkflowId: null,
        explicitWorkflowId: 'workflow-embedded',
      })
    ).toBe(true)
  })

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
