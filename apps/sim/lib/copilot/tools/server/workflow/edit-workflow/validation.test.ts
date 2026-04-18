/**
 * @vitest-environment node
 */
import { featureFlagsMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeConditionRouterIds } from './builders'

const { mockValidateSelectorIds, mockGetModelOptions } = vi.hoisted(() => ({
  mockValidateSelectorIds: vi.fn(),
  mockGetModelOptions: vi.fn(() => []),
}))

const conditionBlockConfig = {
  type: 'condition',
  name: 'Condition',
  outputs: {},
  subBlocks: [{ id: 'conditions', type: 'condition-input' }],
}

const oauthBlockConfig = {
  type: 'slack',
  name: 'Slack',
  outputs: {},
  subBlocks: [{ id: 'credential', type: 'oauth-input' }],
}

const routerBlockConfig = {
  type: 'router_v2',
  name: 'Router',
  outputs: {},
  subBlocks: [
    { id: 'routes', type: 'router-input' },
    { id: 'model', type: 'combobox', options: mockGetModelOptions },
  ],
}

const agentBlockConfig = {
  type: 'agent',
  name: 'Agent',
  outputs: {},
  subBlocks: [{ id: 'model', type: 'combobox', options: mockGetModelOptions }],
}

const huggingfaceBlockConfig = {
  type: 'huggingface',
  name: 'HuggingFace',
  outputs: {},
  subBlocks: [{ id: 'model', type: 'short-input' }],
}

vi.mock('@/blocks/registry', () => ({
  getBlock: (type: string) =>
    type === 'condition'
      ? conditionBlockConfig
      : type === 'slack'
        ? oauthBlockConfig
        : type === 'router_v2'
          ? routerBlockConfig
          : type === 'agent'
            ? agentBlockConfig
            : type === 'huggingface'
              ? huggingfaceBlockConfig
              : undefined,
}))

vi.mock('@/blocks/utils', () => ({
  getModelOptions: mockGetModelOptions,
}))

vi.mock('@/lib/copilot/validation/selector-validator', () => ({
  validateSelectorIds: mockValidateSelectorIds,
}))

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)

vi.mock('@/providers/utils', () => ({
  getHostedModels: () => [],
}))

import { preValidateCredentialInputs, validateInputsForBlock } from './validation'

