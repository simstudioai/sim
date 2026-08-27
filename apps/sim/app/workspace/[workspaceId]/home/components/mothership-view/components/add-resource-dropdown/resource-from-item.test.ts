/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { resourceFromItem } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown/resource-from-item'

describe('resourceFromItem', () => {
  it('carries a log item execution id onto the resource', () => {
    expect(
      resourceFromItem('log', {
        id: 'log-row-1',
        name: 'Nightly sync · Aug 21 11:03:46',
        executionId: 'exec-9',
      })
    ).toEqual({
      type: 'log',
      id: 'log-row-1',
      title: 'Nightly sync · Aug 21 11:03:46',
      executionId: 'exec-9',
    })
  })

  it('builds the plain resource for a family that carries no extra identifier', () => {
    expect(resourceFromItem('workflow', { id: 'wf-1', name: 'Nightly sync' })).toEqual({
      type: 'workflow',
      id: 'wf-1',
      title: 'Nightly sync',
    })
  })
})
