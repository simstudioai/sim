/**
 * @vitest-environment node
 */
import { envFlagsMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeConditionRouterIds } from './builders'

const {
  mockValidateSelectorIds,
  mockGetModelOptions,
  mockEnvFlags,
  mockGetTool,
  mockGetCustomToolById,
  mockGetSkillById,
} = vi.hoisted(() => ({
  mockValidateSelectorIds: vi.fn(),
  mockGetModelOptions: vi.fn(() => []),
  mockEnvFlags: { isHosted: false },
  mockGetTool: vi.fn(),
  mockGetCustomToolById: vi.fn(),
  mockGetSkillById: vi.fn(),
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
  tools: { access: ['slack_message'] },
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
  subBlocks: [
    { id: 'model', type: 'combobox', options: mockGetModelOptions },
    { id: 'tools', type: 'tool-input' },
    { id: 'skills', type: 'skill-input' },
  ],
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

// Mirrors video_generator_v3: routes provider -> tool; only video_falai has hosting.
const videoBlockConfig = {
  type: 'video_generator_v3',
  name: 'Video Generator',
  outputs: {},
  subBlocks: [{ id: 'provider', type: 'dropdown' }],
  tools: {
    access: ['video_runway', 'video_falai'],
    config: {
      tool: (params: Record<string, unknown>) =>
        params.provider === 'falai' ? 'video_falai' : 'video_runway',
    },
  },
}

// A hosted block whose tool's managed key param is NOT named 'apiKey'.
const customKeyBlockConfig = {
  type: 'custom_key_block',
  name: 'Custom Key Block',
  outputs: {},
  subBlocks: [{ id: 'serviceKey', type: 'short-input' }],
  tools: { access: ['custom_key_tool'], config: { tool: () => 'custom_key_tool' } },
}

// Single tool with a per-provider `enabled` gate (mirrors image_generate, falai-only hosting).
const imageBlockConfig = {
  type: 'image_generator_v2',
  name: 'Image Generator',
  outputs: {},
  subBlocks: [{ id: 'provider', type: 'dropdown' }],
  tools: { access: ['image_generate'], config: { tool: () => 'image_generate' } },
}

// Tool whose hosting.enabled predicate throws — used to assert fail-toward-strip behavior.
const throwGateBlockConfig = {
  type: 'throw_gate_block',
  name: 'Throw Gate Block',
  outputs: {},
  subBlocks: [{ id: 'provider', type: 'dropdown' }],
  tools: { access: ['throw_gate_tool'], config: { tool: () => 'throw_gate_tool' } },
}

// Block whose tool selector throws — should fall back to scanning access tools (video_falai).
const throwSelectorBlockConfig = {
  type: 'throw_selector_block',
  name: 'Throw Selector Block',
  outputs: {},
  subBlocks: [{ id: 'provider', type: 'dropdown' }],
  tools: {
    access: ['video_falai'],
    config: {
      tool: () => {
        throw new Error('selector boom')
      },
    },
  },
}

// Tool registry stand-in for the hosted-tool tests.
const toolsByIdMock: Record<string, unknown> = {
  video_falai: { id: 'video_falai', hosting: { apiKeyParam: 'apiKey' } },
  video_runway: { id: 'video_runway' },
  custom_key_tool: { id: 'custom_key_tool', hosting: { apiKeyParam: 'serviceKey' } },
  image_generate: {
    id: 'image_generate',
    hosting: {
      apiKeyParam: 'apiKey',
      enabled: (p: Record<string, unknown>) => p.provider === 'falai',
    },
  },
  throw_gate_tool: {
    id: 'throw_gate_tool',
    hosting: {
      apiKeyParam: 'apiKey',
      enabled: () => {
        throw new Error('boom')
      },
    },
  },
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
                  : type === 'video_generator_v3'
                    ? videoBlockConfig
                    : type === 'custom_key_block'
                      ? customKeyBlockConfig
                      : type === 'image_generator_v2'
                        ? imageBlockConfig
                        : type === 'throw_gate_block'
                          ? throwGateBlockConfig
                          : type === 'throw_selector_block'
                            ? throwSelectorBlockConfig
                            : undefined,
}))

vi.mock('@/blocks/utils', () => ({
  getModelOptions: mockGetModelOptions,
}))

vi.mock('@/tools/utils', () => ({
  getTool: mockGetTool,
}))

vi.mock('@/lib/copilot/validation/selector-validator', () => ({
  validateSelectorIds: mockValidateSelectorIds,
}))

vi.mock('@/lib/workflows/custom-tools/operations', () => ({
  getCustomToolById: mockGetCustomToolById,
}))

vi.mock('@/lib/workflows/skills/operations', () => ({
  getSkillById: mockGetSkillById,
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  ...envFlagsMock,
  get isHosted() {
    return mockEnvFlags.isHosted
  },
}))

vi.mock('@/providers/utils', () => ({
  getHostedModels: () => [],
}))

import {
  collectUnresolvedAgentToolReferences,
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

describe('preValidateCredentialInputs (hosted-tool blocks)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockValidateSelectorIds.mockResolvedValue({ valid: [], invalid: [] })
    mockGetTool.mockImplementation((id: string) => toolsByIdMock[id])
    mockEnvFlags.isHosted = true
  })

  afterEach(() => {
    mockEnvFlags.isHosted = false
  })

  const ctx = { userId: 'user-1', workspaceId: 'workspace-1' }

  it('strips apiKey when the block resolves to a hosted tool on hosted Sim', async () => {
    const operations = [
      {
        operation_type: 'add' as const,
        block_id: 'video-1',
        params: {
          type: 'video_generator_v3',
          inputs: { provider: 'falai', model: 'veo-3.1', apiKey: '{{FAL_API_KEY}}' },
        },
      },
    ]

    const result = await preValidateCredentialInputs(operations, ctx)

    expect(result.filteredOperations[0]?.params?.inputs?.apiKey).toBeUndefined()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({ blockId: 'video-1', field: 'apiKey' })
    expect(result.errors[0]?.error).toContain('managed by Sim')
  })

  it('preserves apiKey when the resolved tool has no hosting (non-falai provider)', async () => {
    const operations = [
      {
        operation_type: 'add' as const,
        block_id: 'video-1',
        params: {
          type: 'video_generator_v3',
          inputs: { provider: 'runway', apiKey: 'user-runway-key' },
        },
      },
    ]

    const result = await preValidateCredentialInputs(operations, ctx)

    expect(result.filteredOperations[0]?.params?.inputs?.apiKey).toBe('user-runway-key')
    expect(result.errors).toHaveLength(0)
  })

  it('resolves provider from existing block state for edit ops that only set apiKey', async () => {
    const operations = [
      {
        operation_type: 'edit' as const,
        block_id: 'video-1',
        params: {
          type: 'video_generator_v3',
          inputs: { apiKey: '{{FAL_API_KEY}}' },
        },
      },
    ]
    const workflowState = {
      blocks: {
        'video-1': {
          type: 'video_generator_v3',
          subBlocks: { provider: { value: 'falai' } },
        },
      },
    }

    const result = await preValidateCredentialInputs(operations, ctx, workflowState)

    expect(result.filteredOperations[0]?.params?.inputs?.apiKey).toBeUndefined()
    expect(result.errors).toHaveLength(1)
  })

  it('strips apiKey on a type-less edit op, resolving block type + provider from workflow state', async () => {
    // Mirrors the real failure: agent edits only { apiKey } with no `type` restated.
    const operations = [
      {
        operation_type: 'edit' as const,
        block_id: 'video-1',
        params: { inputs: { apiKey: 'test-api-key-12345' } },
      },
    ]
    const workflowState = {
      blocks: {
        'video-1': {
          type: 'video_generator_v3',
          subBlocks: { provider: { value: 'falai' } },
        },
      },
    }

    const result = await preValidateCredentialInputs(operations, ctx, workflowState)

    expect(result.filteredOperations[0]?.params?.inputs?.apiKey).toBeUndefined()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({ blockId: 'video-1', field: 'apiKey' })
  })

  it('strips apiKey on a hosted-tool block nested inside a loop', async () => {
    const operations = [
      {
        operation_type: 'add' as const,
        block_id: 'loop-1',
        params: {
          type: 'loop',
          inputs: {},
          nestedNodes: {
            'video-child': {
              type: 'video_generator_v3',
              inputs: { provider: 'falai', model: 'veo-3.1', apiKey: '{{FAL_API_KEY}}' },
            },
          },
        },
      },
    ]

    const result = await preValidateCredentialInputs(operations, ctx)

    const nested = result.filteredOperations[0]?.params?.nestedNodes as
      | Record<string, { inputs?: Record<string, unknown> }>
      | undefined
    expect(nested?.['video-child']?.inputs?.apiKey).toBeUndefined()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({ blockId: 'video-child', field: 'apiKey' })
  })

  it("strips a hosted tool's key field even when it is not named apiKey", async () => {
    const operations = [
      {
        operation_type: 'add' as const,
        block_id: 'custom-1',
        params: {
          type: 'custom_key_block',
          inputs: { serviceKey: '{{SOME_SERVICE_KEY}}' },
        },
      },
    ]

    const result = await preValidateCredentialInputs(operations, ctx)

    expect(result.filteredOperations[0]?.params?.inputs?.serviceKey).toBeUndefined()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({ blockId: 'custom-1', field: 'serviceKey' })
  })

  it('strips apiKey on a grandchild block nested two levels deep (loop in loop)', async () => {
    const operations = [
      {
        operation_type: 'add' as const,
        block_id: 'outer-loop',
        params: {
          type: 'loop',
          inputs: {},
          nestedNodes: {
            'inner-loop': {
              type: 'loop',
              inputs: {},
              nestedNodes: {
                'video-child': {
                  type: 'video_generator_v3',
                  inputs: { provider: 'falai', apiKey: '{{FAL_API_KEY}}' },
                },
              },
            },
          },
        },
      },
    ]

    const result = await preValidateCredentialInputs(operations, ctx)

    const innerInputs = (
      (result.filteredOperations[0]?.params?.nestedNodes as Record<string, any>)?.['inner-loop']
        ?.nestedNodes as Record<string, { inputs?: Record<string, unknown> }>
    )?.['video-child']?.inputs
    expect(innerInputs?.apiKey).toBeUndefined()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({ blockId: 'video-child', field: 'apiKey' })
  })

  it('uses same-batch state for nested children (provider set earlier, apiKey set later)', async () => {
    const operations = [
      {
        operation_type: 'add' as const,
        block_id: 'loop-1',
        params: {
          type: 'loop',
          inputs: {},
          nestedNodes: {
            'video-child': { type: 'video_generator_v3', inputs: { provider: 'falai' } },
          },
        },
      },
      {
        operation_type: 'edit' as const,
        block_id: 'loop-1',
        params: {
          nestedNodes: {
            'video-child': { type: 'video_generator_v3', inputs: { apiKey: 'test-key' } },
          },
        },
      },
    ]

    const result = await preValidateCredentialInputs(operations, ctx)

    const nested = result.filteredOperations[1]?.params?.nestedNodes as
      | Record<string, { inputs?: Record<string, unknown> }>
      | undefined
    expect(nested?.['video-child']?.inputs?.apiKey).toBeUndefined()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({ blockId: 'video-child', field: 'apiKey' })
  })

  it('strips a key set before a later op makes the block hosted (reverse batch order)', async () => {
    // op1 sets apiKey while the block is still non-hosted (runway); op2 later flips it to falai.
    // Deciding against final state must still strip op1's key.
    const operations = [
      {
        operation_type: 'edit' as const,
        block_id: 'video-1',
        params: { inputs: { apiKey: '{{FAL_API_KEY}}' } },
      },
      {
        operation_type: 'edit' as const,
        block_id: 'video-1',
        params: { inputs: { provider: 'falai' } },
      },
    ]
    const workflowState = {
      blocks: {
        'video-1': { type: 'video_generator_v3', subBlocks: { provider: { value: 'runway' } } },
      },
    }

    const result = await preValidateCredentialInputs(operations, ctx, workflowState)

    expect(result.filteredOperations[0]?.params?.inputs?.apiKey).toBeUndefined()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({ blockId: 'video-1', field: 'apiKey' })
  })

  it('does not let a bogus type on an earlier op block stripping on a later edit', async () => {
    const operations = [
      {
        operation_type: 'edit' as const,
        block_id: 'video-1',
        params: { type: '', inputs: { prompt: 'x' } },
      },
      {
        operation_type: 'edit' as const,
        block_id: 'video-1',
        params: { inputs: { apiKey: '{{FAL_API_KEY}}' } },
      },
    ]
    const workflowState = {
      blocks: {
        'video-1': { type: 'video_generator_v3', subBlocks: { provider: { value: 'falai' } } },
      },
    }

    const result = await preValidateCredentialInputs(operations, ctx, workflowState)

    expect(result.filteredOperations[1]?.params?.inputs?.apiKey).toBeUndefined()
    expect(result.errors).toHaveLength(1)
  })

  it('uses same-batch state: a type-less apiKey edit after an earlier op makes the block hosted', async () => {
    // op1 switches provider to falai (hosted); op2 (type-less) sets apiKey. op2 must see op1's
    // provider, not the stale snapshot (runway), and strip the key.
    const operations = [
      {
        operation_type: 'edit' as const,
        block_id: 'video-1',
        params: { inputs: { provider: 'falai' } },
      },
      {
        operation_type: 'edit' as const,
        block_id: 'video-1',
        params: { inputs: { apiKey: 'test-api-key-12345' } },
      },
    ]
    const workflowState = {
      blocks: {
        'video-1': {
          type: 'video_generator_v3',
          subBlocks: { provider: { value: 'runway' } },
        },
      },
    }

    const result = await preValidateCredentialInputs(operations, ctx, workflowState)

    expect(result.filteredOperations[1]?.params?.inputs?.apiKey).toBeUndefined()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({ blockId: 'video-1', field: 'apiKey' })
  })

  it('strips apiKey when the tool selector throws (falls back to access tools)', async () => {
    const operations = [
      {
        operation_type: 'add' as const,
        block_id: 'sel-1',
        params: {
          type: 'throw_selector_block',
          inputs: { provider: 'falai', apiKey: 'user-key' },
        },
      },
    ]

    const result = await preValidateCredentialInputs(operations, ctx)

    expect(result.filteredOperations[0]?.params?.inputs?.apiKey).toBeUndefined()
    expect(result.errors).toHaveLength(1)
  })

  it('strips apiKey when a tool hosting enabled predicate throws (fail toward stripping)', async () => {
    const operations = [
      {
        operation_type: 'add' as const,
        block_id: 'gate-1',
        params: {
          type: 'throw_gate_block',
          inputs: { provider: 'whatever', apiKey: 'user-key' },
        },
      },
    ]

    const result = await preValidateCredentialInputs(operations, ctx)

    expect(result.filteredOperations[0]?.params?.inputs?.apiKey).toBeUndefined()
    expect(result.errors).toHaveLength(1)
  })

  it('preserves apiKey on self-hosted deployments (isHosted false)', async () => {
    mockEnvFlags.isHosted = false
    const operations = [
      {
        operation_type: 'add' as const,
        block_id: 'video-1',
        params: {
          type: 'video_generator_v3',
          inputs: { provider: 'falai', model: 'veo-3.1', apiKey: '{{FAL_API_KEY}}' },
        },
      },
    ]

    const result = await preValidateCredentialInputs(operations, ctx)

    expect(result.filteredOperations[0]?.params?.inputs?.apiKey).toBe('{{FAL_API_KEY}}')
    expect(result.errors).toHaveLength(0)
  })

  it('strips apiKey when the tool hosting enabled gate passes (image, falai)', async () => {
    const operations = [
      {
        operation_type: 'add' as const,
        block_id: 'image-1',
        params: {
          type: 'image_generator_v2',
          inputs: { provider: 'falai', apiKey: '{{FAL_API_KEY}}' },
        },
      },
    ]

    const result = await preValidateCredentialInputs(operations, ctx)

    expect(result.filteredOperations[0]?.params?.inputs?.apiKey).toBeUndefined()
    expect(result.errors).toHaveLength(1)
  })

  it('preserves apiKey when the tool hosting enabled gate fails (image, non-falai)', async () => {
    const operations = [
      {
        operation_type: 'add' as const,
        block_id: 'image-1',
        params: {
          type: 'image_generator_v2',
          inputs: { provider: 'openai', apiKey: 'user-openai-key' },
        },
      },
    ]

    const result = await preValidateCredentialInputs(operations, ctx)

    expect(result.filteredOperations[0]?.params?.inputs?.apiKey).toBe('user-openai-key')
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

describe('validateInputsForBlock - agent tools (tool-input)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts a reference-format custom tool', () => {
    const result = validateInputsForBlock(
      'agent',
      { tools: [{ type: 'custom-tool', customToolId: 'ct_123', usageControl: 'auto' }] },
      'agent-1'
    )
    expect(result.errors).toHaveLength(0)
    expect(result.validInputs.tools).toBeDefined()
  })

  it('accepts an inline custom tool with schema.function', () => {
    const result = validateInputsForBlock(
      'agent',
      {
        tools: [
          {
            type: 'custom-tool',
            schema: { type: 'function', function: { name: 'foo', parameters: { type: 'object' } } },
            code: 'return 1',
          },
        ],
      },
      'agent-1'
    )
    expect(result.errors).toHaveLength(0)
    expect(result.validInputs.tools).toBeDefined()
  })

  it('rejects a custom tool missing "type": "custom-tool" (the no-icon case)', () => {
    const result = validateInputsForBlock(
      'agent',
      { tools: [{ customToolId: 'ct_123', usageControl: 'auto' }] },
      'agent-1'
    )
    expect(result.validInputs.tools).toBeUndefined()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.error).toContain('custom-tool')
  })

  it('rejects a raw OpenAI function schema pasted into the array', () => {
    const result = validateInputsForBlock(
      'agent',
      { tools: [{ type: 'function', function: { name: 'foo', parameters: {} } }] },
      'agent-1'
    )
    expect(result.validInputs.tools).toBeUndefined()
    expect(result.errors[0]?.error).toContain('raw function schema')
  })

  it('rejects a custom tool with neither customToolId nor inline schema', () => {
    const result = validateInputsForBlock(
      'agent',
      { tools: [{ type: 'custom-tool', usageControl: 'auto' }] },
      'agent-1'
    )
    expect(result.validInputs.tools).toBeUndefined()
    expect(result.errors[0]?.error).toContain('customToolId')
  })

  it('rejects an MCP tool missing params.serverId/toolName', () => {
    const result = validateInputsForBlock(
      'agent',
      { tools: [{ type: 'mcp', title: 'x', usageControl: 'auto' }] },
      'agent-1'
    )
    expect(result.validInputs.tools).toBeUndefined()
    expect(result.errors[0]?.error).toContain('params.serverId')
  })

  it('accepts an MCP tool with params.serverId and params.toolName', () => {
    const result = validateInputsForBlock(
      'agent',
      {
        tools: [
          {
            type: 'mcp',
            params: { serverId: 'srv_1', toolName: 'web_search' },
            usageControl: 'auto',
          },
        ],
      },
      'agent-1'
    )
    expect(result.errors).toHaveLength(0)
    expect(result.validInputs.tools).toBeDefined()
  })

  it('accepts an integration tool whose type is a known block', () => {
    const result = validateInputsForBlock(
      'agent',
      { tools: [{ type: 'slack', operation: 'send', usageControl: 'auto' }] },
      'agent-1'
    )
    expect(result.errors).toHaveLength(0)
    expect(result.validInputs.tools).toBeDefined()
  })

  it('rejects an unrecognized tool type', () => {
    const result = validateInputsForBlock(
      'agent',
      { tools: [{ type: 'nonexistent-block', operation: 'x' }] },
      'agent-1'
    )
    expect(result.validInputs.tools).toBeUndefined()
    expect(result.errors[0]?.error).toContain('unrecognized tool type')
  })

  it('rejects a known block that exposes no callable tools (not tool-capable)', () => {
    const result = validateInputsForBlock(
      'agent',
      { tools: [{ type: 'condition', operation: 'x' }] },
      'agent-1'
    )
    expect(result.validInputs.tools).toBeUndefined()
    expect(result.errors[0]?.error).toContain('cannot be attached as an agent tool')
  })

  it('reports every bad entry in a single error', () => {
    const result = validateInputsForBlock(
      'agent',
      { tools: [{ customToolId: 'x' }, { type: 'mcp' }] },
      'agent-1'
    )
    expect(result.validInputs.tools).toBeUndefined()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.error).toContain('tools[0]')
    expect(result.errors[0]?.error).toContain('tools[1]')
  })

  it('rejects a non-array tools value', () => {
    const result = validateInputsForBlock('agent', { tools: 'not-an-array' }, 'agent-1')
    expect(result.validInputs.tools).toBeUndefined()
    expect(result.errors[0]?.error).toContain('expected an array')
  })
})

