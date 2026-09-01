/**
 * @vitest-environment node
 */
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

vi.mock('@/providers/models', () => ({
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
} from '@/blocks/utils'
import { getProviderFromModel } from '@/providers/utils'

describe('BUILT_IN_TOOL_TYPES', () => {
  it('classifies the current File block instead of the legacy File block', () => {
    expect(BUILT_IN_TOOL_TYPES.has('file_v5')).toBe(true)
    expect(BUILT_IN_TOOL_TYPES.has('file')).toBe(false)
  })

  it('classifies the current Table block instead of the legacy Table block', () => {
    expect(BUILT_IN_TOOL_TYPES.has('table_v2')).toBe(true)
    expect(BUILT_IN_TOOL_TYPES.has('table')).toBe(false)
  })
})

const BASE_CLOUD_MODELS: Record<string, string> = {
  'gpt-4o': 'openai',
  'claude-sonnet-4-5': 'anthropic',
  'gemini-2.5-pro': 'google',
  'mistral-large-latest': 'mistral',
}

describe('getApiKeyCondition / shouldRequireApiKeyForModel', () => {
  const evaluateCondition = (model: string): boolean => {
    const conditionFn = getApiKeyCondition()
    const condition = conditionFn({ model })
    if ('not' in condition && condition.not) return false
    if (condition.value === '__no_model_selected__') return false
    return true
  }

  beforeEach(() => {
    vi.clearAllMocks()
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

  describe('empty or missing model', () => {
    it('does not require API key when model is empty', () => {
      expect(evaluateCondition('')).toBe(false)
    })

    it('does not require API key when model is whitespace', () => {
      expect(evaluateCondition('   ')).toBe(false)
    })
  })

  describe('hosted models', () => {
    it('does not require API key for hosted models on hosted platform', () => {
      setEnvFlags({ isHosted: true })
      mockGetHostedModels.mockReturnValue(['gpt-4o', 'claude-sonnet-4-5'])
      expect(evaluateCondition('gpt-4o')).toBe(false)
      expect(evaluateCondition('claude-sonnet-4-5')).toBe(false)
    })

    it('requires API key for non-hosted models on hosted platform', () => {
      setEnvFlags({ isHosted: true })
      mockGetHostedModels.mockReturnValue(['gpt-4o'])
      expect(evaluateCondition('claude-sonnet-4-5')).toBe(true)
    })
  })

  describe('Vertex AI models', () => {
    it('does not require API key for vertex/ prefixed models', () => {
      expect(evaluateCondition('vertex/gemini-2.5-pro')).toBe(false)
    })
  })

  describe('Bedrock models', () => {
    it('does not require API key for bedrock/ prefixed models', () => {
      expect(evaluateCondition('bedrock/anthropic.claude-v2')).toBe(false)
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

  describe('vLLM models', () => {
    it('does not require API key for vllm/ prefixed models', () => {
      expect(evaluateCondition('vllm/my-model')).toBe(false)
      expect(evaluateCondition('vllm/llama-3-70b')).toBe(false)
    })
  })

  describe('provider store lookup (client-side)', () => {
    it('does not require API key when model is in the Ollama store bucket', () => {
      mockProviders.value.ollama.models = ['llama3:latest', 'mistral:latest']
      expect(evaluateCondition('llama3:latest')).toBe(false)
      expect(evaluateCondition('mistral:latest')).toBe(false)
    })

    it('requires API key when model is in the base store bucket', () => {
      mockProviders.value.base.models = ['gpt-4o', 'claude-sonnet-4-5']
      expect(evaluateCondition('gpt-4o')).toBe(true)
      expect(evaluateCondition('claude-sonnet-4-5')).toBe(true)
    })

    it('does not require API key when model is in the vLLM store bucket', () => {
      mockProviders.value.vllm.models = ['my-custom-model']
      expect(evaluateCondition('my-custom-model')).toBe(false)
    })

    it('does not require API key when model is in the LiteLLM store bucket', () => {
      mockProviders.value.litellm.models = ['litellm/anthropic/claude-sonnet-4-6']
      expect(evaluateCondition('litellm/anthropic/claude-sonnet-4-6')).toBe(false)
    })

    it('requires API key when model is in the fireworks store bucket', () => {
      mockProviders.value.fireworks.models = ['fireworks/llama-3']
      expect(evaluateCondition('fireworks/llama-3')).toBe(true)
    })

    it('requires API key when model is in the openrouter store bucket', () => {
      mockProviders.value.openrouter.models = ['openrouter/anthropic/claude']
      expect(evaluateCondition('openrouter/anthropic/claude')).toBe(true)
    })

    it('is case-insensitive for store lookup', () => {
      mockProviders.value.ollama.models = ['Llama3:Latest']
      expect(evaluateCondition('llama3:latest')).toBe(false)
    })
  })

  describe('Ollama — OLLAMA_URL env var (server-safe)', () => {
    it('does not require API key for unknown models when OLLAMA_URL is set', () => {
      setEnvFlags({ isOllamaConfigured: true })
      expect(evaluateCondition('llama3:latest')).toBe(false)
      expect(evaluateCondition('phi3:latest')).toBe(false)
      expect(evaluateCondition('gemma2:latest')).toBe(false)
      expect(evaluateCondition('deepseek-coder:latest')).toBe(false)
    })

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

    it('requires API key for slash-prefixed cloud models when OLLAMA_URL is set', () => {
      setEnvFlags({ isOllamaConfigured: true })
      expect(evaluateCondition('azure/gpt-4o')).toBe(true)
      expect(evaluateCondition('fireworks/llama-3')).toBe(true)
      expect(evaluateCondition('openrouter/anthropic/claude')).toBe(true)
      expect(evaluateCondition('groq/llama-3')).toBe(true)
    })
  })

  describe('cloud provider models that need API key', () => {
    it('requires API key for standard cloud models on hosted platform', () => {
      setEnvFlags({ isHosted: true })
      mockGetHostedModels.mockReturnValue([])
      expect(evaluateCondition('gpt-4o')).toBe(true)
      expect(evaluateCondition('claude-sonnet-4-5')).toBe(true)
      expect(evaluateCondition('gemini-2.5-pro')).toBe(true)
      expect(evaluateCondition('mistral-large-latest')).toBe(true)
    })

    it('requires API key for prefixed cloud models on hosted platform', () => {
      setEnvFlags({ isHosted: true })
      expect(evaluateCondition('fireworks/llama-3')).toBe(true)
      expect(evaluateCondition('openrouter/anthropic/claude')).toBe(true)
      expect(evaluateCondition('groq/llama-3')).toBe(true)
      expect(evaluateCondition('cerebras/gpt-oss-120b')).toBe(true)
    })

    it('requires API key for prefixed cloud models on self-hosted', () => {
      setEnvFlags({ isHosted: false })
      expect(evaluateCondition('fireworks/llama-3')).toBe(true)
      expect(evaluateCondition('openrouter/anthropic/claude')).toBe(true)
      expect(evaluateCondition('groq/llama-3')).toBe(true)
      expect(evaluateCondition('cerebras/gpt-oss-120b')).toBe(true)
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
  it('returns undefined for empty values', () => {
    expect(parseOptionalJsonInput('', 'payload')).toBeUndefined()
    expect(parseOptionalJsonInput('   ', 'payload')).toBeUndefined()
    expect(parseOptionalJsonInput(undefined, 'payload')).toBeUndefined()
  })

  it('parses JSON strings', () => {
    expect(parseOptionalJsonInput('{"a":1}', 'payload')).toEqual({ a: 1 })
    expect(parseOptionalJsonInput('["a","b"]', 'payload')).toEqual(['a', 'b'])
  })

  it('returns non-string values as-is', () => {
    const value = { a: 1 }
    expect(parseOptionalJsonInput(value, 'payload')).toBe(value)
  })

  it('throws a helpful error for invalid JSON', () => {
    expect(() => parseOptionalJsonInput('{', 'payload')).toThrow(/Invalid JSON for payload/)
  })
})

describe('parseOptionalNumberInput', () => {
  it('returns undefined for empty values', () => {
    expect(parseOptionalNumberInput('', 'limit')).toBeUndefined()
    expect(parseOptionalNumberInput('   ', 'limit')).toBeUndefined()
    expect(parseOptionalNumberInput(undefined, 'limit')).toBeUndefined()
  })

  it('parses number strings and number values', () => {
    expect(parseOptionalNumberInput('42', 'limit')).toBe(42)
    expect(parseOptionalNumberInput(7, 'limit')).toBe(7)
  })

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

  it('throws a helpful error for invalid numbers', () => {
    expect(() => parseOptionalNumberInput('abc', 'limit')).toThrow(/Invalid number for limit/i)
  })
})

describe('parseOptionalBooleanInput', () => {
  it('returns undefined for empty values', () => {
    expect(parseOptionalBooleanInput('')).toBeUndefined()
    expect(parseOptionalBooleanInput('   ')).toBeUndefined()
    expect(parseOptionalBooleanInput(undefined)).toBeUndefined()
  })

  it('passes through boolean values', () => {
    expect(parseOptionalBooleanInput(true)).toBe(true)
    expect(parseOptionalBooleanInput(false)).toBe(false)
  })

  it('supports numeric boolean values', () => {
    expect(parseOptionalBooleanInput(1)).toBe(true)
    expect(parseOptionalBooleanInput(0)).toBe(false)
    expect(parseOptionalBooleanInput(5)).toBe(true)
  })

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

  it('honours a caller-supplied fallback model', () => {
    expect(getSerializedModelProviderId(undefined, 'claude-sonnet-5')).toBe('anthropic')
  })

  it('never throws when the resolver rejects the model', () => {
    expect(() => getSerializedModelProviderId('totally-unknown-model')).not.toThrow()
    expect(getSerializedModelProviderId('totally-unknown-model')).toBe('openai')
  })

  it('never throws when the resolver rejects every model, including the fallback', () => {
    resolver.mockImplementation((() => {
      throw new Error('Provider "openai" is not available')
    }) as unknown as typeof getProviderFromModel)

    expect(() => getSerializedModelProviderId('gpt-4o')).not.toThrow()
    expect(getSerializedModelProviderId('gpt-4o')).toBe('openai')
  })
})
