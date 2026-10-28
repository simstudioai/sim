import { describe, expect, it } from 'vitest'
import { getLogWorkflowLabel, resolveLogWorkflowId } from './utils'

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

describe('getLogWorkflowLabel', () => {
  it('keeps an archived workflow named', () => {
    expect(
      getLogWorkflowLabel({
        trigger: 'manual',
        workflowId: 'wf-1',
        workflow: { id: 'wf-1', name: 'Nightly sync', archivedAt: '2026-01-01T00:00:00.000Z' },
      })
    ).toBe('Nightly sync')
  })

  it('labels a hard-deleted workflow, which leaves no workflow id, as deleted', () => {
    expect(getLogWorkflowLabel({ trigger: 'manual', workflowId: null, workflow: null })).toBe(
      'Deleted Workflow'
    )
  })
})