describe('validateInputsForBlock - agent skills (skill-input)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts a well-formed skill entry', () => {
    const result = validateInputsForBlock(
      'agent',
      { skills: [{ skillId: 'builtin-deploy-workflow', name: 'deploy-workflow' }] },
      'agent-1'
    )
    expect(result.errors).toHaveLength(0)
    expect(result.validInputs.skills).toBeDefined()
  })

  it('rejects a skill entry that uses "id" instead of "skillId"', () => {
    const result = validateInputsForBlock('agent', { skills: [{ id: 'x', name: 'y' }] }, 'agent-1')
    expect(result.validInputs.skills).toBeUndefined()
    expect(result.errors[0]?.error).toContain('skillId')
  })

  it('rejects a skill entry missing skillId', () => {
    const result = validateInputsForBlock('agent', { skills: [{ name: 'y' }] }, 'agent-1')
    expect(result.validInputs.skills).toBeUndefined()
    expect(result.errors[0]?.error).toContain('skillId')
  })

  it('rejects a tool-shaped entry placed in the skills array', () => {
    const result = validateInputsForBlock(
      'agent',
      { skills: [{ type: 'custom-tool', customToolId: 'ct_1' }] },
      'agent-1'
    )
    expect(result.validInputs.skills).toBeUndefined()
    expect(result.errors[0]?.error).toContain('skills')
  })

  it('rejects a non-array skills value', () => {
    const result = validateInputsForBlock('agent', { skills: {} }, 'agent-1')
    expect(result.validInputs.skills).toBeUndefined()
    expect(result.errors[0]?.error).toContain('expected an array')
  })
})

