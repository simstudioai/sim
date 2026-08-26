/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import {
  applyBlockRetry,
  applyTriggerConfigToBlockSubblocks,
  createBlockFromParams,
  filterDisallowedTools,
  normalizeSubblockValue,
  resolveBlockRetryUpdate,
} from '@/lib/workflows/editing/builders'
import type { SkippedItem } from '@/lib/workflows/editing/types'

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

const apiBlockConfig = {
  type: 'api',
  name: 'API',
  outputs: {},
  subBlocks: [
    {
      id: 'redirectPolicyVersion',
      type: 'short-input',
      hidden: true,
      defaultValue: 'standard-v1',
    },
    {
      id: 'sendCredentialsOnCrossOriginRedirect',
      type: 'switch',
      defaultValue: true,
    },
  ],
}

const blocksByType: Record<string, unknown> = {
  api: apiBlockConfig,
  agent: agentBlockConfig,
  condition: conditionBlockConfig,
  knowledge: knowledgeBlockConfig,
  slack: slackBlockConfig,
}

vi.mock('@/blocks/registry', () => ({
  getAllBlocks: () => [
    apiBlockConfig,
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

  it('seeds hidden compatibility defaults on programmatically created blocks', () => {
    const block = createBlockFromParams('api-1', {
      type: 'api',
      name: 'API',
      triggerMode: false,
    })

    expect(block.subBlocks.redirectPolicyVersion.value).toBe('standard-v1')
    expect(block.subBlocks.sendCredentialsOnCrossOriginRedirect.value).toBeNull()
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

describe('block retry policy', () => {
  it('defaults the numbers when only enabling', () => {
    expect(resolveBlockRetryUpdate({ enabled: true }, undefined)).toEqual({
      enabled: true,
      maxTries: 3,
      waitBetweenTriesMs: 1000,
    })
  })

  it('treats numbers alone as an intent to retry', () => {
    expect(resolveBlockRetryUpdate({ maxTries: 4 }, undefined)).toMatchObject({
      enabled: true,
      maxTries: 4,
    })
  })

  it('keeps configured numbers when retry is switched off', () => {
    const existing = { enabled: true, maxTries: 5, waitBetweenTriesMs: 250 }
    expect(resolveBlockRetryUpdate({ enabled: false }, existing)).toEqual({
      enabled: false,
      maxTries: 5,
      waitBetweenTriesMs: 250,
    })
  })

  it('clamps out-of-range values instead of rejecting them', () => {
    expect(resolveBlockRetryUpdate({ enabled: true, maxTries: 99 }, undefined).maxTries).toBe(5)
    expect(resolveBlockRetryUpdate({ enabled: true, maxTries: 1 }, undefined).maxTries).toBe(2)
    expect(
      resolveBlockRetryUpdate({ enabled: true, waitBetweenTriesMs: 999999 }, undefined)
        .waitBetweenTriesMs
    ).toBe(5000)
  })

  it('applies a policy to an eligible block', () => {
    const block: Record<string, unknown> = { type: 'agent' }
    applyBlockRetry(
      block,
      { enabled: true, maxTries: 4 },
      {
        operationType: 'edit',
        blockId: 'b1',
      }
    )
    expect(block.retry).toMatchObject({ enabled: true, maxTries: 4 })
  })

  it('reports why an ineligible block cannot retry instead of storing dead config', () => {
    const skippedItems: SkippedItem[] = []
    const block: Record<string, unknown> = { type: 'agent', triggerMode: true }

    applyBlockRetry(
      block,
      { enabled: true },
      {
        operationType: 'edit',
        blockId: 'b1',
        skippedItems,
      }
    )

    expect(block.retry).toBeUndefined()
    expect(skippedItems).toHaveLength(1)
    expect(skippedItems[0]).toMatchObject({ type: 'retry_not_supported', blockId: 'b1' })
  })

  it('clears the policy when null is sent', () => {
    const block: Record<string, unknown> = {
      type: 'agent',
      retry: { enabled: true, maxTries: 3, waitBetweenTriesMs: 1000 },
    }
    applyBlockRetry(block, null, { operationType: 'edit', blockId: 'b1' })
    expect(block.retry).toBeUndefined()
  })
})
