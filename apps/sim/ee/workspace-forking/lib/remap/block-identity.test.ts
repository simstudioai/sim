/**
 * @vitest-environment node
 */
import { isValidUuid } from '@sim/utils/id'
import { describe, expect, it } from 'vitest'
import {
  buildForkBlockIdResolver,
  deriveForkBlockId,
  EMPTY_FORK_BLOCK_MAP,
  type ForkBlockMap,
} from '@/ee/workspace-forking/lib/remap/block-identity'

describe('deriveForkBlockId', () => {
  const targetA = 'wf-target-a'
  const targetB = 'wf-target-b'
  const block1 = 'block-1'
  const block2 = 'block-2'

  it('is deterministic for the same (targetWorkflowId, sourceBlockId)', () => {
    expect(deriveForkBlockId(targetA, block1)).toBe(deriveForkBlockId(targetA, block1))
  })

  it('yields different ids for the same source block in different target workflows', () => {
    expect(deriveForkBlockId(targetA, block1)).not.toBe(deriveForkBlockId(targetB, block1))
  })

  it('yields different ids for different source blocks in the same target workflow', () => {
    expect(deriveForkBlockId(targetA, block1)).not.toBe(deriveForkBlockId(targetA, block2))
  })

  it('produces a valid UUID string (v5)', () => {
    const id = deriveForkBlockId(targetA, block1)
    expect(isValidUuid(id)).toBe(true)
    expect(id[14]).toBe('5')
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

  it('derives everything when the map is empty (fork creation)', () => {
    const resolve = buildForkBlockIdResolver(true, EMPTY_FORK_BLOCK_MAP)
    expect(resolve(childWf, parentBlock)).toBe(deriveForkBlockId(childWf, parentBlock))
  })
})