describe('collectUnresolvedAgentToolReferences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockValidateSelectorIds.mockResolvedValue({ valid: [], invalid: [] })
    mockGetCustomToolById.mockResolvedValue(null)
    mockGetSkillById.mockResolvedValue(null)
  })

  it('flags a custom tool whose customToolId does not resolve', async () => {
    mockGetCustomToolById.mockResolvedValue(null)
    const state = {
      blocks: {
        a1: {
          type: 'agent',
          name: 'Agent 1',
          subBlocks: { tools: { value: [{ type: 'custom-tool', customToolId: 'missing_ct' }] } },
        },
      },
    }
    const refs = await collectUnresolvedAgentToolReferences(state, CTX)
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({ blockId: 'a1', field: 'tools', kind: 'custom-tool' })
    expect(refs[0]?.reason).toContain('missing_ct')
  })

  it('does not DB-check an inline custom tool (it carries its own schema)', async () => {
    const state = {
      blocks: {
        a1: {
          type: 'agent',
          subBlocks: {
            tools: {
              value: [
                {
                  type: 'custom-tool',
                  customToolId: 'x',
                  schema: { type: 'function', function: { name: 'f', parameters: {} } },
                },
              ],
            },
          },
        },
      },
    }
    const refs = await collectUnresolvedAgentToolReferences(state, CTX)
    expect(refs).toHaveLength(0)
    expect(mockGetCustomToolById).not.toHaveBeenCalled()
  })

  it('does not flag a custom tool that resolves', async () => {
    mockGetCustomToolById.mockResolvedValue({ id: 'ct_ok' })
    const state = {
      blocks: {
        a1: {
          type: 'agent',
          subBlocks: { tools: { value: [{ type: 'custom-tool', customToolId: 'ct_ok' }] } },
        },
      },
    }
    const refs = await collectUnresolvedAgentToolReferences(state, CTX)
    expect(refs).toHaveLength(0)
  })

  it('does not DB-check a custom tool when workspaceId is absent (avoids false positives)', async () => {
    const state = {
      blocks: {
        a1: {
          type: 'agent',
          subBlocks: { tools: { value: [{ type: 'custom-tool', customToolId: 'ct_x' }] } },
        },
      },
    }
    const refs = await collectUnresolvedAgentToolReferences(state, { userId: 'user-1' })
    expect(refs).toHaveLength(0)
    expect(mockGetCustomToolById).not.toHaveBeenCalled()
  })

  it('flags an MCP tool whose server does not resolve', async () => {
    mockValidateSelectorIds.mockResolvedValue({ valid: [], invalid: ['srv_missing'] })
    const state = {
      blocks: {
        a1: {
          type: 'agent',
          subBlocks: {
            tools: { value: [{ type: 'mcp', params: { serverId: 'srv_missing', toolName: 'x' } }] },
          },
        },
      },
    }
    const refs = await collectUnresolvedAgentToolReferences(state, CTX)
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({ field: 'tools', kind: 'mcp-tool' })
    expect(mockValidateSelectorIds).toHaveBeenCalledWith('mcp-server-selector', 'srv_missing', CTX)
  })

  it('flags a skill whose skillId does not resolve', async () => {
    mockGetSkillById.mockResolvedValue(null)
    const state = {
      blocks: {
        a1: { type: 'agent', subBlocks: { skills: { value: [{ skillId: 'bogus-skill' }] } } },
      },
    }
    const refs = await collectUnresolvedAgentToolReferences(state, CTX)
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({ field: 'skills', kind: 'skill' })
    expect(refs[0]?.reason).toContain('bogus-skill')
  })

  it('does not flag a skill that resolves (builtin or workspace)', async () => {
    mockGetSkillById.mockResolvedValue({ id: 'builtin-deploy-workflow', name: 'deploy-workflow' })
    const state = {
      blocks: {
        a1: {
          type: 'agent',
          subBlocks: { skills: { value: [{ skillId: 'builtin-deploy-workflow' }] } },
        },
      },
    }
    const refs = await collectUnresolvedAgentToolReferences(state, CTX)
    expect(refs).toHaveLength(0)
  })

  it('ignores non-agent blocks', async () => {
    const state = {
      blocks: { s1: { type: 'slack', subBlocks: { tools: { value: [{ type: 'custom-tool' }] } } } },
    }
    const refs = await collectUnresolvedAgentToolReferences(state, CTX)
    expect(refs).toHaveLength(0)
    expect(mockGetCustomToolById).not.toHaveBeenCalled()
  })
})
