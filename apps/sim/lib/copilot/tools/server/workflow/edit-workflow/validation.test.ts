/**
 * @vitest-environment node
 */
import { envFlagsMock } from '@sim/testing'
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

const knowledgeBlockConfig = {
  type: 'knowledge',
  name: 'Knowledge',
  outputs: {},
  subBlocks: [{ id: 'knowledgeBaseId', type: 'knowledge-base-selector' }],
}

const canonicalCredBlockConfig = {
  type: 'canonicalcred',
  name: 'CanonicalCred',
  outputs: {},
  subBlocks: [
    { id: 'credential', type: 'oauth-input', canonicalParamId: 'cred', mode: 'basic' },
    { id: 'manualCredential', type: 'short-input', canonicalParamId: 'cred', mode: 'advanced' },
  ],
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
              : type === 'knowledge'
                ? knowledgeBlockConfig
                : type === 'canonicalcred'
                  ? canonicalCredBlockConfig
                  : undefined,
}))

vi.mock('@/blocks/utils', () => ({
  getModelOptions: mockGetModelOptions,
}))

vi.mock('@/lib/copilot/validation/selector-validator', () => ({
  validateSelectorIds: mockValidateSelectorIds,
}))

vi.mock('@/lib/core/config/env-flags', () => envFlagsMock)

vi.mock('@/providers/utils', () => ({
  getHostedModels: () => [],
}))

import {
  collectUnresolvedReferences,
  preValidateCredentialInputs,
  validateInputsForBlock,
  validateWorkflowSelectorIds,
} from './validation'

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

const CTX = { userId: 'user-1', workspaceId: 'workspace-1' }

describe('validateWorkflowSelectorIds (credential inclusion)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockValidateSelectorIds.mockResolvedValue({ valid: [], invalid: [] })
  })

  it('skips oauth-input by default (credentials pre-validated)', async () => {
    const state = {
      blocks: { b1: { type: 'slack', name: 'Slack', subBlocks: { credential: { value: 'bad' } } } },
    }
    const errors = await validateWorkflowSelectorIds(state, CTX)
    expect(errors).toHaveLength(0)
    expect(mockValidateSelectorIds).not.toHaveBeenCalled()
  })

  it('validates oauth-input when includeCredentials is set', async () => {
    mockValidateSelectorIds.mockResolvedValue({
      valid: [],
      invalid: ['bad'],
      warning: 'Accessible workspace credentials: Work [cred_ok]',
    })
    const state = {
      blocks: { b1: { type: 'slack', name: 'Slack', subBlocks: { credential: { value: 'bad' } } } },
    }
    const errors = await validateWorkflowSelectorIds(state, CTX, { includeCredentials: true })
    expect(mockValidateSelectorIds).toHaveBeenCalledWith('oauth-input', 'bad', CTX)
    expect(errors).toHaveLength(1)
    expect(errors[0]?.error).toContain('oauth-input')
  })
})

describe('collectUnresolvedReferences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockValidateSelectorIds.mockResolvedValue({ valid: [], invalid: [] })
  })

  it('flags a basic-mode credential that does not resolve (kind: credential)', async () => {
    mockValidateSelectorIds.mockResolvedValue({
      valid: [],
      invalid: ['bad-cred'],
      warning: 'Accessible workspace credentials: Work [cred_ok]',
    })
    const state = {
      blocks: {
        b1: { type: 'slack', name: 'Slack', subBlocks: { credential: { value: 'bad-cred' } } },
      },
    }
    const refs = await collectUnresolvedReferences(state, CTX)
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({
      blockId: 'b1',
      blockName: 'Slack',
      field: 'credential',
      kind: 'credential',
    })
    expect(refs[0]?.reason).toContain('bad-cred')
    expect(refs[0]?.reason).toContain('Accessible workspace credentials')
  })

  it('flags an unresolved knowledge base (kind: resource)', async () => {
    mockValidateSelectorIds.mockResolvedValue({ valid: [], invalid: ['kb_x'] })
    const state = {
      blocks: {
        kb1: { type: 'knowledge', name: 'KB', subBlocks: { knowledgeBaseId: { value: 'kb_x' } } },
      },
    }
    const refs = await collectUnresolvedReferences(state, CTX)
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({ blockId: 'kb1', field: 'knowledgeBaseId', kind: 'resource' })
  })

  it('only validates the active canonical member (inactive member is not flagged)', async () => {
    mockValidateSelectorIds.mockResolvedValue({ valid: [], invalid: ['stranded'] })
    // No override + empty basic + filled advanced -> resolves to advanced mode.
    // The active member is the (short-input) manual twin, so the inactive
    // oauth-input basic member is never validated.
    const state = {
      blocks: {
        c1: {
          type: 'canonicalcred',
          name: 'Cred',
          subBlocks: { credential: { value: '' }, manualCredential: { value: 'stranded' } },
        },
      },
    }
    const refs = await collectUnresolvedReferences(state, CTX)
    expect(refs).toHaveLength(0)
    expect(mockValidateSelectorIds).not.toHaveBeenCalled()
  })

  it('validates the active basic credential member', async () => {
    mockValidateSelectorIds.mockResolvedValue({ valid: [], invalid: ['good-but-missing'] })
    const state = {
      blocks: {
        c1: {
          type: 'canonicalcred',
          name: 'Cred',
          data: { canonicalModes: { cred: 'basic' } },
          subBlocks: { credential: { value: 'good-but-missing' }, manualCredential: { value: '' } },
        },
      },
    }
    const refs = await collectUnresolvedReferences(state, CTX)
    expect(mockValidateSelectorIds).toHaveBeenCalledWith('oauth-input', 'good-but-missing', CTX)
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({ field: 'credential', kind: 'credential' })
  })
})
