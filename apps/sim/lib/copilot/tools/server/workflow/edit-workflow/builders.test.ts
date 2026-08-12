/**
 * @vitest-environment node
 */
import { isValidUuid } from '@sim/utils/id'
import { describe, expect, it, vi } from 'vitest'
import {
  applyTriggerConfigToBlockSubblocks,
  createBlockFromParams,
  filterDisallowedTools,
  normalizeBlockIdsInOperations,
  normalizeSubblockValue,
} from '@/lib/copilot/tools/server/workflow/edit-workflow/builders'

const { mockIsIntegrationDeploymentAvailable } = vi.hoisted(() => ({
  mockIsIntegrationDeploymentAvailable: vi.fn(() => true),
}))

vi.mock('@/lib/integrations/availability.server', () => ({
  isIntegrationDeploymentAvailableForVisibility: mockIsIntegrationDeploymentAvailable,
}))

const agentBlockConfig = {
  type: 'agent',
  name: 'Agent',
  outputs: {
    content: { type: 'string', description: 'Default content output' },
  },
  subBlocks: [{ id: 'responseFormat', type: 'response-format' }],
}

const conditionBlockConfig = {
  type: 'condition',
  name: 'Condition',
  outputs: {},
  subBlocks: [{ id: 'conditions', type: 'condition-input' }],
}

const knowledgeBlockConfig = {
  type: 'knowledge',
  name: 'Knowledge',
  outputs: {},
  subBlocks: [
    { id: 'tagFilters', type: 'knowledge-tag-filters' },
    { id: 'documentTags', type: 'document-tag-entry' },
  ],
}

const slackBlockConfig = {
  type: 'slack',
  name: 'Slack',
  outputs: {},
  subBlocks: [{ id: 'channel', type: 'channel-selector' }],
}

const blocksByType: Record<string, unknown> = {
  agent: agentBlockConfig,
  condition: conditionBlockConfig,
  knowledge: knowledgeBlockConfig,
  slack: slackBlockConfig,
}

vi.mock('@/blocks/registry', () => ({
  getAllBlocks: () => [
    agentBlockConfig,
    conditionBlockConfig,
    knowledgeBlockConfig,
    slackBlockConfig,
  ],
  getBlock: (type: string) => blocksByType[type],
}))

describe('createBlockFromParams', () => {
  it('derives agent outputs from responseFormat when outputs are not provided', () => {
    const block = createBlockFromParams('b-agent', {
      type: 'agent',
      name: 'Agent',
      inputs: {
        responseFormat: {
          type: 'object',
          properties: {
            answer: {
              type: 'string',
              description: 'Structured answer text',
            },
          },
          required: ['answer'],
        },
      },
      triggerMode: false,
    })

    expect(block.outputs.answer).toBeDefined()
    expect(block.outputs.answer.type).toBe('string')
  })

  it('preserves configured subblock types and normalizes condition branch ids', () => {
    const block = createBlockFromParams('condition-1', {
      type: 'condition',
      name: 'Condition 1',
      inputs: {
        conditions: JSON.stringify([
          { id: 'arbitrary-if', title: 'if', value: 'true' },
          { id: 'arbitrary-else', title: 'else', value: '' },
        ]),
      },
      triggerMode: false,
    })

    expect(block.subBlocks.conditions.type).toBe('condition-input')

    const parsed = JSON.parse(block.subBlocks.conditions.value)
    expect(parsed[0].id).toBe('condition-1-if')
    expect(parsed[1].id).toBe('condition-1-else')
  })

  it('uses lowercase titles for default condition branches', () => {
    const block = createBlockFromParams('condition-1', {
      type: 'condition',
      name: 'Condition 1',
      triggerMode: false,
    })

    const conditions = JSON.parse(block.subBlocks.conditions.value)
    expect(conditions.map(({ title }: { title: string }) => title)).toEqual(['if', 'else'])
  })

  it('persists knowledge tag subblocks as JSON strings, not raw arrays', () => {
    const block = createBlockFromParams('kb-1', {
      type: 'knowledge',
      name: 'Knowledge 1',
      inputs: {
        tagFilters: [{ tagName: 'Department', tagSlot: 'tag1', tagValue: 'it' }],
        documentTags: [{ tagName: 'Team', tagSlot: 'tag2', value: 'infra' }],
      },
      triggerMode: false,
    })

    expect(typeof block.subBlocks.tagFilters.value).toBe('string')
    expect(typeof block.subBlocks.documentTags.value).toBe('string')

    const filters = JSON.parse(block.subBlocks.tagFilters.value)
    expect(filters[0].tagName).toBe('Department')
    expect(filters[0].id).toEqual(expect.any(String))
  })
})

describe('filterDisallowedTools', () => {
  it('removes unavailable integration tools even without a permission group', () => {
    mockIsIntegrationDeploymentAvailable.mockImplementation((type: string) => type !== 'slack')
    const skippedItems: Parameters<typeof filterDisallowedTools>[3] = []

    const tools = filterDisallowedTools(
      [{ type: 'slack' }, { type: 'custom-tool', customToolId: 'custom-1' }],
      null,
      'agent-1',
      skippedItems
    )

    expect(tools).toEqual([{ type: 'custom-tool', customToolId: 'custom-1' }])
    expect(skippedItems[0]?.reason).toContain('unavailable in this deployment')
  })
})

