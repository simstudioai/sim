import { describe, expect, it } from 'vitest'
import { selectorKeys } from '@/hooks/queries/utils/selector-keys'

describe('selectorKeys', () => {
  it('isolates organizations from workspaces and from each other', () => {
    const organization = selectorKeys.scoped(
      'gmail.labels',
      { kind: 'organization', organizationId: 'scope-1' },
      'source'
    )
    expect(organization).not.toEqual(
      selectorKeys.scoped('gmail.labels', { kind: 'workspace', workspaceId: 'scope-1' }, 'source')
    )
    expect(organization).not.toEqual(
      selectorKeys.scoped(
        'gmail.labels',
        { kind: 'organization', organizationId: 'scope-2' },
        'source'
      )
    )
  })
  it('separates workflow requests with different asserted workspaces', () => {
    const first = selectorKeys.scoped(
      'gmail.labels',
      { kind: 'workflow', workflowId: 'workflow-1', workspaceId: 'workspace-1' },
      'surface-1'
    )
    const second = selectorKeys.scoped(
      'gmail.labels',
      { kind: 'workflow', workflowId: 'workflow-1', workspaceId: 'workspace-2' },
      'surface-1'
    )

    expect(first).not.toEqual(second)
  })
})
