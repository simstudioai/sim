import { describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')

import {
  extractWorkflowName,
  parseWorkflowJson,
  sanitizePathSegment,
} from '@/lib/workflows/operations/import-export'

function createLegacyState() {
  return {
    blocks: {
      'start-1': {
        id: 'start-1',
        type: 'start_trigger',
        name: 'Start',
        position: { x: 0, y: 0 },
        enabled: true,
        subBlocks: {
          inputFormat: {
            id: 'inputFormat',
            type: 'input-format',
            value: [],
          },
          undefined: {
            type: 'unknown',
            value: 'stale duplicate',
          },
        },
        outputs: {},
        data: {},
      },
    },
    edges: [],
    loops: {},
    parallels: {},
    variables: {},
    metadata: {
      name: 'Wrapped Workflow',
      color: '#FFBF00',
    },
  }
}

describe('workflow import/export parsing', () => {
  it('parses workflow exports wrapped in an API data envelope', () => {
    const content = JSON.stringify({
      data: {
        version: '1.0',
        exportedAt: '2026-05-07T06:45:06.892Z',
        workflow: {
          name: 'Wrapped Workflow',
        },
        state: createLegacyState(),
      },
    })

    const result = parseWorkflowJson(content, false)

    expect(result.errors).toEqual([])
    expect(result.data?.blocks['start-1']).toBeDefined()
    expect(result.data?.blocks['start-1'].subBlocks.inputFormat).toEqual({
      id: 'inputFormat',
      type: 'input-format',
      value: [],
    })
    expect(result.data?.blocks['start-1'].subBlocks.undefined).toBeUndefined()
  })

  it('extracts workflow names from wrapped exports', () => {
    const content = JSON.stringify({
      data: {
        workflow: {
          name: 'Wrapped Workflow',
        },
        state: createLegacyState(),
      },
    })

    expect(extractWorkflowName(content, 'wf.json')).toBe('Wrapped Workflow')
  })

  it('parses API envelopes that contain state without an export version', () => {
    const content = JSON.stringify({
      data: {
        workflow: {
          name: 'API Workflow',
        },
        state: createLegacyState(),
      },
    })

    const result = parseWorkflowJson(content, false)

    expect(result.errors).toEqual([])
    expect(result.data?.blocks['start-1']).toBeDefined()
    expect(result.data?.blocks['start-1'].subBlocks.undefined).toBeUndefined()
  })

  it('preserves malformed legacy renamed subBlocks during import parsing', () => {
    const state = {
      ...createLegacyState(),
      blocks: {
        knowledge: {
          id: 'knowledge',
          type: 'knowledge',
          name: 'Knowledge',
          position: { x: 0, y: 0 },
          enabled: true,
          subBlocks: {
            operation: { id: 'operation', type: 'dropdown', value: 'search' },
            knowledgeBaseId: {
              id: 'knowledgeBaseId',
              type: 'unknown',
              value: 'kb-uuid-123',
            },
          },
          outputs: {},
          data: {},
        },
      },
    }
    const content = JSON.stringify({ data: { workflow: { name: 'Knowledge Workflow' }, state } })

    const result = parseWorkflowJson(content, false)

    expect(result.errors).toEqual([])
    expect(result.data?.blocks.knowledge.subBlocks.knowledgeBaseId).toBeUndefined()
    expect(result.data?.blocks.knowledge.subBlocks.knowledgeBaseSelector).toEqual({
      id: 'knowledgeBaseSelector',
      type: 'knowledge-base-selector',
      value: 'kb-uuid-123',
    })
  })
})

describe('sanitizePathSegment', () => {
  it('should preserve ASCII alphanumeric characters', () => {
    expect(sanitizePathSegment('workflow-123_abc')).toBe('workflow-123_abc')
  })

  it('should replace spaces with dashes', () => {
    expect(sanitizePathSegment('my workflow')).toBe('my-workflow')
  })

  it('should replace special characters with dashes', () => {
    expect(sanitizePathSegment('workflow!@#')).toBe('workflow-')
  })

  it('should preserve Korean characters (BUG REPRODUCTION)', () => {
    expect(sanitizePathSegment('한글')).toBe('한글')
  })

  it('should preserve other Unicode characters', () => {
    expect(sanitizePathSegment('日本語')).toBe('日本語')
  })

  it('should remove filesystem unsafe characters', () => {
    expect(sanitizePathSegment('work/flow?name*')).not.toContain('/')
    expect(sanitizePathSegment('work/flow?name*')).not.toContain('?')
    expect(sanitizePathSegment('work/flow?name*')).not.toContain('*')
  })
})
