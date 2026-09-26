import {
  apiClientRequestMock,
  apiClientRequestMockFns,
} from '@sim/testing/mocks/api-client-request.mock'
import { describe, expect, it, vi } from 'vitest'

/**
 * Import parsing migrates sub-block ids against each block's declared config,
 * which the global registry stub empties. Only the blocks the fixtures name are
 * registered.
 */
vi.unmock('@/blocks/registry')
vi.mock('@/blocks/registry-maps', async () => {
  const { partialBlockRegistry } = await import('@sim/testing/mocks/block-registry.mock')
  return partialBlockRegistry(
    await import('@/blocks/blocks/knowledge'),
    await import('@/blocks/blocks/agent'),
    await import('@/blocks/blocks/start_trigger')
  )
})

vi.mock('@/lib/api/client/request', () => apiClientRequestMock)

import { requestJson } from '@/lib/api/client/request'
import type { WorkflowStateContractInput } from '@/lib/api/contracts/workflows'
import {
  parseWorkflowJson,
  persistImportedWorkflow,
  sanitizePathSegment,
} from '@/lib/workflows/operations/import-export'

apiClientRequestMockFns.mockRequestJson.mockResolvedValue({})

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

it('preserves variable permissions and the dormant selector through import', async () => {
  const state = createLegacyState()
  const tool = { type: 'function', usageControl: 'none', usageControlExpression: '<start.mode>' }
  const tools = { id: 'tools', type: 'tool-input', value: [tool] }
  const canonicalModes = { '0:agentToolUsageControl': 'advanced' }
  const content = JSON.stringify({
    state: {
      ...state,
      blocks: {
        ...state.blocks,
        agent: {
          ...state.blocks['start-1'],
          id: 'agent',
          name: 'Agent',
          type: 'agent',
          subBlocks: { tools },
          data: { canonicalModes },
        },
      },
    },
  })
  const createWorkflow = vi.fn().mockResolvedValue({ id: 'imported-workflow' })
  await expect(
    persistImportedWorkflow({
      content,
      filename: 'workflow.json',
      workspaceId: 'ws-1',
      createWorkflow,
    })
  ).resolves.toMatchObject({ workflowId: 'imported-workflow' })
  const written = vi.mocked(requestJson).mock.calls.at(-1)?.[1].body as WorkflowStateContractInput
  expect(Object.values(written.blocks)).toContainEqual(
    expect.objectContaining({
      type: 'agent',
      subBlocks: expect.objectContaining({ tools }),
      data: expect.objectContaining({ canonicalModes: expect.objectContaining(canonicalModes) }),
    })
  )
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

  it('falls back to meaningful metadata when the override is a placeholder', async () => {
    expect(await importWithContent(buildContent('Metadata description'), 'New workflow')).toBe(
      'Metadata description'
    )
  })
})

describe('sanitizePathSegment', () => {
  it('should preserve Korean characters (BUG REPRODUCTION)', () => {
    expect(sanitizePathSegment('한글')).toBe('한글')
  })
})
