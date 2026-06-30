/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  coerceObjectArray,
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

  it('remaps the advanced-mode manualWorkflowId override', () => {
    const subBlocks: SubBlockRecord = {
      manualWorkflowId: { id: 'manualWorkflowId', type: 'short-input', value: 'wf-src' },
    }
    const result = remapWorkflowReferencesInSubBlocks(subBlocks, map)
    expect(result.manualWorkflowId.value).toBe('wf-dst')
  })

  it('remaps a comma-separated manualWorkflowIds list', () => {
    const subBlocks: SubBlockRecord = {
      manualWorkflowIds: { id: 'manualWorkflowIds', type: 'short-input', value: 'wf-src, sub-src' },
    }
    const result = remapWorkflowReferencesInSubBlocks(subBlocks, map)
    expect(result.manualWorkflowIds.value).toBe('wf-dst,sub-dst')
  })

  it('drops unmapped ids from a manualWorkflowIds list when clearUnmapped is set', () => {
    const subBlocks: SubBlockRecord = {
      manualWorkflowIds: {
        id: 'manualWorkflowIds',
        type: 'short-input',
        value: 'wf-src,wf-unknown',
      },
    }
    const result = remapWorkflowReferencesInSubBlocks(subBlocks, map, { clearUnmapped: true })
    expect(result.manualWorkflowIds.value).toBe('wf-dst')
  })

  it('remaps a multi-select workflowSelector array', () => {
    const subBlocks: SubBlockRecord = {
      workflowSelector: { id: 'workflowSelector', type: 'dropdown', value: ['wf-src', 'sub-src'] },
    }
    const result = remapWorkflowReferencesInSubBlocks(subBlocks, map)
    expect(result.workflowSelector.value).toEqual(['wf-dst', 'sub-dst'])
  })

  // create-fork scopes its workflow id map to the workflows ACTUALLY copied (deployed state
  // loaded). With BOTH the parent (`wf-src`) and child (`sub-src`) workflows copied, every
  // reference variety must remap to the child id (NOT clear), even under fork-create's
  // clearUnmapped policy - the explicit "both deployed and copied" guard.
  it('remaps every reference variety when both referenced workflows are copied (clearUnmapped)', () => {
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
    expect(result.manualWorkflowId.value).toBe('sub-dst')
    expect(result.manualWorkflowIds.value).toBe('wf-dst,sub-dst')
    expect(result.workflowSelector.value).toEqual(['wf-dst', 'sub-dst'])
    const tools = result.tools.value as Array<{ type: string; params?: { workflowId?: string } }>
    expect(tools[0].params?.workflowId).toBe('sub-dst')
    expect(tools[1]).toEqual({ type: 'custom-tool', customToolId: 'ct-1' })
  })

  // A deployed source workflow whose state failed to load is excluded from the scoped fork map,
  // so a copied workflow's reference to it clears (never dangles at a never-created child id).
  it('clears references to a deployed-but-uncopied workflow absent from the scoped map', () => {
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
    expect(result.manualWorkflowIds.value).toBe('wf-dst')
    expect(result.tools.value as unknown[]).toHaveLength(0)
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
