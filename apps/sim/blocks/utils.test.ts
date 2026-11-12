import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { oauthUtilsMock } from '@sim/testing/mocks/oauth-utils.mock'
import { providersUtilsMock } from '@sim/testing/mocks/providers-utils.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

afterAll(resetEnvFlagsMock)

const {
  mockGetHostedModels,
  mockGetProviderModels,
  mockGetProviderIcon,
  mockGetBaseModelProviders,
} = vi.hoisted(() => ({
  mockGetHostedModels: vi.fn(() => []),
  mockGetProviderModels: vi.fn(() => []),
  mockGetProviderIcon: vi.fn(() => null),
  mockGetBaseModelProviders: vi.fn(() => ({})),
}))

const { mockProviders } = vi.hoisted(() => ({
  mockProviders: {
    value: {
      base: { models: [] as string[], isLoading: false },
      ollama: { models: [] as string[], isLoading: false },
      vllm: { models: [] as string[], isLoading: false },
      litellm: { models: [] as string[], isLoading: false },
      openrouter: { models: [] as string[], isLoading: false },
      fireworks: { models: [] as string[], isLoading: false },
    },
  },
}))

vi.mock('@/providers/models', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/providers/models')>()),
  getProviderFileAttachment: vi
    .fn()
    .mockReturnValue({ maxBytes: 10 * 1024 * 1024, strategy: 'inline' }),
  INLINE_ATTACHMENT_MAX_BYTES: 10 * 1024 * 1024,
  getHostedModels: mockGetHostedModels,
  getProviderModels: mockGetProviderModels,
  getProviderIcon: mockGetProviderIcon,
  getBaseModelProviders: mockGetBaseModelProviders,
  SIM_AUTO_MODEL_ID: 'sim-auto',
  isAutoModel: (model: string) => model.trim().toLowerCase() === 'sim-auto',
}))

vi.mock('@/providers/utils', () => providersUtilsMock)

vi.mock('@/stores/providers/store', () => ({
  useProvidersStore: {
    getState: () => ({
      get providers() {
        return mockProviders.value
      },
    }),
  },
}))

vi.mock('@/lib/oauth/utils', () => oauthUtilsMock)

import { S3Icon } from '@/components/icons'
import { evaluateSubBlockCondition } from '@/lib/workflows/subblocks/visibility'
import type { BlockConfig } from '@/blocks/types'
import {
  getApiKeyCondition,
  getProviderCredentialSubBlocks,
  getSelectedBedrockCredential,
  getSerializedModelProviderId,
  parseOptionalBooleanInput,
  parseOptionalJsonInput,
  parseOptionalNumberInput,
  requiresProviderFamilyCredentials,
  withSavedCredential,
} from '@/blocks/utils'
import { getProviderFromModel } from '@/providers/utils'

const BASE_CLOUD_MODELS: Record<string, string> = {
  'gpt-4o': 'openai',
  'claude-sonnet-4-5': 'anthropic',
  'gemini-2.5-pro': 'google',
  'mistral-large-latest': 'mistral',
}

