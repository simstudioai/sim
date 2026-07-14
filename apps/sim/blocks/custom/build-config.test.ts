/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { WorkflowInputField } from '@/lib/workflows/input-format'
import {
  buildCustomBlockConfig,
  CUSTOM_BLOCK_TILE_COLOR,
  type CustomBlockRow,
  isCustomBlockType,
  isReservedOutputName,
} from '@/blocks/custom/build-config'
import type { BlockIcon } from '@/blocks/types'

const icon: BlockIcon = () => null as never

const row: CustomBlockRow = {
  type: 'custom_block_abc123',
  name: 'Invoice Parser',
  description: 'Extracts fields from an invoice',
  workflowId: 'wf-1',
}

function findSub(config: ReturnType<typeof buildCustomBlockConfig>, id: string) {
  return config.subBlocks.find((s) => s.id === id)
}

describe('isCustomBlockType', () => {
  it('matches only the custom_block_ prefix', () => {
    expect(isCustomBlockType('custom_block_abc')).toBe(true)
    expect(isCustomBlockType('agent')).toBe(false)
    expect(isCustomBlockType(undefined)).toBe(false)
    expect(isCustomBlockType(null)).toBe(false)
  })
})

describe('isReservedOutputName', () => {
  it('rejects the system output fields case-insensitively', () => {
    expect(isReservedOutputName('cost')).toBe(true)
    expect(isReservedOutputName('Cost')).toBe(true)
    expect(isReservedOutputName(' success ')).toBe(true)
    expect(isReservedOutputName('error')).toBe(true)
    expect(isReservedOutputName('result')).toBe(true)
    expect(isReservedOutputName('cost_2')).toBe(false)
    expect(isReservedOutputName('summary')).toBe(false)
  })
})

describe('buildCustomBlockConfig', () => {
  const fields: WorkflowInputField[] = [
    { name: 'title', type: 'string' },
    { name: 'count', type: 'number' },
    { name: 'flag', type: 'boolean' },
    { name: 'payload', type: 'object' },
    { name: 'items', type: 'array' },
    { name: 'docs', type: 'file[]' },
  ]

  it('carries the row identity and always wires the workflow_executor tool', () => {
    const config = buildCustomBlockConfig(row, fields, { icon })
    expect(config.type).toBe('custom_block_abc123')
    expect(config.name).toBe('Invoice Parser')
    expect(config.sourceWorkflowId).toBe('wf-1')
    expect(config.category).toBe('tools')
    expect(config.bgColor).toBe(CUSTOM_BLOCK_TILE_COLOR)
    expect(config.hideFromToolbar).toBeUndefined()
    expect(config.tools.access).toEqual(['workflow_executor'])
    expect(config.tools.config?.tool({})).toBe('workflow_executor')
  })

  it('hides a disabled block from the toolbar while keeping it resolvable', () => {
    expect(buildCustomBlockConfig(row, fields, { icon }).hideFromToolbar).toBeUndefined()
    expect(
      buildCustomBlockConfig(row, fields, { icon, hideFromToolbar: true }).hideFromToolbar
    ).toBe(true)
  })

  it('bakes the bound workflowId as a hidden sub-block', () => {
    const config = buildCustomBlockConfig(row, fields, { icon })
    const wf = findSub(config, 'workflowId')
    expect(wf?.hidden).toBe(true)
    expect(wf?.value?.({})).toBe('wf-1')
  })

  it('maps each input field type to the right sub-block', () => {
    const config = buildCustomBlockConfig(row, fields, { icon })
    expect(findSub(config, 'title')?.type).toBe('short-input')
    expect(findSub(config, 'count')?.type).toBe('short-input')
    expect(findSub(config, 'flag')?.type).toBe('switch')
    expect(findSub(config, 'payload')?.type).toBe('code')
    expect(findSub(config, 'payload')?.language).toBe('json')
    expect(findSub(config, 'items')?.type).toBe('code')
    expect(findSub(config, 'docs')?.type).toBe('file-upload')
    expect(findSub(config, 'docs')?.multiple).toBe(true)
  })

  it('exposes the full result and hides plumbing when no outputs are curated', () => {
    const config = buildCustomBlockConfig(row, fields, { icon })
    expect(Object.keys(config.outputs).sort()).toEqual(['error', 'result', 'success'])
    expect(config.outputs.childWorkflowId).toBeUndefined()
    expect(config.outputs.childTraceSpans).toBeUndefined()
  })

  it('exposes only curated outputs as named fields', () => {
    const config = buildCustomBlockConfig(
      { ...row, exposedOutputs: [{ blockId: 'b1', path: 'content', name: 'email' }] },
      fields,
      { icon }
    )
    expect(config.outputs.email).toEqual({ type: 'json', description: 'Output: content' })
    expect(config.outputs.result).toBeUndefined()
    expect(config.outputs.success).toBeDefined()
    expect(config.outputs.childWorkflowId).toBeUndefined()
  })

  it('anchors the sub-block on the stable field id, showing the name as title', () => {
    const config = buildCustomBlockConfig(row, [{ id: 'fld-1', name: 'title', type: 'string' }], {
      icon,
    })
    const sub = findSub(config, 'fld-1')
    expect(sub).toBeDefined()
    expect(sub?.title).toBe('title')
    expect(findSub(config, 'title')).toBeUndefined()
  })

  it('falls back to the field name as id when a field has no stable id', () => {
    const config = buildCustomBlockConfig(row, [{ name: 'legacy', type: 'string' }], { icon })
    expect(findSub(config, 'legacy')?.title).toBe('legacy')
  })

  it('assembles inputMapping from non-reserved, non-empty params', () => {
    const config = buildCustomBlockConfig(row, fields, { icon })
    const mappingFn = findSub(config, 'inputMapping')?.value
    const json = mappingFn?.({
      workflowId: 'wf-1',
      inputMapping: 'ignored',
      triggerMode: true,
      title: 'Acme',
      count: 3,
      empty: '',
    })
    expect(JSON.parse(json as string)).toEqual({ title: 'Acme', count: 3 })
  })
})
