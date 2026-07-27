/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { remapConditionEdgeHandle } from '@/lib/workflows/condition-ids'
import {
  coerceObjectArray,
  remapConditionIdsInSubBlocks,
  remapWorkflowReferencesInSubBlocks,
  type SubBlockRecord,
} from '@/lib/workflows/persistence/remap-internal-ids'

describe('remapWorkflowReferencesInSubBlocks', () => {
  const map = new Map([
    ['wf-src', 'wf-dst'],
    ['sub-src', 'sub-dst'],
  ])

  it('remaps a top-level workflow-selector value', () => {
    const subBlocks: SubBlockRecord = {
      target: { id: 'target', type: 'workflow-selector', value: 'wf-src' },
    }
    const result = remapWorkflowReferencesInSubBlocks(subBlocks, map)
    expect(result.target.value).toBe('wf-dst')
  })

  it('remaps a nested workflow_input tool workflowId in a tool-input array', () => {
    const subBlocks: SubBlockRecord = {
      tools: {
        id: 'tools',
        type: 'tool-input',
        value: [
          { type: 'workflow_input', params: { workflowId: 'sub-src', inputMapping: '{}' } },
          { type: 'custom-tool', customToolId: 'ct-1' },
        ],
      },
    }
    const result = remapWorkflowReferencesInSubBlocks(subBlocks, map)
    const tools = result.tools.value as Array<{ type: string; params?: { workflowId?: string } }>
    expect(tools[0].params?.workflowId).toBe('sub-dst')
    expect(tools[1]).toEqual({ type: 'custom-tool', customToolId: 'ct-1' })
  })

  it('handles a JSON-stringified tool-input value', () => {
    const subBlocks: SubBlockRecord = {
      tools: {
        id: 'tools',
        type: 'tool-input',
        value: JSON.stringify([{ type: 'workflow_input', params: { workflowId: 'sub-src' } }]),
      },
    }
    const result = remapWorkflowReferencesInSubBlocks(subBlocks, map)
    expect(result.tools.value).toBe(
      JSON.stringify([{ type: 'workflow_input', params: { workflowId: 'sub-dst' } }])
    )
  })

  it('leaves unknown workflow ids and non-workflow tools untouched', () => {
    const subBlocks: SubBlockRecord = {
      sel: { id: 'sel', type: 'workflow-selector', value: 'wf-unknown' },
      tools: {
        id: 'tools',
        type: 'tool-input',
        value: [{ type: 'workflow_input', params: { workflowId: 'wf-unknown' } }],
      },
    }
    const result = remapWorkflowReferencesInSubBlocks(subBlocks, map)
    expect(result.sel.value).toBe('wf-unknown')
    expect(result.tools).toBe(subBlocks.tools)
  })

  it('returns the input unchanged when the id map is empty', () => {
    const subBlocks: SubBlockRecord = {
      target: { id: 'target', type: 'workflow-selector', value: 'wf-src' },
    }
    expect(remapWorkflowReferencesInSubBlocks(subBlocks, new Map())).toBe(subBlocks)
  })

  it('clears an unmapped workflow-selector when clearUnmapped is set (cross-workspace)', () => {
    const subBlocks: SubBlockRecord = {
      sel: { id: 'sel', type: 'workflow-selector', value: 'wf-unknown' },
    }
    const result = remapWorkflowReferencesInSubBlocks(subBlocks, map, { clearUnmapped: true })
    expect(result.sel.value).toBe('')
  })

  it('drops an unmapped workflow_input tool when clearUnmapped is set', () => {
    const subBlocks: SubBlockRecord = {
      tools: {
        id: 'tools',
        type: 'tool-input',
        value: [
          { type: 'workflow_input', params: { workflowId: 'wf-unknown' } },
          { type: 'workflow_input', params: { workflowId: 'sub-src' } },
        ],
      },
    }
    const result = remapWorkflowReferencesInSubBlocks(subBlocks, map, { clearUnmapped: true })
    const tools = result.tools.value as Array<{ params?: { workflowId?: string } }>
    expect(tools).toHaveLength(1)
    expect(tools[0].params?.workflowId).toBe('sub-dst')
  })

  it('clears the sibling inputMapping when an unmapped workflow selector is cleared (U10)', () => {
    const subBlocks: SubBlockRecord = {
      workflowId: { id: 'workflowId', type: 'workflow-selector', value: 'wf-unknown' },
      inputMapping: { id: 'inputMapping', type: 'input-mapping', value: '{"a":"b"}' },
    }
    const result = remapWorkflowReferencesInSubBlocks(subBlocks, map, { clearUnmapped: true })
    expect(result.workflowId.value).toBe('')
    expect(result.inputMapping.value).toBe('')
  })

  it('keeps inputMapping when the workflow selector is remapped (not cleared)', () => {
    const subBlocks: SubBlockRecord = {
      workflowId: { id: 'workflowId', type: 'workflow-selector', value: 'wf-src' },
      inputMapping: { id: 'inputMapping', type: 'input-mapping', value: '{"a":"b"}' },
    }
    const result = remapWorkflowReferencesInSubBlocks(subBlocks, map, { clearUnmapped: true })
    expect(result.workflowId.value).toBe('wf-dst')
    expect(result.inputMapping.value).toBe('{"a":"b"}')
  })

  // The `inputMapping` belongs to the ACTIVE canonical mode's workflow only. resolveCanonicalMode
  // picks the active mode (block.data.canonicalModes override, else the value heuristic); the wipe
  // fires iff the ACTIVE mode's workflow was removed by the remap. Only the SELECTOR is ever
  // remapped/cleared - the manual member passes through verbatim - so an active-advanced (manual)
  // mode never wipes inputMapping. clearUnmapped: true throughout.
  it('keeps inputMapping: active basic valid + dormant advanced manual preserved (no override)', () => {
    const subBlocks: SubBlockRecord = {
      workflowId: { id: 'workflowId', type: 'workflow-selector', value: 'wf-src' },
      manualWorkflowId: { id: 'manualWorkflowId', type: 'short-input', value: 'wf-unknown' },
      inputMapping: { id: 'inputMapping', type: 'input-mapping', value: '{"a":"b"}' },
    }
    const result = remapWorkflowReferencesInSubBlocks(subBlocks, map, { clearUnmapped: true })
    expect(result.workflowId.value).toBe('wf-dst')
    // Manual member is user-owned: preserved verbatim (never cleared), even while dormant.
    expect(result.manualWorkflowId.value).toBe('wf-unknown')
    expect(result.inputMapping.value).toBe('{"a":"b"}')
  })

  it('keeps inputMapping: active advanced manual preserved (canonicalModes override) + dormant basic remapped', () => {
    const subBlocks: SubBlockRecord = {
      workflowId: { id: 'workflowId', type: 'workflow-selector', value: 'wf-src' },
      manualWorkflowId: { id: 'manualWorkflowId', type: 'short-input', value: 'wf-unknown' },
      inputMapping: { id: 'inputMapping', type: 'input-mapping', value: '{"a":"b"}' },
    }
    const result = remapWorkflowReferencesInSubBlocks(subBlocks, map, {
      clearUnmapped: true,
      canonicalModes: { workflowId: 'advanced' },
    })
    // Active advanced manual is preserved, so its inputMapping survives; the dormant basic selector
    // still remaps.
    expect(result.workflowId.value).toBe('wf-dst')
    expect(result.manualWorkflowId.value).toBe('wf-unknown')
    expect(result.inputMapping.value).toBe('{"a":"b"}')
  })

  it('wipes inputMapping: active basic selector cleared (heuristic) + dormant advanced manual preserved', () => {
    const subBlocks: SubBlockRecord = {
      workflowId: { id: 'workflowId', type: 'workflow-selector', value: 'wf-unknown' },
      manualWorkflowId: { id: 'manualWorkflowId', type: 'short-input', value: 'wf-src' },
      inputMapping: { id: 'inputMapping', type: 'input-mapping', value: '{"a":"b"}' },
    }
    const result = remapWorkflowReferencesInSubBlocks(subBlocks, map, { clearUnmapped: true })
    expect(result.workflowId.value).toBe('')
    // Manual preserved verbatim (not remapped to wf-dst); the active basic selector clearing is what
    // wipes inputMapping.
    expect(result.manualWorkflowId.value).toBe('wf-src')
    expect(result.inputMapping.value).toBe('')
  })

  it('keeps inputMapping: active advanced manual preserved + basic empty (heuristic)', () => {
    const subBlocks: SubBlockRecord = {
      workflowId: { id: 'workflowId', type: 'workflow-selector', value: '' },
      manualWorkflowId: { id: 'manualWorkflowId', type: 'short-input', value: 'wf-unknown' },
      inputMapping: { id: 'inputMapping', type: 'input-mapping', value: '{"a":"b"}' },
    }
    const result = remapWorkflowReferencesInSubBlocks(subBlocks, map, { clearUnmapped: true })
    expect(result.manualWorkflowId.value).toBe('wf-unknown')
    expect(result.inputMapping.value).toBe('{"a":"b"}')
  })

  it('keeps inputMapping: both modes valid (selector remapped, manual preserved)', () => {
    const subBlocks: SubBlockRecord = {
      workflowId: { id: 'workflowId', type: 'workflow-selector', value: 'wf-src' },
      manualWorkflowId: { id: 'manualWorkflowId', type: 'short-input', value: 'sub-src' },
      inputMapping: { id: 'inputMapping', type: 'input-mapping', value: '{"a":"b"}' },
    }
    const result = remapWorkflowReferencesInSubBlocks(subBlocks, map, { clearUnmapped: true })
    expect(result.workflowId.value).toBe('wf-dst')
    expect(result.manualWorkflowId.value).toBe('sub-src')
    expect(result.inputMapping.value).toBe('{"a":"b"}')
  })

  it('does not remap the advanced manualWorkflowId (manual is user-owned)', () => {
    const subBlocks: SubBlockRecord = {
      manualWorkflowId: { id: 'manualWorkflowId', type: 'short-input', value: 'wf-src' },
    }
    const result = remapWorkflowReferencesInSubBlocks(subBlocks, map)
    expect(result.manualWorkflowId.value).toBe('wf-src')
  })

  it('does not remap the manual comma-separated manualWorkflowIds list (manual is user-owned)', () => {
    const subBlocks: SubBlockRecord = {
      manualWorkflowIds: { id: 'manualWorkflowIds', type: 'short-input', value: 'wf-src, sub-src' },
    }
    const result = remapWorkflowReferencesInSubBlocks(subBlocks, map)
    expect(result.manualWorkflowIds.value).toBe('wf-src, sub-src')
  })

  it('preserves the manual manualWorkflowIds list verbatim even under clearUnmapped', () => {
    const subBlocks: SubBlockRecord = {
      manualWorkflowIds: {
        id: 'manualWorkflowIds',
        type: 'short-input',
        value: 'wf-src,wf-unknown',
      },
    }
    const result = remapWorkflowReferencesInSubBlocks(subBlocks, map, { clearUnmapped: true })
    expect(result.manualWorkflowIds.value).toBe('wf-src,wf-unknown')
  })

  // The advanced manual field is user-owned: ANY free-form value - env ref, literal id, tag, or
  // arbitrary text - is preserved verbatim under clearUnmapped (active advanced), and its sibling
  // inputMapping is never wiped. One passthrough covers every free-form edge case at once.
  it.each([
    ['env ref', '{{MY_WORKFLOW_ID}}'],
    ['literal source-workspace id', 'wf-unknown'],
    ['block-output tag', '<start.workflowId>'],
    ['arbitrary text', 'not an id at all'],
  ])('preserves a manual %s value and its inputMapping (active advanced)', (_label, value) => {
    const subBlocks: SubBlockRecord = {
      workflowId: { id: 'workflowId', type: 'workflow-selector', value: '' },
      manualWorkflowId: { id: 'manualWorkflowId', type: 'short-input', value },
      inputMapping: { id: 'inputMapping', type: 'input-mapping', value: '{"a":"b"}' },
    }
    const result = remapWorkflowReferencesInSubBlocks(subBlocks, map, { clearUnmapped: true })
    expect(result.manualWorkflowId.value).toBe(value)
    expect(result.inputMapping.value).toBe('{"a":"b"}')
  })

  // The one behavioral change vs. selector handling: a literal source-workspace id typed into the
  // MANUAL field that WOULD map to a copied target is left AS-IS (not remapped), because manual is
  // user-owned - while the SELECTOR with the same id still remaps to the copied target.
  it('leaves a mapped literal id in the manual field as-is while the selector remaps it', () => {
    const manualSubBlocks: SubBlockRecord = {
      manualWorkflowId: { id: 'manualWorkflowId', type: 'short-input', value: 'wf-src' },
    }
    expect(
      remapWorkflowReferencesInSubBlocks(manualSubBlocks, map, { clearUnmapped: true })
        .manualWorkflowId.value
    ).toBe('wf-src')

    const selectorSubBlocks: SubBlockRecord = {
      workflowId: { id: 'workflowId', type: 'workflow-selector', value: 'wf-src' },
    }
    expect(
      remapWorkflowReferencesInSubBlocks(selectorSubBlocks, map, { clearUnmapped: true }).workflowId
        .value
    ).toBe('wf-dst')
  })

  it('remaps a multi-select workflowSelector array', () => {
    const subBlocks: SubBlockRecord = {
      workflowSelector: { id: 'workflowSelector', type: 'dropdown', value: ['wf-src', 'sub-src'] },
    }
    const result = remapWorkflowReferencesInSubBlocks(subBlocks, map)
    expect(result.workflowSelector.value).toEqual(['wf-dst', 'sub-dst'])
  })

  it('clears unmapped ids from the structured workflowSelector list under clearUnmapped', () => {
    const subBlocks: SubBlockRecord = {
      workflowSelector: {
        id: 'workflowSelector',
        type: 'dropdown',
        value: ['wf-src', 'wf-unknown'],
      },
    }
    const result = remapWorkflowReferencesInSubBlocks(subBlocks, map, { clearUnmapped: true })
    expect(result.workflowSelector.value).toEqual(['wf-dst'])
  })

  // The sim workspace-event trigger's workflow filter: a multi-select `dropdown` with baseKey
  // `workflowIds` whose options are workspace workflow ids - a structured (selector-sourced)
  // list, remapped exactly like `workflowSelector`.
  it('remaps the workspace-event trigger workflowIds dropdown list', () => {
    const subBlocks: SubBlockRecord = {
      workflowIds: { id: 'workflowIds', type: 'dropdown', value: ['wf-src', 'sub-src'] },
    }
    const result = remapWorkflowReferencesInSubBlocks(subBlocks, map)
    expect(result.workflowIds.value).toEqual(['wf-dst', 'sub-dst'])
  })

  it('drops unmapped ids from the workflowIds dropdown under clearUnmapped', () => {
    const subBlocks: SubBlockRecord = {
      workflowIds: { id: 'workflowIds', type: 'dropdown', value: ['wf-src', 'wf-unknown'] },
    }
    const result = remapWorkflowReferencesInSubBlocks(subBlocks, map, { clearUnmapped: true })
    expect(result.workflowIds.value).toEqual(['wf-dst'])
  })

  // The TYPE gate: the legacy logs block's `workflowIds` is a free-form short-input (manual,
  // user-owned), so it must pass through verbatim even though its baseKey matches.
  it('leaves a short-input workflowIds (legacy logs block, user-owned) untouched under clearUnmapped', () => {
    const subBlocks: SubBlockRecord = {
      workflowIds: { id: 'workflowIds', type: 'short-input', value: 'wf-src,wf-unknown' },
    }
    const result = remapWorkflowReferencesInSubBlocks(subBlocks, map, { clearUnmapped: true })
    expect(result.workflowIds.value).toBe('wf-src,wf-unknown')
  })

  // The baseKey gate: dropdowns whose baseKey is neither `workflowSelector` nor `workflowIds`
  // (event pickers, status filters, ...) hold non-workflow values and are never rewritten.
  it('leaves other dropdowns untouched (only workflow-list baseKeys are remapped)', () => {
    const subBlocks: SubBlockRecord = {
      eventType: { id: 'eventType', type: 'dropdown', value: 'wf-src' },
      level: { id: 'level', type: 'dropdown', value: ['wf-src'] },
    }
    const result = remapWorkflowReferencesInSubBlocks(subBlocks, map, { clearUnmapped: true })
    expect(result.eventType.value).toBe('wf-src')
    expect(result.level.value).toEqual(['wf-src'])
  })

  // create-fork scopes its workflow id map to the workflows ACTUALLY copied (deployed state loaded).
  // With BOTH `wf-src` and `sub-src` copied, the SELECTOR varieties remap to the child ids; the
  // free-form MANUAL varieties (`manualWorkflowId`, `manualWorkflowIds`) are user-owned and pass
  // through verbatim, even under fork-create's clearUnmapped policy.
  it('remaps selector varieties and preserves manual varieties when both workflows are copied (clearUnmapped)', () => {
    const subBlocks: SubBlockRecord = {
      selector: { id: 'selector', type: 'workflow-selector', value: 'wf-src' },
      inputMapping: { id: 'inputMapping', type: 'input-mapping', value: '{"a":"b"}' },
      manualWorkflowId: { id: 'manualWorkflowId', type: 'short-input', value: 'sub-src' },
      manualWorkflowIds: { id: 'manualWorkflowIds', type: 'short-input', value: 'wf-src, sub-src' },
      workflowSelector: { id: 'workflowSelector', type: 'dropdown', value: ['wf-src', 'sub-src'] },
      tools: {
        id: 'tools',
        type: 'tool-input',
        value: [
          { type: 'workflow_input', params: { workflowId: 'sub-src', inputMapping: '{}' } },
          { type: 'custom-tool', customToolId: 'ct-1' },
        ],
      },
    }
    const result = remapWorkflowReferencesInSubBlocks(subBlocks, map, { clearUnmapped: true })
    expect(result.selector.value).toBe('wf-dst')
    expect(result.inputMapping.value).toBe('{"a":"b"}')
    // Manual varieties pass through verbatim (not remapped to the child ids).
    expect(result.manualWorkflowId.value).toBe('sub-src')
    expect(result.manualWorkflowIds.value).toBe('wf-src, sub-src')
    expect(result.workflowSelector.value).toEqual(['wf-dst', 'sub-dst'])
    const tools = result.tools.value as Array<{ type: string; params?: { workflowId?: string } }>
    expect(tools[0].params?.workflowId).toBe('sub-dst')
    expect(tools[1]).toEqual({ type: 'custom-tool', customToolId: 'ct-1' })
  })

  // A deployed source workflow whose state failed to load is excluded from the scoped fork map, so a
  // copied workflow's SELECTOR reference to it clears (never dangles at a never-created child id). The
  // free-form manual list is user-owned and preserved verbatim.
  it('clears selector references to a deployed-but-uncopied workflow (manual list preserved)', () => {
    const subBlocks: SubBlockRecord = {
      selector: { id: 'selector', type: 'workflow-selector', value: 'wf-uncopied' },
      inputMapping: { id: 'inputMapping', type: 'input-mapping', value: '{"a":"b"}' },
      manualWorkflowIds: {
        id: 'manualWorkflowIds',
        type: 'short-input',
        value: 'wf-src,wf-uncopied',
      },
      tools: {
        id: 'tools',
        type: 'tool-input',
        value: [{ type: 'workflow_input', params: { workflowId: 'wf-uncopied' } }],
      },
    }
    const result = remapWorkflowReferencesInSubBlocks(subBlocks, map, { clearUnmapped: true })
    expect(result.selector.value).toBe('')
    expect(result.inputMapping.value).toBe('')
    expect(result.manualWorkflowIds.value).toBe('wf-src,wf-uncopied')
    expect(result.tools.value as unknown[]).toHaveLength(0)
  })
})