describe('requiresProviderFamilyCredentials', () => {
  beforeEach(() => {
    setEnvFlags({ isHosted: false, isAzureConfigured: false, isOllamaConfigured: false })
  })

  it('is true for Vertex, and for Bedrock until the deployment provides default credentials', () => {
    expect(requiresProviderFamilyCredentials('vertex/gemini-2.5-pro')).toBe(true)
    expect(requiresProviderFamilyCredentials('bedrock/my-inference-profile')).toBe(true)
    vi.stubEnv('NEXT_PUBLIC_BEDROCK_DEFAULT_CREDENTIALS', 'true')
    try {
      expect(requiresProviderFamilyCredentials('bedrock/my-inference-profile')).toBe(false)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('is true for Azure only until the deployment configures it server-side', () => {
    expect(requiresProviderFamilyCredentials('azure/my-deployment')).toBe(true)
    expect(requiresProviderFamilyCredentials('azure-anthropic/my-deployment')).toBe(true)
    setEnvFlags({ isAzureConfigured: true })
    expect(requiresProviderFamilyCredentials('azure/my-deployment')).toBe(false)
  })
})

describe('Bedrock credential fields', () => {
  const BEDROCK_FIELDS = [
    'bedrockAuthMode',
    'bedrockCredential',
    'bedrockManualCredential',
    'bedrockAccessKeyId',
    'bedrockSecretKey',
    'bedrockRegion',
  ]

  const visibleBedrockFields = (
    values: Record<string, unknown>,
    subBlocks = getProviderCredentialSubBlocks({ bedrockSavedCredential: true })
  ) =>
    subBlocks
      .filter((subBlock) => BEDROCK_FIELDS.includes(subBlock.id))
      .filter((subBlock) => evaluateSubBlockCondition(subBlock.condition, values))
      .map((subBlock) => subBlock.id)

  it('keeps showing access keys, and no credential picker, on a block saved before auth modes', () => {
    expect(visibleBedrockFields({ model: 'bedrock/my-inference-profile' })).toEqual([
      'bedrockAuthMode',
      'bedrockAccessKeyId',
      'bedrockSecretKey',
      'bedrockRegion',
    ])
  })

  it('swaps the access keys for the AWS credential picker when a saved credential is chosen', () => {
    expect(
      visibleBedrockFields({ model: 'bedrock/my-inference-profile', bedrockAuthMode: 'credential' })
    ).toEqual(['bedrockAuthMode', 'bedrockCredential', 'bedrockManualCredential', 'bedrockRegion'])
  })

  it('shows no Bedrock field for a model of another provider', () => {
    expect(visibleBedrockFields({ model: 'gpt-4o', bedrockAuthMode: 'credential' })).toEqual([])
  })

  it('offers no saved credential, and keeps the access keys, for a block that cannot forward one', () => {
    expect(
      visibleBedrockFields(
        { model: 'bedrock/my-inference-profile', bedrockAuthMode: 'credential' },
        getProviderCredentialSubBlocks()
      )
    ).toEqual(['bedrockAccessKeyId', 'bedrockSecretKey', 'bedrockRegion'])
  })
})

describe('getSelectedBedrockCredential', () => {
  it('returns the trimmed saved credential a block signs Bedrock calls with', () => {
    expect(
      getSelectedBedrockCredential({ bedrockAuthMode: 'credential', bedrockCredential: ' cred-1 ' })
    ).toBe('cred-1')
  })

  it('refuses a block set to a saved credential whose ID resolves blank', () => {
    expect(() =>
      getSelectedBedrockCredential({ bedrockAuthMode: 'credential', bedrockCredential: '' })
    ).toThrow('Select an AWS credential for Bedrock')
    expect(() => getSelectedBedrockCredential({ bedrockAuthMode: 'credential' })).toThrow(
      'Select an AWS credential for Bedrock'
    )
  })

  it('returns nothing for a block on access keys or saved before auth modes', () => {
    expect(
      getSelectedBedrockCredential({ bedrockAuthMode: 'access_keys', bedrockCredential: 'cred-1' })
    ).toBeUndefined()
    expect(getSelectedBedrockCredential({})).toBeUndefined()
  })

  it('signs with a credential exactly when the block shows and serializes the credential picker', () => {
    const picker = getProviderCredentialSubBlocks({ bedrockSavedCredential: true }).find(
      (subBlock) => subBlock.id === 'bedrockCredential'
    )
    const cases: Record<string, unknown>[] = [
      { bedrockCredential: 'cred-1' },
      { bedrockAuthMode: '', bedrockCredential: 'cred-1' },
      { bedrockAuthMode: 'access_keys', bedrockCredential: 'cred-1' },
      { bedrockAuthMode: 'credential', bedrockCredential: 'cred-1' },
    ]
    for (const values of cases) {
      const withModel = { model: 'bedrock/my-inference-profile', ...values }
      expect(getSelectedBedrockCredential(values) !== undefined, JSON.stringify(values)).toBe(
        evaluateSubBlockCondition(picker?.condition, withModel)
      )
    }
  })
})

describe('getApiKeyCondition / shouldRequireApiKeyForModel', () => {
  const evaluateCondition = (model: string): boolean => {
    const conditionFn = getApiKeyCondition()
    const condition = conditionFn({ model })
    if ('not' in condition && condition.not) return false
    if (condition.value === '__no_model_selected__') return false
    return true
  }

  beforeEach(() => {
    setEnvFlags({ isHosted: false, isAzureConfigured: false, isOllamaConfigured: false })
    mockProviders.value = {
      base: { models: [], isLoading: false },
      ollama: { models: [], isLoading: false },
      vllm: { models: [], isLoading: false },
      litellm: { models: [], isLoading: false },
      openrouter: { models: [], isLoading: false },
      fireworks: { models: [], isLoading: false },
    }
    mockGetHostedModels.mockReturnValue([])
    mockGetProviderModels.mockReturnValue([])
    mockGetBaseModelProviders.mockReturnValue({})
  })

  describe('hosted models', () => {
    it('requires API key for non-hosted models on hosted platform', () => {
      setEnvFlags({ isHosted: true })
      mockGetHostedModels.mockReturnValue(['gpt-4o'])
      expect(evaluateCondition('claude-sonnet-4-5')).toBe(true)
    })
  })

  describe('Azure models', () => {
    it('does not require API key for azure/ models when Azure is configured', () => {
      setEnvFlags({ isAzureConfigured: true })
      expect(evaluateCondition('azure/gpt-4o')).toBe(false)
      expect(evaluateCondition('azure-openai/gpt-4o')).toBe(false)
      expect(evaluateCondition('azure-anthropic/claude-sonnet-4-5')).toBe(false)
    })

    it('requires API key for azure/ models when Azure is not configured', () => {
      setEnvFlags({ isAzureConfigured: false })
      expect(evaluateCondition('azure/gpt-4o')).toBe(true)
    })
  })

  describe('provider store lookup (client-side)', () => {
    it('requires the cloud key even when a local discovered name uses its namespace', () => {
      mockProviders.value.ollama.models = ['azure/MyDeployment', 'ollama-cloud/MyModel']
      expect(evaluateCondition('azure/MyDeployment')).toBe(true)
      expect(evaluateCondition('ollama-cloud/MyModel')).toBe(true)
    })

    it('does not require an API key for an undiscovered namespaced Ollama model', () => {
      expect(evaluateCondition('OLLAMA/Org/CustomModel')).toBe(false)
    })
  })

  describe('Ollama — OLLAMA_URL env var (server-safe)', () => {
    it('does not require API key for Ollama models that match cloud provider regex patterns', () => {
      setEnvFlags({ isOllamaConfigured: true })
      expect(evaluateCondition('mistral:latest')).toBe(false)
      expect(evaluateCondition('mistral')).toBe(false)
      expect(evaluateCondition('mistral-nemo')).toBe(false)
      expect(evaluateCondition('gpt2')).toBe(false)
    })

    it('requires API key for known cloud models even when OLLAMA_URL is set', () => {
      setEnvFlags({ isOllamaConfigured: true })
      mockGetBaseModelProviders.mockReturnValue(BASE_CLOUD_MODELS)
      expect(evaluateCondition('gpt-4o')).toBe(true)
      expect(evaluateCondition('claude-sonnet-4-5')).toBe(true)
      expect(evaluateCondition('gemini-2.5-pro')).toBe(true)
      expect(evaluateCondition('mistral-large-latest')).toBe(true)
    })
  })

  describe('self-hosted without OLLAMA_URL', () => {
    it('requires API key for any model (Ollama models cannot appear without OLLAMA_URL)', () => {
      setEnvFlags({ isHosted: false, isOllamaConfigured: false })
      expect(evaluateCondition('llama3:latest')).toBe(true)
      expect(evaluateCondition('mistral:latest')).toBe(true)
      expect(evaluateCondition('gpt-4o')).toBe(true)
    })
  })
})

describe('parseOptionalJsonInput', () => {
  it('throws a helpful error for invalid JSON', () => {
    expect(() => parseOptionalJsonInput('{', 'payload')).toThrow(/Invalid JSON for payload/)
  })
})

describe('parseOptionalNumberInput', () => {
  it('validates integer-only values', () => {
    expect(parseOptionalNumberInput('42', 'limit', { integer: true })).toBe(42)
    expect(() => parseOptionalNumberInput('1.5', 'limit', { integer: true })).toThrow(
      /expected an integer/i
    )
  })

  it('validates min and max bounds', () => {
    expect(parseOptionalNumberInput('10', 'limit', { min: 1, max: 20 })).toBe(10)
    expect(() => parseOptionalNumberInput('0', 'limit', { min: 1 })).toThrow(
      /limit must be at least 1/i
    )
    expect(() => parseOptionalNumberInput('21', 'limit', { max: 20 })).toThrow(
      /limit must be at most 20/i
    )
  })
})

describe('parseOptionalBooleanInput', () => {
  it('supports trimmed and case-insensitive string values', () => {
    expect(parseOptionalBooleanInput('true')).toBe(true)
    expect(parseOptionalBooleanInput(' TRUE ')).toBe(true)
    expect(parseOptionalBooleanInput('1')).toBe(true)
    expect(parseOptionalBooleanInput('false')).toBe(false)
    expect(parseOptionalBooleanInput(' False ')).toBe(false)
    expect(parseOptionalBooleanInput('0')).toBe(false)
  })

  it('returns undefined for unrecognized string values', () => {
    expect(parseOptionalBooleanInput('yes')).toBeUndefined()
    expect(parseOptionalBooleanInput('no')).toBeUndefined()
  })
})

describe('getSerializedModelProviderId', () => {
  const resolver = vi.mocked(getProviderFromModel)

  beforeEach(() => {
    resolver.mockReset()
    resolver.mockImplementation(((model: string) => {
      if (model.startsWith('openrouter/')) return 'openrouter'
      if (model === 'gpt-4o') return 'openai'
      if (model === 'claude-sonnet-5') return 'anthropic'
      throw new Error(`No provider found for model: ${model}`)
    }) as unknown as typeof getProviderFromModel)
  })

  it('resolves a gateway model that the base model map deliberately omits', () => {
    expect(getSerializedModelProviderId('openrouter/meta-llama/llama-4-maverick')).toBe(
      'openrouter'
    )
  })

  it('uses the fallback model when the model is still an unresolved reference', () => {
    expect(getSerializedModelProviderId('openrouter/<variable.vllm>')).toBe('openai')
    expect(resolver).not.toHaveBeenCalledWith('openrouter/<variable.vllm>')
  })

  it('never throws when the resolver rejects the model', () => {
    expect(() => getSerializedModelProviderId('totally-unknown-model')).not.toThrow()
    expect(getSerializedModelProviderId('totally-unknown-model')).toBe('openai')
  })
})

describe('withSavedCredential', () => {
  const picker = {
    id: 'credential',
    type: 'oauth-input',
    serviceId: 'aws',
    title: 'AWS Credential',
  } as const
  const legacy: BlockConfig = {
    type: 'example',
    name: 'Example',
    description: '',
    category: 'tools',
    bgColor: '#000',
    icon: S3Icon,
    subBlocks: [
      { id: 'operation', title: 'Operation', type: 'dropdown', options: [] },
      { id: 'accessKeyId', title: 'Access Key ID', type: 'short-input', required: true },
      { id: 'secretAccessKey', title: 'Secret', type: 'short-input', required: true },
      { id: 'accessKeyId', title: 'Webhook key', type: 'short-input', mode: 'trigger' },
      {
        id: 'triggerPicker',
        title: 'Trigger picker',
        type: 'short-input',
        mode: 'trigger',
        dependsOn: ['accessKeyId'],
      },
    ],
    tools: { access: [] },
    inputs: { accessKeyId: { type: 'string' }, secretAccessKey: { type: 'string' } },
    outputs: {},
  }

  it('places the picker right under the operation picker, ahead of the other fields', () => {
    const { subBlocks } = withSavedCredential(
      {
        ...legacy,
        subBlocks: [
          { id: 'operation', title: 'Operation', type: 'dropdown', options: [] },
          { id: 'bucket', title: 'Bucket', type: 'short-input' },
          { id: 'accessKeyId', title: 'Access Key ID', type: 'short-input', required: true },
          { id: 'secretAccessKey', title: 'Secret', type: 'short-input', required: true },
        ],
      },
      picker
    )

    expect(subBlocks.map((subBlock) => subBlock.id)).toEqual([
      'operation',
      'credential',
      'manualCredential',
      'bucket',
    ])
  })

  it('keeps the picker where the secret was when the block has no operation picker', () => {
    const { subBlocks } = withSavedCredential(
      {
        ...legacy,
        subBlocks: [
          { id: 'region', title: 'Region', type: 'short-input' },
          { id: 'accessKeyId', title: 'Access Key ID', type: 'short-input', required: true },
          { id: 'secretAccessKey', title: 'Secret', type: 'short-input', required: true },
          { id: 'bucket', title: 'Bucket', type: 'short-input' },
        ],
      },
      picker
    )

    expect(subBlocks.map((subBlock) => subBlock.id)).toEqual([
      'region',
      'credential',
      'manualCredential',
      'bucket',
    ])
  })

  it('keeps trigger fields that share a replaced secret id, untouched', () => {
    const { subBlocks } = withSavedCredential(legacy, picker)
    const triggerFields = legacy.subBlocks.filter((subBlock) => subBlock.mode === 'trigger')

    for (const field of triggerFields) expect(subBlocks).toContain(field)
    expect(
      subBlocks.filter((subBlock) => subBlock.mode !== 'trigger').map((subBlock) => subBlock.id)
    ).toEqual(['operation', 'credential', 'manualCredential'])
  })

  it('refuses a selector that authenticates with a replaced secret but has no twin', () => {
    const withSelector: BlockConfig = {
      ...legacy,
      subBlocks: [
        ...legacy.subBlocks,
        {
          id: 'logGroup',
          title: 'Log group',
          type: 'file-selector',
          selectorKey: 'cloudwatch.logGroups',
          dependsOn: ['accessKeyId'],
        },
      ],
    }

    expect(() => withSavedCredential(withSelector, picker)).toThrow(/saved-credential twin/)
  })

  it('points fields that depended on a secret at the credential, keeping their other dependencies', () => {
    const withDependents: BlockConfig = {
      ...legacy,
      subBlocks: [
        ...legacy.subBlocks,
        { id: 'region', title: 'Region', type: 'short-input' },
        {
          id: 'logGroup',
          title: 'Log group',
          type: 'file-selector',
          selectorKey: 'cloudwatch.logGroups',
          dependsOn: ['accessKeyId', 'secretAccessKey', 'region'],
        },
        {
          id: 'bucket',
          title: 'Bucket',
          type: 'short-input',
          dependsOn: { all: ['secretAccessKey'], any: ['region'] },
        },
      ],
    }

    const { subBlocks } = withSavedCredential(withDependents, picker, {
      selectorKeys: { 'cloudwatch.logGroups': 'cloudwatch.savedLogGroups' },
    })
    const byId = new Map(subBlocks.map((subBlock) => [subBlock.id, subBlock]))

    expect(byId.get('logGroup')).toMatchObject({
      selectorKey: 'cloudwatch.savedLogGroups',
      dependsOn: ['credential', 'region'],
    })
    expect(byId.get('bucket')?.dependsOn).toEqual({ all: ['credential'], any: ['region'] })
  })

  it('shows and requires the picker exactly where the replaced secret was', () => {
    const conditional: BlockConfig = {
      ...legacy,
      subBlocks: legacy.subBlocks.map((subBlock) =>
        ['accessKeyId', 'secretAccessKey'].includes(subBlock.id) && subBlock.mode !== 'trigger'
          ? {
              ...subBlock,
              condition: { field: 'operation', value: 'unsigned', not: true },
              required: { field: 'operation', value: 'unsigned', not: true },
            }
          : subBlock
      ),
    }

    const { subBlocks } = withSavedCredential(conditional, picker)
    const credential = subBlocks.find((subBlock) => subBlock.id === 'credential')

    expect(credential?.condition).toEqual({ field: 'operation', value: 'unsigned', not: true })
    expect(credential?.required).toEqual({ field: 'operation', value: 'unsigned', not: true })
  })

  it('refuses replaced secrets that show or require differently', () => {
    const mismatched: BlockConfig = {
      ...legacy,
      subBlocks: legacy.subBlocks.map((subBlock) =>
        subBlock.id === 'secretAccessKey' ? { ...subBlock, required: false } : subBlock
      ),
    }

    expect(() => withSavedCredential(mismatched, picker)).toThrow(/show or require differently/)
  })

  it('accepts replaced fields that differ only in what the successor states itself', () => {
    const optionalHost: BlockConfig = {
      ...legacy,
      subBlocks: legacy.subBlocks.map((subBlock) =>
        subBlock.id === 'secretAccessKey' ? { ...subBlock, required: false } : subBlock
      ),
    }

    const { subBlocks } = withSavedCredential(optionalHost, picker, { required: true })

    expect(subBlocks.find((subBlock) => subBlock.id === 'credential')?.required).toBe(true)
  })

  it('shows the picker in every operation when the successor says so, over secrets shown differently', () => {
    const partlyConditional: BlockConfig = {
      ...legacy,
      subBlocks: legacy.subBlocks.map((subBlock) =>
        subBlock.id === 'accessKeyId' && subBlock.mode !== 'trigger'
          ? { ...subBlock, condition: { field: 'operation', value: 'read' } }
          : subBlock
      ),
    }

    expect(() => withSavedCredential(partlyConditional, picker)).toThrow(
      /show or require differently/
    )
    const { subBlocks } = withSavedCredential(partlyConditional, picker, { condition: null })
    const credential = subBlocks.find((subBlock) => subBlock.id === 'credential')

    expect(credential).not.toHaveProperty('condition')
    expect(credential?.required).toBe(true)
  })

  it('refuses options that would silently do nothing', () => {
    expect(() =>
      withSavedCredential(legacy, picker, {
        selectorKeys: { 'cloudwatch.logGroups': 'cloudwatch.savedLogGroups' },
      })
    ).toThrow(/unused selector twins/)
    expect(() => withSavedCredential(legacy, picker, { params: () => ({}) })).toThrow(
      /no tool params builder/
    )
  })
})