describe('validateInputsForBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockValidateSelectorIds.mockResolvedValue({ valid: [], invalid: [] })
  })

  it('accepts condition-input arrays with arbitrary item ids', () => {
    const result = validateInputsForBlock(
      'condition',
      {
        conditions: JSON.stringify([
          { id: 'cond-1-if', title: 'if', value: 'true' },
          { id: 'cond-1-else', title: 'else', value: '' },
        ]),
      },
      'condition-1'
    )

    expect(result.validInputs.conditions).toBeDefined()
    expect(result.errors).toHaveLength(0)
  })

  it('rejects non-array condition-input values', () => {
    const result = validateInputsForBlock('condition', { conditions: 'not-json' }, 'condition-1')

    expect(result.validInputs.conditions).toBeUndefined()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.error).toContain('expected a JSON array')
  })

  it('accepts known agent model ids', () => {
    const result = validateInputsForBlock('agent', { model: 'claude-sonnet-4-6' }, 'agent-1')

    expect(result.errors).toHaveLength(0)
    expect(result.validInputs.model).toBe('claude-sonnet-4-6')
  })

  it('rejects hallucinated agent model ids that match a static provider pattern', () => {
    const result = validateInputsForBlock('agent', { model: 'claude-sonnet-4.6' }, 'agent-1')

    expect(result.validInputs.model).toBeUndefined()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.field).toBe('model')
    expect(result.errors[0]?.error).toContain('Unknown model id')
    expect(result.errors[0]?.error).toContain('claude-sonnet-4-6')
  })

  it('rejects legacy claude-4.5-haiku style ids', () => {
    const result = validateInputsForBlock('agent', { model: 'claude-4.5-haiku' }, 'agent-1')

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.error).toContain('Unknown model id')
  })

  it('allows empty model values', () => {
    const result = validateInputsForBlock('agent', { model: '' }, 'agent-1')

    expect(result.errors).toHaveLength(0)
    expect(result.validInputs.model).toBe('')
  })

  it('allows custom ollama-prefixed model ids', () => {
    const result = validateInputsForBlock('agent', { model: 'ollama/my-private-model' }, 'agent-1')

    expect(result.errors).toHaveLength(0)
    expect(result.validInputs.model).toBe('ollama/my-private-model')
  })

  it('validates the model field on router_v2 blocks too', () => {
    const valid = validateInputsForBlock('router_v2', { model: 'claude-sonnet-4-6' }, 'router-1')
    expect(valid.errors).toHaveLength(0)
    expect(valid.validInputs.model).toBe('claude-sonnet-4-6')

    const invalid = validateInputsForBlock('router_v2', { model: 'claude-sonnet-4.6' }, 'router-1')
    expect(invalid.validInputs.model).toBeUndefined()
    expect(invalid.errors).toHaveLength(1)
    expect(invalid.errors[0]?.blockType).toBe('router_v2')
    expect(invalid.errors[0]?.field).toBe('model')
    expect(invalid.errors[0]?.error).toContain('Unknown model id')
  })

  it("does not apply model validation to blocks whose model field is not Sim's catalog", () => {
    const result = validateInputsForBlock(
      'huggingface',
      { model: 'mistralai/Mistral-7B-Instruct-v0.3' },
      'hf-1'
    )

    expect(result.errors).toHaveLength(0)
    expect(result.validInputs.model).toBe('mistralai/Mistral-7B-Instruct-v0.3')
  })

  it('rejects a bare Ollama-style tag without the provider prefix', () => {
    const result = validateInputsForBlock('agent', { model: 'llama3.1:8b' }, 'agent-1')

    expect(result.validInputs.model).toBeUndefined()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.error).toContain('Unknown model id')
    expect(result.errors[0]?.error).toContain('ollama/')
  })

  it('rejects date-pinned ids that are not literally in the catalog', () => {
    const result = validateInputsForBlock(
      'agent',
      { model: 'claude-sonnet-4-5-20250929' },
      'agent-1'
    )

    expect(result.validInputs.model).toBeUndefined()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.error).toContain('Unknown model id')
  })

  it('trims whitespace around catalog model ids and stores the trimmed value', () => {
    const result = validateInputsForBlock('agent', { model: '  gpt-5.4  ' }, 'agent-1')

    expect(result.errors).toHaveLength(0)
    expect(result.validInputs.model).toBe('gpt-5.4')
  })

  it('rejects a pattern-matching but uncataloged id even with surrounding whitespace', () => {
    const result = validateInputsForBlock('agent', { model: '  gpt-100-ultra  ' }, 'agent-1')

    expect(result.validInputs.model).toBeUndefined()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.error).toContain('gpt-100-ultra')
    expect(result.errors[0]?.error).not.toMatch(/\s{2,}/)
  })
})

describe('normalizeConditionRouterIds', () => {
  it('assigns canonical block-scoped ids to condition branches', () => {
    const input = JSON.stringify([
      { id: 'whatever', title: 'if', value: 'true' },
      { id: 'anything', title: 'else if', value: 'false' },
      { id: 'doesnt-matter', title: 'else', value: '' },
    ])

    const result = normalizeConditionRouterIds('block-1', 'conditions', input)
    const parsed = JSON.parse(result as string)

    expect(parsed[0].id).toBe('block-1-if')
    expect(parsed[1].id).toBe('block-1-else-if-0')
    expect(parsed[2].id).toBe('block-1-else')
  })

  it('assigns canonical block-scoped ids to router routes', () => {
    const input = [
      { id: 'route-a', title: 'Support', value: 'support query' },
      { id: 'route-b', title: 'Sales', value: 'sales query' },
    ]

    const result = normalizeConditionRouterIds('block-1', 'routes', input)
    const arr = result as any[]

    expect(arr[0].id).toBe('block-1-route1')
    expect(arr[1].id).toBe('block-1-route2')
  })

  it('passes through non-condition/router keys unchanged', () => {
    const input = 'some value'
    expect(normalizeConditionRouterIds('block-1', 'code', input)).toBe(input)
  })
})

describe('preValidateCredentialInputs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockValidateSelectorIds.mockResolvedValue({ valid: ['shared-cred-1'], invalid: [] })
  })

  it('passes workspace context when validating shared oauth credentials', async () => {
    const operations = [
      {
        operation_type: 'edit' as const,
        block_id: 'block-1',
        params: {
          type: 'slack',
          inputs: {
            credential: 'shared-cred-1',
          },
        },
      },
    ]

    const result = await preValidateCredentialInputs(operations, {
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })

    expect(mockValidateSelectorIds).toHaveBeenCalledWith('oauth-input', ['shared-cred-1'], {
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })
    expect(result.filteredOperations[0]?.params?.inputs?.credential).toBe('shared-cred-1')
    expect(result.errors).toHaveLength(0)
  })
})
