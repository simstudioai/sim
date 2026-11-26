/**
 * Deploy-change detection takes JSON text and the container it encodes as one value only where the
 * runtime reads both alike (a child workflow's `inputMapping`); anywhere else the encoding is a
 * change, because the runtime reads one form only (a Jina `readUrlOptions` held as text sends no
 * options).
 */
import { describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')
vi.mock('@/blocks/registry-maps', async () => {
  const { partialBlockRegistry } = await import('@sim/testing/mocks/block-registry.mock')
  return partialBlockRegistry(
    await import('@/blocks/blocks/jina'),
    await import('@/blocks/blocks/workflow_input')
  )
})

import { hasWorkflowChanged } from '@/lib/workflows/comparison/compare'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

function withValue(type: string, subBlockId: string, subBlockType: string, value: unknown) {
  return {
    blocks: {
      block: {
        id: 'block',
        type,
        name: 'Block',
        position: { x: 0, y: 0 },
        subBlocks: { [subBlockId]: { id: subBlockId, type: subBlockType, value } },
        outputs: {},
        enabled: true,
      },
    },
    edges: [],
    loops: {},
    parallels: {},
  } as unknown as WorkflowState
}

describe('deploy-change detection over JSON text', () => {
  it('takes an input mapping as text and as an object as one value', () => {
    const text = withValue('workflow_input', 'inputMapping', 'input-mapping', '{"id":"<start.id>"}')
    const object = withValue('workflow_input', 'inputMapping', 'input-mapping', {
      id: '<start.id>',
    })
    expect(hasWorkflowChanged(object, text)).toBe(false)
  })

  it('reports a checkbox list moving between text and an object, which runs differently', () => {
    const text = withValue('jina', 'readUrlOptions', 'checkbox-list', '{"gatherLinks":true}')
    const object = withValue('jina', 'readUrlOptions', 'checkbox-list', { gatherLinks: true })
    expect(hasWorkflowChanged(object, text)).toBe(true)
  })
})
