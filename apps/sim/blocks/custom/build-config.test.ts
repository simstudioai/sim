/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { WorkflowInputField } from '@/lib/workflows/input-format'
import {
  assembleCustomBlockInputMapping,
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
    expect(isReservedOutputName('result')).toBe(false)
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

  it('advertises no data fields — and no whole-result fallback — without curation', () => {
    const config = buildCustomBlockConfig(row, fields, { icon })
    // Curation is required at publish, so an uncurated row exposes only the
    // system fields. `result` must not come back: it would advertise the child's
    // raw terminal state (agent toolCalls/thinking, nested workflow ids).
    expect(Object.keys(config.outputs).sort()).toEqual([
      'error',
      'errorRef',
      'errorType',
      'success',
    ])
    expect(config.outputs.result).toBeUndefined()
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

describe('sourceWorkspaceName', () => {
  const icon = () => null as never

  it('carries the source workspace so same-named environment copies stay distinguishable', () => {
    // prod/uat/sandbox copies of one block share a name and differ only by an opaque
    // `custom_block_<slug>` type. Without the workspace, an allowlist decision in Access
    // Control — or any other list of blocks — is a coin flip between three identical rows.
    const prod = buildCustomBlockConfig({ ...row, workspaceName: 'Impl (prod)' }, [], { icon })
    const uat = buildCustomBlockConfig(
      { ...row, type: 'custom_block_uat999', workspaceName: 'Impl (uat)' },
      [],
      { icon }
    )

    expect(prod.name).toBe(uat.name)
    expect(prod.sourceWorkspaceName).toBe('Impl (prod)')
    expect(uat.sourceWorkspaceName).toBe('Impl (uat)')
  })

  it('is omitted when the workspace is unknown, so no empty suffix renders', () => {
    expect(buildCustomBlockConfig(row, [], { icon }).sourceWorkspaceName).toBeUndefined()
    expect(
      buildCustomBlockConfig({ ...row, workspaceName: null }, [], { icon }).sourceWorkspaceName
    ).toBeUndefined()
  })
})

describe('assembleCustomBlockInputMapping', () => {
  const fieldSubBlocks = [
    { id: 'flag', name: 'flag', type: 'boolean' },
    { id: 'payload', name: 'payload', type: 'object' },
    { id: 'name', name: 'name', type: 'string' },
  ]

  it("decodes a tool row's stringified boolean before handing it to the child", () => {
    expect(JSON.parse(assembleCustomBlockInputMapping({ flag: 'false' }, fieldSubBlocks))).toEqual({
      flag: false,
    })
    expect(JSON.parse(assembleCustomBlockInputMapping({ flag: 'true' }, fieldSubBlocks))).toEqual({
      flag: true,
    })
  })

  it('leaves a text field alone even when it holds a boolean-looking string', () => {
    expect(JSON.parse(assembleCustomBlockInputMapping({ name: 'false' }, fieldSubBlocks))).toEqual({
      name: 'false',
    })
  })

  it('still drops reserved keys and untouched fields', () => {
    expect(
      JSON.parse(
        assembleCustomBlockInputMapping(
          { flag: '', name: '', workflowId: 'wf_1', inputMapping: '{}' },
          fieldSubBlocks
        )
      )
    ).toEqual({})
  })

  it('keeps a canvas value that is already typed', () => {
    expect(JSON.parse(assembleCustomBlockInputMapping({ flag: false }, fieldSubBlocks))).toEqual({
      flag: false,
    })
  })
})

describe('assembleCustomBlockInputMapping field decoding', () => {
  const inputFields = [
    { id: 'flag', name: 'flag', type: 'boolean' },
    { id: 'count', name: 'count', type: 'number' },
    { id: 'body', name: 'body', type: 'object' },
    { id: 'note', name: 'note', type: 'string' },
  ]

  it('decodes on the DECLARED field type, not the control it renders as', () => {
    // `number` collects in a text field and `object` in a code editor — both store
    // strings, so keying on the control would decode neither.
    expect(
      JSON.parse(
        assembleCustomBlockInputMapping(
          { flag: 'false', count: '3', body: '{"a":1}', note: 'false' },
          inputFields
        )
      )
    ).toEqual({ flag: false, count: 3, body: { a: 1 }, note: 'false' })
  })

  it('leaves canvas values, which are already typed, untouched', () => {
    expect(
      JSON.parse(assembleCustomBlockInputMapping({ flag: false, count: 3 }, inputFields))
    ).toEqual({ flag: false, count: 3 })
  })

  it('passes values through when no fields are known', () => {
    expect(JSON.parse(assembleCustomBlockInputMapping({ flag: 'false' }))).toEqual({
      flag: 'false',
    })
  })
})
