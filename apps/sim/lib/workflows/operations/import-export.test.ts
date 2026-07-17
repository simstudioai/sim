import { describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')

vi.mock('@/lib/api/client/request', () => ({
  requestJson: vi.fn().mockResolvedValue({}),
}))

import {
  extractWorkflowName,
  parseWorkflowJson,
  persistImportedWorkflow,
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

describe('persistImportedWorkflow description handling', () => {
  function buildContent(description?: string) {
    const state = createLegacyState()
    return JSON.stringify({
      data: {
        version: '1.0',
        workflow: { name: 'Imported Workflow' },
        state: {
          ...state,
          metadata: { name: 'Imported Workflow', description },
        },
      },
    })
  }

  async function importWithContent(content: string, descriptionOverride?: string) {
    const createWorkflow = vi.fn().mockResolvedValue({ id: 'wf-1' })
    await persistImportedWorkflow({
      content,
      filename: 'imported-workflow.json',
      workspaceId: 'ws-1',
      descriptionOverride,
      createWorkflow,
    })
    return createWorkflow.mock.calls[0][0].description as string
  }

  it('scrubs placeholder metadata descriptions to an empty string', async () => {
    expect(await importWithContent(buildContent('New workflow'))).toBe('')
    expect(
      await importWithContent(buildContent('Your first workflow - start building here!'))
    ).toBe('')
  })

  it('scrubs name-equal metadata descriptions to an empty string', async () => {
    expect(await importWithContent(buildContent('Imported Workflow'))).toBe('')
  })

  it('preserves meaningful metadata descriptions', async () => {
    expect(await importWithContent(buildContent('Syncs leads from HubSpot to Slack'))).toBe(
      'Syncs leads from HubSpot to Slack'
    )
  })

  it('uses an empty string when no description is present', async () => {
    expect(await importWithContent(buildContent(undefined))).toBe('')
  })

  it('prefers a meaningful override over metadata', async () => {
    expect(
      await importWithContent(buildContent('Metadata description'), 'Override description')
    ).toBe('Override description')
  })

  it('falls back to meaningful metadata when the override is a placeholder', async () => {
    expect(await importWithContent(buildContent('Metadata description'), 'New workflow')).toBe(
      'Metadata description'
    )
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
