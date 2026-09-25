import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
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

vi.mock('@/providers/utils', () => ({
  isFunctionToolCall: (toolCall: unknown) =>
    typeof toolCall === 'object' &&
    toolCall !== null &&
    'function' in toolCall &&
    (toolCall as { function?: unknown }).function != null,
  getProviderFromModel: vi.fn(() => 'openai'),
}))

vi.mock('@/stores/providers/store', () => ({
  useProvidersStore: {
    getState: () => ({
      get providers() {
        return mockProviders.value
      },
    }),
  },
}))

vi.mock('@/lib/oauth/utils', () => ({
  getScopesForService: vi.fn(() => []),
}))

import {
  BUILT_IN_TOOL_TYPES,
  getApiKeyCondition,
  getSerializedModelProviderId,
  parseOptionalBooleanInput,
  parseOptionalJsonInput,
  parseOptionalNumberInput,
  requiresProviderFamilyCredentials,
} from '@/blocks/utils'
import { getProviderFromModel } from '@/providers/utils'

describe('BUILT_IN_TOOL_TYPES', () => {
  it('classifies the current File block instead of the legacy File block', () => {
    expect(BUILT_IN_TOOL_TYPES.has('file_v5')).toBe(true)
    expect(BUILT_IN_TOOL_TYPES.has('file')).toBe(false)
  })
})

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
