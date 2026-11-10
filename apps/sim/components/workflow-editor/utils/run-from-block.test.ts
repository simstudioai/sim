import { describe, expect, it } from 'vitest'
import {
  getRunFromBlockDependencyState,
  selectRunFromBlockDependenciesSatisfied,
} from '@/components/workflow-editor/utils/run-from-block'

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

/**
 * The store selector every canvas block runs answers what the full rule answers. Failure modes: an
 * entry block refused, a downstream block allowed before its predecessors ran, and a cached index
 * served for edges or a snapshot it was not built from.
 */
describe('selectRunFromBlockDependenciesSatisfied', () => {
  const edges = [
    { source: 'trigger', target: 'producer' },
    { source: 'producer', target: 'consumer' },
    { source: 'trigger', target: 'consumer' },
  ]
  const snapshots = [
    undefined,
    { executedBlocks: [] },
    { executedBlocks: ['trigger'] },
    { executedBlocks: ['trigger', 'producer'] },
  ]

  it('agrees with the full rule for every block and snapshot', () => {
    for (const snapshot of snapshots)
      for (const blockId of ['trigger', 'producer', 'consumer', 'detached'])
        expect(selectRunFromBlockDependenciesSatisfied(blockId, edges, snapshot)).toBe(
          getRunFromBlockDependencyState(blockId, edges, snapshot).dependenciesSatisfied
        )
  })

  it('reads new edges and a new snapshot, never the index built for earlier ones', () => {
    const ran = { executedBlocks: ['trigger'] }
    expect(selectRunFromBlockDependenciesSatisfied('consumer', edges, ran)).toBe(false)
    const rewired = [{ source: 'trigger', target: 'consumer' }]
    expect(selectRunFromBlockDependenciesSatisfied('consumer', rewired, ran)).toBe(true)
    expect(selectRunFromBlockDependenciesSatisfied('producer', edges, ran)).toBe(true)
    expect(
      selectRunFromBlockDependenciesSatisfied('consumer', edges, {
        executedBlocks: ['trigger', 'producer'],
      })
    ).toBe(true)
  })
})
