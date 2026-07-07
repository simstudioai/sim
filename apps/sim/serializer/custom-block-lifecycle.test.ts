/**
 * @vitest-environment node
 *
 * Custom-block lifecycle behavior in the serializer:
 *  - a deleted custom block (its type no longer resolves) is dropped like a removed
 *    block, with its edges, instead of throwing `Invalid block type` (Bug 2);
 *  - a deleted *input* on a live custom block no longer leaks its stale value into
 *    the child `inputMapping` (Bug 1).
 */
import { toolsUtilsMock } from '@sim/testing/mocks'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Build the custom-block configs INSIDE the factory (hoisted) so no top-level
// variable is referenced before initialization. `custom_block_live` declares one
// input (`title`); `custom_block_legacy` declares none (schema-agnostic);
// `custom_block_deleted` is absent, so getBlock returns null for it.
vi.mock('@/blocks', async () => {
  const { buildCustomBlockConfig } = await import('@/blocks/custom/build-config')
  const { createMockGetBlock, mockBlockConfigs } = await import('@sim/testing/mocks')
  const icon = () => null
  const getBlock = createMockGetBlock({
    custom_block_live: buildCustomBlockConfig(
      { type: 'custom_block_live', name: 'Live', description: '', workflowId: 'wf-1' },
      [{ id: 'title', name: 'title', type: 'string' }],
      { icon: icon as never }
    ),
    custom_block_legacy: buildCustomBlockConfig(
      { type: 'custom_block_legacy', name: 'Legacy', description: '', workflowId: 'wf-2' },
      [],
      { icon: icon as never }
    ),
  })
  return { getBlock, getAllBlocks: () => Object.values(mockBlockConfigs) }
})
vi.mock('@/tools/utils', () => toolsUtilsMock)

import { extractBlockParams, Serializer } from '@/serializer/index'

function customBlockState(type: string, fieldValues: Record<string, unknown>) {
  return {
    id: 'cb1',
    type,
    name: 'CB',
    position: { x: 0, y: 0 },
    enabled: true,
    subBlocks: {
      workflowId: { id: 'workflowId', type: 'short-input', value: null },
      inputMapping: { id: 'inputMapping', type: 'code', value: null },
      ...Object.fromEntries(
        Object.entries(fieldValues).map(([id, value]) => [id, { id, type: 'short-input', value }])
      ),
    },
    outputs: {},
    data: {},
  } as any
}

describe('custom-block serializer lifecycle', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('Bug 1: deleted input does not leak into inputMapping', () => {
    it('drops a stored value whose input was removed from a config that declares its inputs', () => {
      const params = extractBlockParams(
        customBlockState('custom_block_live', { title: 'Acme', firstName: 'Theodore' })
      )
      const mapping = JSON.parse(params.inputMapping)
      expect(mapping).toEqual({ title: 'Acme' })
      expect(mapping.firstName).toBeUndefined()
    })

    it('still carries every stored value for a schema-agnostic (legacy) custom block', () => {
      const params = extractBlockParams(
        customBlockState('custom_block_legacy', { title: 'Acme', firstName: 'Theodore' })
      )
      expect(JSON.parse(params.inputMapping)).toEqual({ title: 'Acme', firstName: 'Theodore' })
    })
  })

  describe('Bug 2: a deleted custom block is dropped, not fatal', () => {
    it('drops an unresolvable custom block and its edges on serialize', () => {
      const blocks = {
        starter: {
          id: 'starter',
          type: 'starter',
          name: 'Start',
          position: { x: 0, y: 0 },
          enabled: true,
          subBlocks: {},
          outputs: {},
          data: {},
        },
        cb1: customBlockState('custom_block_deleted', { title: 'x' }),
      } as any
      const edges = [
        { id: 'e1', source: 'starter', target: 'cb1', sourceHandle: null, targetHandle: null },
      ] as any

      const serialized = new Serializer().serializeWorkflow(blocks, edges, {}, {})

      expect(serialized.blocks.map((b) => b.id)).toEqual(['starter'])
      expect(serialized.connections).toHaveLength(0)
    })

    it('drops an unresolvable custom block and its edges on deserialize', () => {
      const wire = {
        version: '1.0',
        blocks: [
          {
            id: 'starter',
            position: { x: 0, y: 0 },
            config: { tool: 'starter', params: {} },
            inputs: {},
            outputs: {},
            enabled: true,
            metadata: { id: 'starter', name: 'Start' },
          },
          {
            id: 'cb1',
            position: { x: 0, y: 0 },
            config: { tool: 'workflow_executor', params: {} },
            inputs: {},
            outputs: {},
            enabled: true,
            metadata: { id: 'custom_block_deleted', name: 'CB' },
          },
        ],
        connections: [{ source: 'starter', target: 'cb1' }],
        loops: {},
        parallels: {},
      } as any

      const { blocks, edges } = new Serializer().deserializeWorkflow(wire)

      expect(Object.keys(blocks)).toEqual(['starter'])
      expect(edges).toHaveLength(0)
    })
  })
})
