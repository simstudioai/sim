/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { toForkBlockPairs } from '@/ee/workspace-forking/lib/mapping/block-map-store'

describe('toForkBlockPairs', () => {
  const mapping = new Map([
    ['src-1', 'tgt-1'],
    ['src-2', 'tgt-2'],
  ])

  it('orients source->target as parent->child on pull/create (source = parent)', () => {
    expect(toForkBlockPairs(mapping, true, 'wf-parent', 'wf-child')).toEqual([
      {
        parentWorkflowId: 'wf-parent',
        childWorkflowId: 'wf-child',
        parentBlockId: 'src-1',
        childBlockId: 'tgt-1',
      },
      {
        parentWorkflowId: 'wf-parent',
        childWorkflowId: 'wf-child',
        parentBlockId: 'src-2',
        childBlockId: 'tgt-2',
      },
    ])
  })

  it('orients source->target as child->parent on push (source = child)', () => {
    expect(toForkBlockPairs(mapping, false, 'wf-child', 'wf-parent')).toEqual([
      {
        parentWorkflowId: 'wf-parent',
        childWorkflowId: 'wf-child',
        parentBlockId: 'tgt-1',
        childBlockId: 'src-1',
      },
      {
        parentWorkflowId: 'wf-parent',
        childWorkflowId: 'wf-child',
        parentBlockId: 'tgt-2',
        childBlockId: 'src-2',
      },
    ])
  })

  it('returns an empty list for an empty mapping', () => {
    expect(toForkBlockPairs(new Map(), true, 'wf-parent', 'wf-child')).toEqual([])
  })
})
