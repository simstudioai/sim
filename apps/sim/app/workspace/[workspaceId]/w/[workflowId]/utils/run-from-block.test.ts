import { describe, expect, it } from 'vitest'
import { getRunFromBlockDependencyState } from '@/app/workspace/[workspaceId]/w/[workflowId]/utils/run-from-block'

describe('getRunFromBlockDependencyState', () => {
  it('requires a snapshot before running a downstream block', () => {
    const edges = [{ source: 'trigger', target: 'function' }]

    expect(getRunFromBlockDependencyState('function', edges, undefined)).toEqual({
      isEntryBlock: false,
      dependenciesSatisfied: false,
    })
  })

  it('requires every non-entry predecessor to have cached output', () => {
    const edges = [
      { source: 'trigger', target: 'producer' },
      { source: 'producer', target: 'consumer' },
      { source: 'trigger', target: 'consumer' },
    ]

    expect(
      getRunFromBlockDependencyState('consumer', edges, { executedBlocks: ['trigger'] })
    ).toEqual({
      isEntryBlock: false,
      dependenciesSatisfied: false,
    })
    expect(
      getRunFromBlockDependencyState('consumer', edges, {
        executedBlocks: ['trigger', 'producer'],
      })
    ).toEqual({
      isEntryBlock: false,
      dependenciesSatisfied: true,
    })
  })
})