describe('normalizeSubblockValue', () => {
  it.each(['tagFilters', 'documentTags', 'conditions', 'routes'])(
    'serializes %s to a JSON string the subblock component can parse',
    (key) => {
      const result = normalizeSubblockValue(key, [{ id: 'not-a-uuid', title: 'a' }])

      expect(typeof result).toBe('string')
      expect(JSON.parse(result as string)[0].title).toBe('a')
    }
  )

  it('accepts a JSON string as input and still returns a string', () => {
    const result = normalizeSubblockValue('tagFilters', JSON.stringify([{ tagName: 'Department' }]))

    expect(typeof result).toBe('string')
    expect(JSON.parse(result as string)[0].tagName).toBe('Department')
  })

  it('leaves array-with-id subblocks that are not string-serialized as raw arrays', () => {
    const result = normalizeSubblockValue('inputFormat', [{ id: 'x', name: 'field' }])

    expect(Array.isArray(result)).toBe(true)
  })

  it('passes through subblock keys that need no normalization', () => {
    expect(normalizeSubblockValue('systemPrompt', 'hello')).toBe('hello')
  })

  // Validation treats null as an explicit clear. Coercing it to "[]" would persist a value
  // where the caller asked for none, so the agent reads back an empty filter rather than an
  // absent one -- the same absent-vs-empty ambiguity that caused the original data loss.
  it.each(['tagFilters', 'documentTags', 'conditions', 'routes'])(
    'passes a null %s through as a clear rather than serializing it to "[]"',
    (key) => {
      expect(normalizeSubblockValue(key, null)).toBeNull()
      expect(normalizeSubblockValue(key, undefined)).toBeUndefined()
    }
  )

  it('still serializes an explicitly empty array, which clears the field with a value', () => {
    expect(normalizeSubblockValue('tagFilters', [])).toBe('[]')
  })

  it('replaces non-uuid ids so copilot-authored rows match UI-created ones', () => {
    const result = normalizeSubblockValue('tagFilters', [{ id: 'filter-1', tagName: 'Department' }])

    expect(JSON.parse(result as string)[0].id).not.toBe('filter-1')
  })
})

describe('applyTriggerConfigToBlockSubblocks', () => {
  it('uses the registry type for declared keys and short-input only for undeclared keys', () => {
    const block = { id: 'b1', type: 'slack', subBlocks: {} as Record<string, unknown> }

    applyTriggerConfigToBlockSubblocks(block, { channel: 'C123', customField: 'x' })

    expect(block.subBlocks.channel).toEqual({
      id: 'channel',
      type: 'channel-selector',
      value: 'C123',
    })
    expect(block.subBlocks.customField).toEqual({
      id: 'customField',
      type: 'short-input',
      value: 'x',
    })
  })

  it('keeps the existing entry metadata when the key already exists', () => {
    const block = {
      id: 'b1',
      type: 'slack',
      subBlocks: {
        channel: { id: 'channel', type: 'channel-selector', value: 'C-old' },
      } as Record<string, { id: string; type: string; value: unknown }>,
    }

    applyTriggerConfigToBlockSubblocks(block, { channel: 'C-new' })

    expect(block.subBlocks.channel).toEqual({
      id: 'channel',
      type: 'channel-selector',
      value: 'C-new',
    })
  })
})

describe('normalizeBlockIdsInOperations', () => {
  it('mints UUIDs for nested child ids so a model handle never becomes the global block primary key', () => {
    const { normalizedOperations, idMapping } = normalizeBlockIdsInOperations([
      {
        operation_type: 'add',
        block_id: 'pollLoop',
        params: {
          type: 'loop',
          nestedNodes: {
            waitPoll: { type: 'wait' },
            setStatus: { type: 'variables' },
          },
        },
      },
    ] as any)

    const nestedNodes = (normalizedOperations[0] as any).params.nestedNodes
    const childIds = Object.keys(nestedNodes)

    expect(childIds).toHaveLength(2)
    for (const childId of childIds) {
      expect(isValidUuid(childId)).toBe(true)
    }
    expect(childIds).not.toContain('waitPoll')
    expect(childIds).not.toContain('setStatus')
    expect(idMapping.get('waitPoll')).toBe(childIds[0])
    expect(idMapping.get('setStatus')).toBe(childIds[1])
  })

  it('remaps children of nested containers and the sibling references they carry', () => {
    const { normalizedOperations, idMapping } = normalizeBlockIdsInOperations([
      {
        operation_type: 'add',
        block_id: 'outerLoop',
        params: {
          type: 'loop',
          nestedNodes: {
            innerLoop: {
              type: 'parallel',
              nestedNodes: {
                deepChild: { type: 'agent' },
              },
            },
            sibling: {
              type: 'function',
              connections: { success: 'deepChild' },
            },
          },
        },
      },
    ] as any)

    const outer = (normalizedOperations[0] as any).params.nestedNodes
    const innerId = idMapping.get('innerLoop') as string
    const deepId = idMapping.get('deepChild') as string
    const siblingId = idMapping.get('sibling') as string

    expect(isValidUuid(deepId)).toBe(true)
    expect(Object.keys(outer[innerId].nestedNodes)).toEqual([deepId])
    expect(outer[siblingId].connections.success).toBe(deepId)
  })

  it('leaves ids that are already UUIDs untouched', () => {
    const existing = '11111111-2222-4333-8444-555555555555'
    const { normalizedOperations, idMapping } = normalizeBlockIdsInOperations([
      {
        operation_type: 'add',
        block_id: existing,
        params: { type: 'loop', nestedNodes: {} },
      },
    ] as any)

    expect(idMapping.size).toBe(0)
    expect((normalizedOperations[0] as any).block_id).toBe(existing)
  })
})
