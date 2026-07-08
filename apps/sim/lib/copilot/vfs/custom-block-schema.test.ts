/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { serializeBlockSchema } from '@/lib/copilot/vfs/serializers'
import { buildCustomBlockConfig } from '@/blocks/custom/build-config'
import type { BlockIcon } from '@/blocks/types'

const icon: BlockIcon = () => null as never

/**
 * The agent must see a custom block as a self-contained block — never as a
 * `workflow_executor` needing a workflowId/inputMapping (the plumbing is baked).
 */
describe('serializeBlockSchema for custom blocks', () => {
  const config = buildCustomBlockConfig(
    {
      type: 'custom_block_abc',
      name: 'Invoice Parser',
      description: 'Parses invoices',
      workflowId: 'wf-1',
      exposedOutputs: [{ blockId: 'b1', path: 'content', name: 'summary' }],
    },
    [
      { name: 'file', type: 'string' },
      { name: 'locale', type: 'string' },
    ],
    { icon }
  )

  it('hides workflow_executor and the baked workflowId/inputMapping', () => {
    const schema = JSON.parse(serializeBlockSchema(config))
    expect(schema.tools).toEqual([])
    expect(schema.inputs ?? {}).not.toHaveProperty('workflowId')
    expect(schema.inputs ?? {}).not.toHaveProperty('inputMapping')
    const subBlockIds = (schema.subBlocks ?? []).map((s: { id: string }) => s.id)
    expect(subBlockIds).not.toContain('workflowId')
    expect(subBlockIds).not.toContain('inputMapping')
  })

  it('exposes the input fields and curated outputs', () => {
    const schema = JSON.parse(serializeBlockSchema(config))
    const subBlockIds = (schema.subBlocks ?? []).map((s: { id: string }) => s.id)
    expect(subBlockIds).toEqual(expect.arrayContaining(['file', 'locale']))
    expect(Object.keys(schema.outputs)).toEqual(expect.arrayContaining(['summary', 'success']))
    expect(schema.outputs).not.toHaveProperty('childWorkflowId')
  })
})
