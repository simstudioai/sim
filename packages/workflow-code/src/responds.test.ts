import { describe, expect, it } from 'vitest'
import type { CanonicalBlock } from './model'
import { calledWorkflowKey } from './responds'

function blockNaming(type: string, workflowKey: string): CanonicalBlock {
  return {
    key: 'call',
    name: 'Call',
    type,
    parent: null,
    enabled: true,
    locked: false,
    triggerMode: false,
    advancedMode: false,
    errorPort: true,
    retry: null,
    params: {
      workflowId: {
        kind: 'value',
        value: { $sim: 'resource', kind: 'workflow', key: workflowKey },
      },
    },
    modes: {},
  }
}

describe('calledWorkflowKey', () => {
  it('names the child of a block that runs one', () => {
    expect(calledWorkflowKey(blockNaming('workflow_input', 'billing'))).toBe('billing')
    expect(calledWorkflowKey(blockNaming('workflow', 'billing'))).toBe('billing')
  })

  it('is null for a block that names a workflow it never runs', () => {
    expect(calledWorkflowKey(blockNaming('deployments', 'billing'))).toBeNull()
  })
})
