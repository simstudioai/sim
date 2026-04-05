/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsHosted, mockIsAzureConfigured, mockIsOllamaConfigured } = vi.hoisted(() => ({
  mockIsHosted: { value: false },
  mockIsAzureConfigured: { value: false },
  mockIsOllamaConfigured: { value: false },
}))

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
      openrouter: { models: [] as string[], isLoading: false },
      fireworks: { models: [] as string[], isLoading: false },
    },
  },
}))

vi.mock('@/lib/core/config/feature-flags', () => ({
  get isHosted() {
    return mockIsHosted.value
  },
  get isAzureConfigured() {
    return mockIsAzureConfigured.value
  },
  get isOllamaConfigured() {
    return mockIsOllamaConfigured.value
  },
}))

vi.mock('@/providers/models', () => ({
  getHostedModels: mockGetHostedModels,
  getProviderModels: mockGetProviderModels,
  getProviderIcon: mockGetProviderIcon,
  getBaseModelProviders: mockGetBaseModelProviders,
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

import { getApiKeyCondition } from '@/blocks/utils'

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
    mockIsHosted.value = false
    mockIsAzureConfigured.value = false
    mockIsOllamaConfigured.value = false
    mockProviders.value = {
      base: { models: [], isLoading: false },
      ollama: { models: [], isLoading: false },
      vllm: { models: [], isLoading: false },
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
      mockIsHosted.value = true
      mockGetHostedModels.mockReturnValue(['gpt-4o', 'claude-sonnet-4-5'])
      expect(evaluateCondition('gpt-4o')).toBe(false)
      expect(evaluateCondition('claude-sonnet-4-5')).toBe(false)
    })

    it('requires API key for non-hosted models on hosted platform', () => {
      mockIsHosted.value = true
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
      mockIsAzureConfigured.value = true
      expect(evaluateCondition('azure/gpt-4o')).toBe(false)
      expect(evaluateCondition('azure-openai/gpt-4o')).toBe(false)
      expect(evaluateCondition('azure-anthropic/claude-sonnet-4-5')).toBe(false)
    })

    it('requires API key for azure/ models when Azure is not configured', () => {
      mockIsAzureConfigured.value = false
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
      mockIsOllamaConfigured.value = true
      expect(evaluateCondition('llama3:latest')).toBe(false)
      expect(evaluateCondition('phi3:latest')).toBe(false)
      expect(evaluateCondition('gemma2:latest')).toBe(false)
      expect(evaluateCondition('deepseek-coder:latest')).toBe(false)
    })

    it('does not require API key for Ollama models that match cloud provider regex patterns', () => {
      mockIsOllamaConfigured.value = true
      expect(evaluateCondition('mistral:latest')).toBe(false)
      expect(evaluateCondition('mistral')).toBe(false)
      expect(evaluateCondition('mistral-nemo')).toBe(false)
      expect(evaluateCondition('gpt2')).toBe(false)
    })

    it('requires API key for known cloud models even when OLLAMA_URL is set', () => {
      mockIsOllamaConfigured.value = true
      mockGetBaseModelProviders.mockReturnValue(BASE_CLOUD_MODELS)
      expect(evaluateCondition('gpt-4o')).toBe(true)
      expect(evaluateCondition('claude-sonnet-4-5')).toBe(true)
      expect(evaluateCondition('gemini-2.5-pro')).toBe(true)
      expect(evaluateCondition('mistral-large-latest')).toBe(true)
    })

    it('requires API key for slash-prefixed cloud models when OLLAMA_URL is set', () => {
      mockIsOllamaConfigured.value = true
      expect(evaluateCondition('azure/gpt-4o')).toBe(true)
      expect(evaluateCondition('fireworks/llama-3')).toBe(true)
      expect(evaluateCondition('openrouter/anthropic/claude')).toBe(true)
      expect(evaluateCondition('groq/llama-3')).toBe(true)
    })
  })

  describe('cloud provider models that need API key', () => {
    it('requires API key for standard cloud models on hosted platform', () => {
      mockIsHosted.value = true
      mockGetHostedModels.mockReturnValue([])
      expect(evaluateCondition('gpt-4o')).toBe(true)
      expect(evaluateCondition('claude-sonnet-4-5')).toBe(true)
      expect(evaluateCondition('gemini-2.5-pro')).toBe(true)
      expect(evaluateCondition('mistral-large-latest')).toBe(true)
    })

    it('requires API key for prefixed cloud models on hosted platform', () => {
      mockIsHosted.value = true
      expect(evaluateCondition('fireworks/llama-3')).toBe(true)
      expect(evaluateCondition('openrouter/anthropic/claude')).toBe(true)
      expect(evaluateCondition('groq/llama-3')).toBe(true)
      expect(evaluateCondition('cerebras/gpt-oss-120b')).toBe(true)
    })

    it('requires API key for prefixed cloud models on self-hosted', () => {
      mockIsHosted.value = false
      expect(evaluateCondition('fireworks/llama-3')).toBe(true)
      expect(evaluateCondition('openrouter/anthropic/claude')).toBe(true)
      expect(evaluateCondition('groq/llama-3')).toBe(true)
      expect(evaluateCondition('cerebras/gpt-oss-120b')).toBe(true)
    })
  })

  describe('self-hosted without OLLAMA_URL', () => {
    it('requires API key for any model (Ollama models cannot appear without OLLAMA_URL)', () => {
      mockIsHosted.value = false
      mockIsOllamaConfigured.value = false
      expect(evaluateCondition('llama3:latest')).toBe(true)
      expect(evaluateCondition('mistral:latest')).toBe(true)
      expect(evaluateCondition('gpt-4o')).toBe(true)
    })
  })
})
