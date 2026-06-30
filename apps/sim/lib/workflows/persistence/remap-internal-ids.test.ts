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
