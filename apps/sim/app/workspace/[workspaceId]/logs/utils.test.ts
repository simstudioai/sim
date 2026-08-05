/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { resolveLogWorkflowId, workflowEditorPath } from './utils'

describe('resolveLogWorkflowId', () => {
  it('returns the nested workflow id when present', () => {
    expect(
      resolveLogWorkflowId({ trigger: 'manual', workflowId: 'wf-1', workflow: { id: 'wf-1' } })
    ).toBe('wf-1')
  })

  it('falls back to workflowId when the workflow object is absent', () => {
    expect(resolveLogWorkflowId({ trigger: 'api', workflowId: 'wf-2', workflow: null })).toBe(
      'wf-2'
    )
  })

  it('prefers the nested workflow id over workflowId when both are set', () => {
    expect(
      resolveLogWorkflowId({ trigger: 'manual', workflowId: 'stale', workflow: { id: 'fresh' } })
    ).toBe('fresh')
  })

  it('returns null for Sim agent jobs even when a workflow id exists', () => {
    expect(
      resolveLogWorkflowId({
        trigger: 'mothership',
        workflowId: 'wf-3',
        workflow: { id: 'wf-3' },
      })
    ).toBeNull()
  })

  it('returns null for a deleted workflow (both id fields empty)', () => {
    expect(resolveLogWorkflowId({ trigger: 'manual', workflowId: null, workflow: null })).toBeNull()
  })

  it('returns null when ids are present but empty strings', () => {
    expect(
      resolveLogWorkflowId({ trigger: 'manual', workflowId: '', workflow: { id: '' } })
    ).toBeNull()
  })

  it('treats a missing trigger as a normal workflow run', () => {
    expect(resolveLogWorkflowId({ workflowId: 'wf-4' })).toBe('wf-4')
  })
})

describe('workflowEditorPath', () => {
  it('builds the workspace-scoped editor path', () => {
    expect(workflowEditorPath('ws-1', 'wf-1')).toBe('/workspace/ws-1/w/wf-1')
  })
})
