import { describe, expect, it } from 'vitest'
import { logWorkflowHref, resolveLogWorkflowId, workflowEditorPath } from '@/resources/log-source'
import { workspaceSource } from '@/resources/source'

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

describe('logWorkflowHref', () => {
  const workspace = workspaceSource({ kind: 'log', workspaceId: 'ws-1', resourceId: 'log-1' })

  it('links a workspace-hosted log to its workflow', () => {
    expect(logWorkflowHref(workspace, { trigger: 'manual', workflowId: 'wf-1' })).toBe(
      '/workspace/ws-1/w/wf-1'
    )
  })

  it('is null when the log has no reachable workflow', () => {
    expect(logWorkflowHref(workspace, { trigger: 'mothership', workflowId: 'wf-1' })).toBeNull()
    expect(logWorkflowHref(workspace, { trigger: 'manual', workflowId: null })).toBeNull()
  })
})