describe('remapConditionIdsInSubBlocks', () => {
  const OLD_ID = 'old-block'
  const NEW_ID = 'new-block'
  const conditionsValue = JSON.stringify([
    { id: `${OLD_ID}-if`, title: 'if', value: '<a.b> > 1' },
    { id: `${OLD_ID}-else`, title: 'else', value: '' },
  ])

  it('remaps condition row ids on a condition block', () => {
    const subBlocks: SubBlockRecord = {
      conditions: { id: 'conditions', type: 'condition-input', value: conditionsValue },
    }
    const result = remapConditionIdsInSubBlocks(subBlocks, 'condition', OLD_ID, NEW_ID)
    const rows = JSON.parse(result.conditions.value as string)
    expect(rows.map((row: { id: string }) => row.id)).toEqual([`${NEW_ID}-if`, `${NEW_ID}-else`])
  })

  /**
   * Regression: a fallback writer stamped the conditions subblock `short-input`.
   * The remap must key on block type + subblock key, not the drifted stored type,
   * so the row ids and the edge handle move together (previously the ids stayed
   * stale while the handle remapped, orphaning every edge out of the block).
   */
  it('remaps condition row ids even when the stored subblock type drifted', () => {
    const subBlocks: SubBlockRecord = {
      conditions: { id: 'conditions', type: 'short-input', value: conditionsValue },
    }
    const result = remapConditionIdsInSubBlocks(subBlocks, 'condition', OLD_ID, NEW_ID)
    const rows = JSON.parse(result.conditions.value as string)
    const handle = remapConditionEdgeHandle(`condition-${OLD_ID}-else`, OLD_ID, NEW_ID)
    expect(handle).toBe(`condition-${NEW_ID}-else`)
    expect(rows.map((row: { id: string }) => row.id)).toContain(`${NEW_ID}-else`)
  })

  it('remaps route ids on a router_v2 block', () => {
    const subBlocks: SubBlockRecord = {
      routes: {
        id: 'routes',
        type: 'router-input',
        value: JSON.stringify([{ id: `${OLD_ID}-route1`, title: 'Route 1', value: 'desc' }]),
      },
    }
    const result = remapConditionIdsInSubBlocks(subBlocks, 'router_v2', OLD_ID, NEW_ID)
    const rows = JSON.parse(result.routes.value as string)
    expect(rows[0].id).toBe(`${NEW_ID}-route1`)
  })

  it('leaves rows with a foreign block-id prefix untouched (matches the edge-handle remap)', () => {
    const subBlocks: SubBlockRecord = {
      conditions: {
        id: 'conditions',
        type: 'condition-input',
        value: JSON.stringify([{ id: 'foreign-block-if', title: 'if', value: '' }]),
      },
    }
    const result = remapConditionIdsInSubBlocks(subBlocks, 'condition', OLD_ID, NEW_ID)
    expect(result.conditions).toBe(subBlocks.conditions)
    expect(remapConditionEdgeHandle('condition-foreign-block-if', OLD_ID, NEW_ID)).toBe(
      'condition-foreign-block-if'
    )
  })

  it('does not touch subblocks on non-dynamic-handle block types', () => {
    const subBlocks: SubBlockRecord = {
      conditions: { id: 'conditions', type: 'condition-input', value: conditionsValue },
    }
    const result = remapConditionIdsInSubBlocks(subBlocks, 'function', OLD_ID, NEW_ID)
    expect(result.conditions).toBe(subBlocks.conditions)
  })
})

describe('coerceObjectArray', () => {
  it('returns arrays directly', () => {
    expect(coerceObjectArray([{ a: 1 }])).toEqual({ array: [{ a: 1 }], wasString: false })
  })
  it('parses JSON-string arrays', () => {
    expect(coerceObjectArray('[{"a":1}]')).toEqual({ array: [{ a: 1 }], wasString: true })
  })
  it('returns null for non-array values', () => {
    expect(coerceObjectArray('hi')).toEqual({ array: null, wasString: false })
    expect(coerceObjectArray(42)).toEqual({ array: null, wasString: false })
  })
})
