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

  it('returns null for an archived workflow that still carries its id', () => {
    expect(
      resolveLogWorkflowId({
        trigger: 'manual',
        workflowId: 'wf-1',
        workflow: { id: 'wf-1', archivedAt: '2026-01-01T00:00:00.000Z' },
      })
    ).toBeNull()
  })
})
