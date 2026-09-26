import { describe, expect, it } from 'vitest'
import {
  buildForkBlockIdResolver,
  deriveForkBlockId,
  type ForkBlockMap,
} from '@/ee/workspace-forking/lib/remap/block-identity'

describe('deriveForkBlockId', () => {
  const targetA = 'wf-target-a'
  const block1 = 'block-1'

  it('is deterministic for the same (targetWorkflowId, sourceBlockId)', () => {
    expect(deriveForkBlockId(targetA, block1)).toBe(deriveForkBlockId(targetA, block1))
  })

  it('does not collide the colon separator (a:bc vs ab:c)', () => {
    expect(deriveForkBlockId('a', 'bc')).not.toBe(deriveForkBlockId('ab', 'c'))
  })
})

describe('buildForkBlockIdResolver', () => {
  const parentWf = 'wf-parent'
  const childWf = 'wf-child'
  const parentBlock = 'block-parent'
  // The pair the fork created: child block derived from the parent block.
  const childBlock = deriveForkBlockId(childWf, parentBlock)
  const seededMap: ForkBlockMap = {
    parentToChild: new Map([
      [parentBlock, { targetBlockId: childBlock, targetWorkflowId: childWf }],
    ]),
    childToParent: new Map([
      [childBlock, { targetBlockId: parentBlock, targetWorkflowId: parentWf }],
    ]),
  }

  it('push maps a child block back to the parent ORIGINAL id (keeps the webhook URL stable)', () => {
    const pushResolve = buildForkBlockIdResolver(false, seededMap)
    expect(pushResolve(parentWf, childBlock)).toBe(parentBlock)
    // The bug this fixes: without the map, push would re-derive and re-key the parent block.
    expect(pushResolve(parentWf, childBlock)).not.toBe(deriveForkBlockId(parentWf, childBlock))
  })

  it('pull maps a parent block to its existing child id', () => {
    const pullResolve = buildForkBlockIdResolver(true, seededMap)
    expect(pullResolve(childWf, parentBlock)).toBe(childBlock)
  })

  it('derives (does NOT reuse) when the target workflow was re-created (different id)', () => {
    // Parent workflow archived + re-created as wf-parent-2: the pair points at the old
    // workflow, so reusing parentBlock there would collide on the global block PK. Derive.
    const pushResolve = buildForkBlockIdResolver(false, seededMap)
    expect(pushResolve('wf-parent-2', childBlock)).toBe(
      deriveForkBlockId('wf-parent-2', childBlock)
    )
    expect(pushResolve('wf-parent-2', childBlock)).not.toBe(parentBlock)
  })

  it('derives a fresh id for a source block with no recorded pair (added since last sync)', () => {
    const pushResolve = buildForkBlockIdResolver(false, seededMap)
    expect(pushResolve(parentWf, 'block-new')).toBe(deriveForkBlockId(parentWf, 'block-new'))
  })
})
