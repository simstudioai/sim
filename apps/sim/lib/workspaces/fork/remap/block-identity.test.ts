/**
 * @vitest-environment node
 */
import { isValidUuid } from '@sim/utils/id'
import { describe, expect, it } from 'vitest'
import { deriveForkBlockId } from '@/lib/workspaces/fork/remap/block-identity'

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
