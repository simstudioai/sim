import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const workflowMetadataMocks = vi.hoisted(() => ({
  readWorkflowInputFieldsForTool: vi.fn(),
  readWorkflowMetadataForTool: vi.fn(),
}))

vi.mock('@/lib/internal/workflows/read-tool-enrichment', () => ({
  readWorkflowInputFieldsForTool: workflowMetadataMocks.readWorkflowInputFieldsForTool,
  readWorkflowMetadataForTool: workflowMetadataMocks.readWorkflowMetadataForTool,
}))

import { assignProviderToolIdentities } from '@/providers/tool-identity'
import type { ProviderToolConfig } from '@/providers/types'
import {
  calculateCost,
  describeModelLevel,
  extractAndParseJSON,
  filterBlacklistedModels,
  findProviderFromModel,
  formatCost,
  generateStructuredOutputInstructions,
  getAllModelProviders,
  getAllModels,
  getAllProviderIds,
  getApiKey,
  getBaseModelProviders,
  getHostedModels,
  getMaxOutputTokensForModel,
  getMaxTemperature,
  getModelPricing,
  getProvider,
  getProviderConfigFromModel,
  getProviderFromModel,
  getProviderModels,
  getReasoningEffortValuesForModel,
  getThinkingLevelsForModel,
  getVerbosityValuesForModel,
  isProviderBlacklisted,
  MODELS_TEMP_RANGE_0_1,
  MODELS_TEMP_RANGE_0_2,
  MODELS_TEMP_RANGE_0_15,
  MODELS_WITH_REASONING_EFFORT,
  MODELS_WITH_TEMPERATURE_SUPPORT,
  MODELS_WITH_THINKING,
  MODELS_WITH_VERBOSITY,
  PROVIDERS_WITH_TOOL_USAGE_CONTROL,
  prepareToolExecution,
  prepareToolsWithUsageControl,
  shouldBillModelUsage,
  supportsReasoningEffort,
  supportsTemperature,
  supportsThinking,
  supportsToolUsageControl,
  supportsVerbosity,
  transformBlockTool,
  updateOllamaProviderModels,
} from '@/providers/utils'

const mockGetRotatingApiKey = vi.fn().mockReturnValue('rotating-server-key')
const originalRequire = module.require

afterAll(resetEnvFlagsMock)

describe('getApiKey', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()

    setEnvFlags({ isHosted: false })

    module.require = vi.fn(() => ({
      getRotatingApiKey: mockGetRotatingApiKey,
    }))
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    module.require = originalRequire
  })

  it('should return user-provided key when not in hosted environment', () => {
    setEnvFlags({ isHosted: false })

    const key1 = getApiKey('openai', 'gpt-4', 'user-key-openai')
    expect(key1).toBe('user-key-openai')

    const key2 = getApiKey('anthropic', 'claude-3', 'user-key-anthropic')
    expect(key2).toBe('user-key-anthropic')

    const key3 = getApiKey('google', 'gemini-2.5-flash', 'user-key-google')
    expect(key3).toBe('user-key-google')
  })

  it('should throw error if no key provided in non-hosted environment', () => {
    setEnvFlags({ isHosted: false })

    expect(() => getApiKey('openai', 'gpt-4')).toThrow('API key is required for openai gpt-4')
    expect(() => getApiKey('anthropic', 'claude-3')).toThrow(
      'API key is required for anthropic claude-3'
    )
  })

  it('should fall back to user key in hosted environment if rotation fails', () => {
    setEnvFlags({ isHosted: true })

    module.require = vi.fn(() => {
      throw new Error('Rotation failed')
    })

    const key = getApiKey('openai', 'gpt-4o', 'user-fallback-key')
    expect(key).toBe('user-fallback-key')
  })

  it('should throw error in hosted environment if rotation fails and no user key', () => {
    setEnvFlags({ isHosted: true })

    module.require = vi.fn(() => {
      throw new Error('Rotation failed')
    })

    expect(() => getApiKey('openai', 'gpt-4o')).toThrow('No API key available for openai gpt-4o')
  })

  it('should require user key for non-OpenAI/Anthropic providers even in hosted environment', () => {
    setEnvFlags({ isHosted: true })

    const key = getApiKey('other-provider', 'some-model', 'user-key')
    expect(key).toBe('user-key')

    expect(() => getApiKey('other-provider', 'some-model')).toThrow(
      'API key is required for other-provider some-model'
    )
  })

  it('should require user key for models NOT in hosted list even if provider matches', () => {
    setEnvFlags({ isHosted: true })

    const key1 = getApiKey('anthropic', 'claude-sonnet-4-20250514', 'user-key-anthropic')
    expect(key1).toBe('user-key-anthropic')

    expect(() => getApiKey('anthropic', 'claude-sonnet-4-20250514')).toThrow(
      'API key is required for anthropic claude-sonnet-4-20250514'
    )

    const key2 = getApiKey('openai', 'gpt-4o-2024-08-06', 'user-key-openai')
    expect(key2).toBe('user-key-openai')

    expect(() => getApiKey('openai', 'gpt-4o-2024-08-06')).toThrow(
      'API key is required for openai gpt-4o-2024-08-06'
    )
  })

  it('should return empty for ollama provider without requiring API key', () => {
    setEnvFlags({ isHosted: false })

    const key = getApiKey('ollama', 'llama2')
    expect(key).toBe('empty')

    const key2 = getApiKey('ollama', 'codellama', 'user-key')
    expect(key2).toBe('empty')
  })

  it('should return empty or user-provided key for vllm provider without requiring API key', () => {
    setEnvFlags({ isHosted: false })

    const key = getApiKey('vllm', 'vllm/qwen-3')
    expect(key).toBe('empty')

    const key2 = getApiKey('vllm', 'vllm/llama', 'user-key')
    expect(key2).toBe('user-key')
  })

  it('should return empty or user-provided key for litellm provider without requiring API key', () => {
    setEnvFlags({ isHosted: false })

    const key = getApiKey('litellm', 'litellm/anthropic/claude-sonnet-4-6')
    expect(key).toBe('empty')

    const key2 = getApiKey('litellm', 'litellm/openai/gpt-4', 'user-key')
    expect(key2).toBe('user-key')
  })
})

describe('Model Capabilities', () => {
  describe('supportsTemperature', () => {
    it('should return true for models that support temperature', () => {
      const supportedModels = [
        'gpt-4o',
        'gpt-4.1',
        'gpt-4.1-mini',
        'gpt-4.1-nano',
        'gpt-5-chat-latest',
        'azure/gpt-5-chat',
        'gemini-2.5-flash',
        'claude-sonnet-4-5',
        'claude-opus-4-1',
        'grok-3-latest',
        'grok-3-fast-latest',
        'deepseek-v3',
        'deepseek-chat',
        'groq/meta-llama/llama-4-scout-17b-16e-instruct',
        'mistral-large-latest',
      ]

      for (const model of supportedModels) {
        expect(supportsTemperature(model)).toBe(true)
      }
    })

    it('should return false for models that do not support temperature', () => {
      const unsupportedModels = [
        'unsupported-model',
        'claude-sonnet-5',
        'cerebras/llama-3.3-70b',
        'o1',
        'o3',
        'o4-mini',
        'azure/o3',
        'azure/o4-mini',
        'deepseek-r1',
        'azure/model-router',
        'gpt-5.1',
        'azure/gpt-5.1',
        'azure/gpt-5.1-mini',
        'azure/gpt-5.1-nano',
        'azure/gpt-5.1-codex',
        'gpt-5',
        'gpt-5-mini',
        'gpt-5-nano',
        'azure/gpt-5',
        'azure/gpt-5-mini',
        'azure/gpt-5-nano',
      ]

      for (const model of unsupportedModels) {
        expect(supportsTemperature(model)).toBe(false)
      }
    })

    it('should be case insensitive', () => {
      expect(supportsTemperature('GPT-4O')).toBe(true)
      expect(supportsTemperature('claude-sonnet-4-5')).toBe(true)
    })

    it('should inherit temperature support from provider for dynamically fetched models', () => {
      expect(supportsTemperature('openrouter/anthropic/claude-3.5-sonnet')).toBe(true)
      expect(supportsTemperature('openrouter/openai/gpt-4')).toBe(true)
    })
  })

  describe('getMaxTemperature', () => {
    it('should return 2 for models with temperature range 0-2', () => {
      const modelsRange02 = [
        'gpt-4o',
        'azure/gpt-4o',
        'gpt-5-chat-latest',
        'azure/gpt-5-chat',
        'gemini-2.5-pro',
        'gemini-2.5-flash',
        'deepseek-v3',
        'deepseek-chat',
        'grok-3-latest',
        'grok-3-fast-latest',
        'groq/meta-llama/llama-4-scout-17b-16e-instruct',
      ]

      for (const model of modelsRange02) {
        expect(getMaxTemperature(model)).toBe(2)
      }
    })

    it('should return 1 for models with temperature range 0-1', () => {
      const modelsRange01 = ['claude-sonnet-4-5', 'claude-opus-4-1']

      for (const model of modelsRange01) {
        expect(getMaxTemperature(model)).toBe(1)
      }
    })

    it('should return 1.5 for models with temperature range 0-1.5', () => {
      const modelsRange015 = ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest']

      for (const model of modelsRange015) {
        expect(getMaxTemperature(model)).toBe(1.5)
      }
    })

    it('should return undefined for models that do not support temperature', () => {
      expect(getMaxTemperature('unsupported-model')).toBeUndefined()
      expect(getMaxTemperature('cerebras/llama-3.3-70b')).toBeUndefined()
      expect(getMaxTemperature('o1')).toBeUndefined()
      expect(getMaxTemperature('o3')).toBeUndefined()
      expect(getMaxTemperature('o4-mini')).toBeUndefined()
      expect(getMaxTemperature('azure/o3')).toBeUndefined()
      expect(getMaxTemperature('azure/o4-mini')).toBeUndefined()
      expect(getMaxTemperature('deepseek-r1')).toBeUndefined()
      expect(getMaxTemperature('gpt-5.1')).toBeUndefined()
      expect(getMaxTemperature('azure/gpt-5.1')).toBeUndefined()
      expect(getMaxTemperature('azure/gpt-5.1-mini')).toBeUndefined()
      expect(getMaxTemperature('azure/gpt-5.1-nano')).toBeUndefined()
      expect(getMaxTemperature('azure/gpt-5.1-codex')).toBeUndefined()
      expect(getMaxTemperature('gpt-5')).toBeUndefined()
      expect(getMaxTemperature('gpt-5-mini')).toBeUndefined()
      expect(getMaxTemperature('gpt-5-nano')).toBeUndefined()
      expect(getMaxTemperature('azure/gpt-5')).toBeUndefined()
      expect(getMaxTemperature('azure/gpt-5-mini')).toBeUndefined()
      expect(getMaxTemperature('azure/gpt-5-nano')).toBeUndefined()
    })

    it('should be case insensitive', () => {
      expect(getMaxTemperature('GPT-4O')).toBe(2)
      expect(getMaxTemperature('CLAUDE-SONNET-4-5')).toBe(1)
    })

    it('should inherit max temperature from provider for dynamically fetched models', () => {
      expect(getMaxTemperature('openrouter/anthropic/claude-3.5-sonnet')).toBe(2)
      expect(getMaxTemperature('openrouter/openai/gpt-4')).toBe(2)
    })
  })

  describe('supportsToolUsageControl', () => {
    it('should return true for providers that support tool usage control', () => {
      const supportedProviders = [
        'openai',
        'azure-openai',
        'mistral',
        'anthropic',
        'deepseek',
        'xai',
        'google',
      ]

      for (const provider of supportedProviders) {
        expect(supportsToolUsageControl(provider)).toBe(true)
      }
    })

    it('should return false for providers that do not support tool usage control', () => {
      const unsupportedProviders = ['ollama', 'non-existent-provider']

      for (const provider of unsupportedProviders) {
        expect(supportsToolUsageControl(provider)).toBe(false)
      }
    })
  })

  describe('supportsReasoningEffort', () => {
    it('should return true for models with reasoning effort capability', () => {
      expect(supportsReasoningEffort('gpt-5')).toBe(true)
      expect(supportsReasoningEffort('gpt-5-mini')).toBe(true)
      expect(supportsReasoningEffort('gpt-5.1')).toBe(true)
      expect(supportsReasoningEffort('gpt-5.2')).toBe(true)
      expect(supportsReasoningEffort('o3')).toBe(true)
      expect(supportsReasoningEffort('o4-mini')).toBe(true)
      expect(supportsReasoningEffort('azure/gpt-5')).toBe(true)
      expect(supportsReasoningEffort('azure/o3')).toBe(true)
      expect(supportsReasoningEffort('groq/openai/gpt-oss-120b')).toBe(true)
      expect(supportsReasoningEffort('groq/openai/gpt-oss-20b')).toBe(true)
    })

    it('should return false for models without reasoning effort capability', () => {
      expect(supportsReasoningEffort('gpt-4o')).toBe(false)
      expect(supportsReasoningEffort('gpt-4.1')).toBe(false)
      expect(supportsReasoningEffort('claude-sonnet-4-5')).toBe(false)
      expect(supportsReasoningEffort('claude-opus-4-6')).toBe(false)
      expect(supportsReasoningEffort('gemini-2.5-flash')).toBe(false)
      expect(supportsReasoningEffort('unknown-model')).toBe(false)
    })

    it('should be case-insensitive', () => {
      expect(supportsReasoningEffort('GPT-5')).toBe(true)
      expect(supportsReasoningEffort('O3')).toBe(true)
      expect(supportsReasoningEffort('GPT-4O')).toBe(false)
    })
  })

  describe('supportsVerbosity', () => {
    it('should return true for models with verbosity capability', () => {
      expect(supportsVerbosity('gpt-5')).toBe(true)
      expect(supportsVerbosity('gpt-5-mini')).toBe(true)
      expect(supportsVerbosity('gpt-5.1')).toBe(true)
      expect(supportsVerbosity('gpt-5.2')).toBe(true)
      expect(supportsVerbosity('azure/gpt-5')).toBe(true)
    })

    it('should return false for models without verbosity capability', () => {
      expect(supportsVerbosity('gpt-4o')).toBe(false)
      expect(supportsVerbosity('o3')).toBe(false)
      expect(supportsVerbosity('o4-mini')).toBe(false)
      expect(supportsVerbosity('claude-sonnet-4-5')).toBe(false)
      expect(supportsVerbosity('unknown-model')).toBe(false)
    })

    it('should be case-insensitive', () => {
      expect(supportsVerbosity('GPT-5')).toBe(true)
      expect(supportsVerbosity('GPT-4O')).toBe(false)
    })
  })

  describe('supportsThinking', () => {
    it('should return true for models with thinking capability', () => {
      expect(supportsThinking('claude-opus-4-6')).toBe(true)
      expect(supportsThinking('claude-opus-4-5')).toBe(true)
      expect(supportsThinking('claude-sonnet-4-5')).toBe(true)
      expect(supportsThinking('claude-sonnet-4-5')).toBe(true)
      expect(supportsThinking('claude-haiku-4-5')).toBe(true)
      expect(supportsThinking('gemini-3-flash-preview')).toBe(true)
      expect(supportsThinking('deepseek-v4-flash')).toBe(true)
      expect(supportsThinking('deepseek-reasoner')).toBe(true)
      expect(supportsThinking('groq/qwen/qwen3.6-27b')).toBe(true)
    })

    it('should return false for models without thinking capability', () => {
      expect(supportsThinking('gpt-4o')).toBe(false)
      expect(supportsThinking('gpt-5')).toBe(false)
      expect(supportsThinking('o3')).toBe(false)
      expect(supportsThinking('deepseek-chat')).toBe(false)
      expect(supportsThinking('deepseek-v3')).toBe(false)
      expect(supportsThinking('unknown-model')).toBe(false)
    })

    it('should be case-insensitive', () => {
      expect(supportsThinking('CLAUDE-OPUS-4-6')).toBe(true)
      expect(supportsThinking('GPT-4O')).toBe(false)
    })
  })

  describe('Model Constants', () => {
    it('should have correct models in MODELS_TEMP_RANGE_0_2', () => {
      expect(MODELS_TEMP_RANGE_0_2).toContain('gpt-4o')
      expect(MODELS_TEMP_RANGE_0_2).toContain('gemini-2.5-flash')
      expect(MODELS_TEMP_RANGE_0_2).toContain('deepseek-v3')
      expect(MODELS_TEMP_RANGE_0_2).toContain('grok-3-latest')
      expect(MODELS_TEMP_RANGE_0_2).not.toContain('claude-sonnet-4-5')
    })

    it('should have correct models in MODELS_TEMP_RANGE_0_1', () => {
      expect(MODELS_TEMP_RANGE_0_1).toContain('claude-sonnet-4-5')
      expect(MODELS_TEMP_RANGE_0_1).not.toContain('grok-3-latest')
      expect(MODELS_TEMP_RANGE_0_1).not.toContain('gpt-4o')
    })

    it('should have correct providers in PROVIDERS_WITH_TOOL_USAGE_CONTROL', () => {
      expect(PROVIDERS_WITH_TOOL_USAGE_CONTROL).toContain('openai')
      expect(PROVIDERS_WITH_TOOL_USAGE_CONTROL).toContain('anthropic')
      expect(PROVIDERS_WITH_TOOL_USAGE_CONTROL).toContain('deepseek')
      expect(PROVIDERS_WITH_TOOL_USAGE_CONTROL).toContain('google')
      expect(PROVIDERS_WITH_TOOL_USAGE_CONTROL).not.toContain('ollama')
    })

    it('should combine both temperature ranges in MODELS_WITH_TEMPERATURE_SUPPORT', () => {
      expect(MODELS_WITH_TEMPERATURE_SUPPORT.length).toBe(
        MODELS_TEMP_RANGE_0_2.length + MODELS_TEMP_RANGE_0_15.length + MODELS_TEMP_RANGE_0_1.length
      )
      expect(MODELS_WITH_TEMPERATURE_SUPPORT).toContain('gpt-4o')
      expect(MODELS_WITH_TEMPERATURE_SUPPORT).toContain('claude-sonnet-4-5')
    })

    it('should have correct models in MODELS_WITH_REASONING_EFFORT', () => {
      expect(MODELS_WITH_REASONING_EFFORT).toContain('gpt-5.1')
      expect(MODELS_WITH_REASONING_EFFORT).toContain('azure/gpt-5.1')
      expect(MODELS_WITH_REASONING_EFFORT).toContain('azure/gpt-5.1-codex')

      expect(MODELS_WITH_REASONING_EFFORT).not.toContain('azure/gpt-5.1-mini')
      expect(MODELS_WITH_REASONING_EFFORT).not.toContain('azure/gpt-5.1-nano')

      expect(MODELS_WITH_REASONING_EFFORT).toContain('gpt-5')
      expect(MODELS_WITH_REASONING_EFFORT).toContain('gpt-5-mini')
      expect(MODELS_WITH_REASONING_EFFORT).toContain('gpt-5-nano')
      expect(MODELS_WITH_REASONING_EFFORT).toContain('azure/gpt-5')
      expect(MODELS_WITH_REASONING_EFFORT).toContain('azure/gpt-5-mini')
      expect(MODELS_WITH_REASONING_EFFORT).toContain('azure/gpt-5-nano')

      expect(MODELS_WITH_REASONING_EFFORT).toContain('gpt-5.2')
      expect(MODELS_WITH_REASONING_EFFORT).toContain('azure/gpt-5.2')

      expect(MODELS_WITH_REASONING_EFFORT).toContain('o1')
      expect(MODELS_WITH_REASONING_EFFORT).toContain('o3')
      expect(MODELS_WITH_REASONING_EFFORT).toContain('o4-mini')
      expect(MODELS_WITH_REASONING_EFFORT).toContain('azure/o3')
      expect(MODELS_WITH_REASONING_EFFORT).toContain('azure/o4-mini')

      expect(MODELS_WITH_REASONING_EFFORT).not.toContain('gpt-5-chat-latest')
      expect(MODELS_WITH_REASONING_EFFORT).not.toContain('azure/gpt-5-chat')

      expect(MODELS_WITH_REASONING_EFFORT).not.toContain('gpt-4o')
      expect(MODELS_WITH_REASONING_EFFORT).not.toContain('claude-sonnet-4-5')
      expect(MODELS_WITH_REASONING_EFFORT).toContain('groq/openai/gpt-oss-120b')
      expect(MODELS_WITH_REASONING_EFFORT).toContain('groq/openai/gpt-oss-20b')
    })

    it('should have correct models in MODELS_WITH_VERBOSITY', () => {
      expect(MODELS_WITH_VERBOSITY).toContain('gpt-5.1')
      expect(MODELS_WITH_VERBOSITY).toContain('azure/gpt-5.1')
      expect(MODELS_WITH_VERBOSITY).toContain('azure/gpt-5.1-codex')

      expect(MODELS_WITH_VERBOSITY).not.toContain('azure/gpt-5.1-mini')
      expect(MODELS_WITH_VERBOSITY).not.toContain('azure/gpt-5.1-nano')

      expect(MODELS_WITH_VERBOSITY).toContain('gpt-5')
      expect(MODELS_WITH_VERBOSITY).toContain('gpt-5-mini')
      expect(MODELS_WITH_VERBOSITY).toContain('gpt-5-nano')
      expect(MODELS_WITH_VERBOSITY).toContain('azure/gpt-5')
      expect(MODELS_WITH_VERBOSITY).toContain('azure/gpt-5-mini')
      expect(MODELS_WITH_VERBOSITY).toContain('azure/gpt-5-nano')

      expect(MODELS_WITH_VERBOSITY).toContain('gpt-5.2')
      expect(MODELS_WITH_VERBOSITY).toContain('azure/gpt-5.2')

      expect(MODELS_WITH_VERBOSITY).not.toContain('gpt-5-chat-latest')
      expect(MODELS_WITH_VERBOSITY).not.toContain('azure/gpt-5-chat')

      expect(MODELS_WITH_VERBOSITY).not.toContain('o1')
      expect(MODELS_WITH_VERBOSITY).not.toContain('o3')
      expect(MODELS_WITH_VERBOSITY).not.toContain('o4-mini')

      expect(MODELS_WITH_VERBOSITY).not.toContain('gpt-4o')
      expect(MODELS_WITH_VERBOSITY).not.toContain('claude-sonnet-4-5')
    })

    it('should have correct models in MODELS_WITH_THINKING', () => {
      expect(MODELS_WITH_THINKING).toContain('claude-opus-4-6')
      expect(MODELS_WITH_THINKING).toContain('claude-opus-4-5')
      expect(MODELS_WITH_THINKING).toContain('claude-opus-4-1')
      expect(MODELS_WITH_THINKING).toContain('claude-sonnet-4-5')

      expect(MODELS_WITH_THINKING).toContain('gemini-3-flash-preview')

      expect(MODELS_WITH_THINKING).toContain('claude-haiku-4-5')

      expect(MODELS_WITH_THINKING).toContain('deepseek-v4-flash')
      expect(MODELS_WITH_THINKING).toContain('deepseek-reasoner')
      expect(MODELS_WITH_THINKING).not.toContain('deepseek-chat')
      expect(MODELS_WITH_THINKING).toContain('groq/qwen/qwen3.6-27b')

      expect(MODELS_WITH_THINKING).not.toContain('gpt-4o')
      expect(MODELS_WITH_THINKING).not.toContain('gpt-5')
      expect(MODELS_WITH_THINKING).not.toContain('o3')
    })

    it('should have GPT-5 models in both reasoning effort and verbosity arrays', () => {
      const gpt5ModelsWithReasoningEffort = MODELS_WITH_REASONING_EFFORT.filter(
        (m) =>
          m.includes('gpt-5') &&
          !m.includes('chat-latest') &&
          !m.includes('gpt-5.5-pro') &&
          !m.includes('gpt-5.4-pro') &&
          !m.includes('gpt-5.2-pro') &&
          !m.includes('gpt-5-pro')
      )
      const gpt5ModelsWithVerbosity = MODELS_WITH_VERBOSITY.filter(
        (m) => m.includes('gpt-5') && !m.includes('chat-latest')
      )
      expect(gpt5ModelsWithReasoningEffort.sort()).toEqual(gpt5ModelsWithVerbosity.sort())

      expect(MODELS_WITH_REASONING_EFFORT).toContain('gpt-5.5-pro')
      expect(MODELS_WITH_VERBOSITY).not.toContain('gpt-5.5-pro')

      expect(MODELS_WITH_REASONING_EFFORT).toContain('gpt-5.4-pro')
      expect(MODELS_WITH_VERBOSITY).not.toContain('gpt-5.4-pro')

      expect(MODELS_WITH_REASONING_EFFORT).toContain('gpt-5.2-pro')
      expect(MODELS_WITH_VERBOSITY).not.toContain('gpt-5.2-pro')

      expect(MODELS_WITH_REASONING_EFFORT).toContain('gpt-5-pro')
      expect(MODELS_WITH_VERBOSITY).not.toContain('gpt-5-pro')

      expect(MODELS_WITH_REASONING_EFFORT).toContain('o1')
      expect(MODELS_WITH_VERBOSITY).not.toContain('o1')
    })
  })
  describe('Reasoning Effort Values Per Model', () => {
    it('should return correct values for GPT-5.2', () => {
      const values = getReasoningEffortValuesForModel('gpt-5.2')
      expect(values).toBeDefined()
      expect(values).toContain('none')
      expect(values).toContain('low')
      expect(values).toContain('medium')
      expect(values).toContain('high')
      expect(values).toContain('xhigh')
      expect(values).not.toContain('minimal')
    })

    it('should return correct values for GPT-5', () => {
      const values = getReasoningEffortValuesForModel('gpt-5')
      expect(values).toBeDefined()
      expect(values).toContain('minimal')
      expect(values).toContain('low')
      expect(values).toContain('medium')
      expect(values).toContain('high')
    })

    it('should return correct values for o-series models', () => {
      for (const model of ['o1', 'o3', 'o4-mini']) {
        const values = getReasoningEffortValuesForModel(model)
        expect(values).toBeDefined()
        expect(values).toContain('low')
        expect(values).toContain('medium')
        expect(values).toContain('high')
        expect(values).not.toContain('none')
        expect(values).not.toContain('minimal')
      }
    })

    it('should return null for non-reasoning models', () => {
      expect(getReasoningEffortValuesForModel('gpt-4o')).toBeNull()
      expect(getReasoningEffortValuesForModel('claude-sonnet-4-5')).toBeNull()
      expect(getReasoningEffortValuesForModel('gemini-2.5-flash')).toBeNull()
    })

    it('should return correct values for Azure GPT-5.2', () => {
      const values = getReasoningEffortValuesForModel('azure/gpt-5.2')
      expect(values).toBeDefined()
      expect(values).not.toContain('minimal')
      expect(values).toContain('none')
      expect(values).toContain('high')
      expect(values).not.toContain('xhigh')
    })
  })

  describe('Verbosity Values Per Model', () => {
    it('should return correct values for GPT-5 family', () => {
      for (const model of ['gpt-5.2', 'gpt-5.1', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano']) {
        const values = getVerbosityValuesForModel(model)
        expect(values).toBeDefined()
        expect(values).toContain('low')
        expect(values).toContain('medium')
        expect(values).toContain('high')
      }
    })

    it('should return null for o-series models', () => {
      expect(getVerbosityValuesForModel('o1')).toBeNull()
      expect(getVerbosityValuesForModel('o3')).toBeNull()
      expect(getVerbosityValuesForModel('o4-mini')).toBeNull()
    })

    it('should return null for non-reasoning models', () => {
      expect(getVerbosityValuesForModel('gpt-4o')).toBeNull()
      expect(getVerbosityValuesForModel('claude-sonnet-4-5')).toBeNull()
    })
  })

  describe('Thinking Levels Per Model', () => {
    it('should return correct levels for Claude Opus 4.6 (adaptive)', () => {
      const levels = getThinkingLevelsForModel('claude-opus-4-6')
      expect(levels).toBeDefined()
      expect(levels).toContain('low')
      expect(levels).toContain('medium')
      expect(levels).toContain('high')
      expect(levels).toContain('max')
    })

    it('should return correct levels for other Claude models (budget_tokens)', () => {
      for (const model of ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5']) {
        const levels = getThinkingLevelsForModel(model)
        expect(levels).toBeDefined()
        expect(levels).toContain('low')
        expect(levels).toContain('medium')
        expect(levels).toContain('high')
        expect(levels).not.toContain('max')
      }
    })

    it('should return correct levels for Gemini 3 models', () => {
      const flashLevels = getThinkingLevelsForModel('gemini-3-flash-preview')
      expect(flashLevels).toBeDefined()
      expect(flashLevels).toContain('minimal')
      expect(flashLevels).toContain('low')
      expect(flashLevels).toContain('medium')
      expect(flashLevels).toContain('high')
    })

    it('should return correct levels for Claude Haiku 4.5', () => {
      const levels = getThinkingLevelsForModel('claude-haiku-4-5')
      expect(levels).toBeDefined()
      expect(levels).toContain('low')
      expect(levels).toContain('medium')
      expect(levels).toContain('high')
    })

    it('should return null for non-thinking models', () => {
      expect(getThinkingLevelsForModel('gpt-4o')).toBeNull()
      expect(getThinkingLevelsForModel('gpt-5')).toBeNull()
      expect(getThinkingLevelsForModel('o3')).toBeNull()
    })
  })
})

describe('Max Output Tokens', () => {
  describe('getMaxOutputTokensForModel', () => {
    it('should return published max for OpenAI GPT-4o', () => {
      expect(getMaxOutputTokensForModel('gpt-4o')).toBe(16384)
    })

    it('should return published max for OpenAI GPT-5.1', () => {
      expect(getMaxOutputTokensForModel('gpt-5.1')).toBe(128000)
    })

    it('should return published max for OpenAI GPT-5 Chat', () => {
      expect(getMaxOutputTokensForModel('gpt-5-chat-latest')).toBe(16384)
    })

    it('should return published max for OpenAI o1', () => {
      expect(getMaxOutputTokensForModel('o1')).toBe(100000)
    })

    it('should return updated max for Claude Sonnet 4.6', () => {
      expect(getMaxOutputTokensForModel('claude-sonnet-4-6')).toBe(128000)
    })

    it('should return published max for Gemini 2.5 Pro', () => {
      expect(getMaxOutputTokensForModel('gemini-2.5-pro')).toBe(65536)
    })

    it('should return published max for Azure GPT-5.2', () => {
      expect(getMaxOutputTokensForModel('azure/gpt-5.2')).toBe(128000)
    })

    it('should return published max for DeepSeek Reasoner', () => {
      expect(getMaxOutputTokensForModel('deepseek-reasoner')).toBe(384000)
    })

    it('should return standard default for models without maxOutputTokens', () => {
      expect(getMaxOutputTokensForModel('grok-4-latest')).toBe(4096)
    })

    it('should return published max for Bedrock Claude Opus 4.1', () => {
      expect(getMaxOutputTokensForModel('bedrock/anthropic.claude-opus-4-1-20250805-v1:0')).toBe(
        32000
      )
    })

    it('should return correct max for Claude Opus 4.6', () => {
      expect(getMaxOutputTokensForModel('claude-opus-4-6')).toBe(128000)
    })

    it('should return correct max for Claude Sonnet 4.5', () => {
      expect(getMaxOutputTokensForModel('claude-sonnet-4-5')).toBe(64000)
    })

    it('should return correct max for Claude Opus 4.1', () => {
      expect(getMaxOutputTokensForModel('claude-opus-4-1')).toBe(32000)
    })

    it('should return standard default for unknown models', () => {
      expect(getMaxOutputTokensForModel('unknown-model')).toBe(4096)
    })
  })
})

describe('Model Pricing Validation', () => {
  it('should have correct pricing for key Anthropic models', () => {
    const opus46 = getModelPricing('claude-opus-4-6')
    expect(opus46).toBeDefined()
    expect(opus46.input).toBe(5.0)
    expect(opus46.output).toBe(25.0)

    const sonnet45 = getModelPricing('claude-sonnet-4-5')
    expect(sonnet45).toBeDefined()
    expect(sonnet45.input).toBe(3.0)
    expect(sonnet45.output).toBe(15.0)
  })

  it('should have correct pricing for key OpenAI models', () => {
    const gpt4o = getModelPricing('gpt-4o')
    expect(gpt4o).toBeDefined()
    expect(gpt4o.input).toBe(2.5)
    expect(gpt4o.output).toBe(10.0)

    const o3 = getModelPricing('o3')
    expect(o3).toBeDefined()
    expect(o3.input).toBe(2.0)
    expect(o3.output).toBe(8.0)
  })

  it('should have correct pricing for Azure OpenAI o3', () => {
    const azureO3 = getModelPricing('azure/o3')
    expect(azureO3).toBeDefined()
    expect(azureO3.input).toBe(2.0)
    expect(azureO3.output).toBe(8.0)
  })

  it('should return null for unknown models', () => {
    expect(getModelPricing('unknown-model')).toBeNull()
  })
})

describe('Context Window Validation', () => {
  it('should have correct context windows for key models', () => {
    const allModels = getAllModels()

    expect(allModels).toContain('gpt-5-chat-latest')

    expect(allModels).toContain('o3')
    expect(allModels).toContain('o4-mini')
  })
})

describe('Cost Calculation', () => {
  describe('calculateCost', () => {
    it('should calculate cost correctly for known models', () => {
      const result = calculateCost('gpt-4o', 1000, 500, false)

      expect(result.input).toBeGreaterThan(0)
      expect(result.output).toBeGreaterThan(0)
      expect(result.total).toBeCloseTo(result.input + result.output, 6)
      expect(result.pricing).toBeDefined()
      expect(result.pricing.input).toBe(2.5)
    })

    it('should handle cached input pricing when enabled', () => {
      const regularCost = calculateCost('gpt-4o', 1000, 500, false)
      const cachedCost = calculateCost('gpt-4o', 1000, 500, true)

      expect(cachedCost.input).toBeLessThan(regularCost.input)
      expect(cachedCost.output).toBe(regularCost.output)
    })

    it('should return default pricing for unknown models', () => {
      const result = calculateCost('unknown-model', 1000, 500, false)

      expect(result.input).toBe(0)
      expect(result.output).toBe(0)
      expect(result.total).toBe(0)
      expect(result.pricing.input).toBe(1.0)
    })

    it('should handle zero tokens', () => {
      const result = calculateCost('gpt-4o', 0, 0, false)

      expect(result.input).toBe(0)
      expect(result.output).toBe(0)
      expect(result.total).toBe(0)
    })
  })

  describe('formatCost', () => {
    it('should format dollar amounts as credits', () => {
      expect(formatCost(1.234)).toBe('247 credits')
      expect(formatCost(10.567)).toBe('2,113 credits')
    })

    it('should show <1 credit for very small costs', () => {
      expect(formatCost(0.0024)).toBe('<1 credit')
      expect(formatCost(0.001)).toBe('<1 credit')
    })

    it('should show credit count for small costs that round to at least 1', () => {
      expect(formatCost(0.0234)).toBe('5 credits')
      expect(formatCost(0.1567)).toBe('31 credits')
    })

    it('should handle zero cost', () => {
      expect(formatCost(0)).toBe('0 credits')
    })

    it('should handle undefined/null costs', () => {
      expect(formatCost(undefined as any)).toBe('—')
      expect(formatCost(null as any)).toBe('—')
    })
  })
})

describe('getHostedModels', () => {
  it('should return OpenAI, Anthropic, Google, and xAI models as hosted', () => {
    const hostedModels = getHostedModels()

    expect(hostedModels).toContain('gpt-4o')
    expect(hostedModels).toContain('o1')

    expect(hostedModels).toContain('claude-sonnet-4-5')
    expect(hostedModels).toContain('claude-opus-4-1')

    expect(hostedModels).toContain('gemini-2.5-pro')
    expect(hostedModels).toContain('gemini-2.5-flash')

    expect(hostedModels).toContain('grok-4.5')

    expect(hostedModels).not.toContain('deepseek-v3')
  })

  it('should return an array of strings', () => {
    const hostedModels = getHostedModels()

    expect(Array.isArray(hostedModels)).toBe(true)
    expect(hostedModels.length).toBeGreaterThan(0)
    hostedModels.forEach((model) => {
      expect(typeof model).toBe('string')
    })
  })
})

describe('shouldBillModelUsage', () => {
  it('should return true for exact matches of hosted models', () => {
    expect(shouldBillModelUsage('gpt-4o')).toBe(true)
    expect(shouldBillModelUsage('o1')).toBe(true)

    expect(shouldBillModelUsage('claude-sonnet-4-5')).toBe(true)
    expect(shouldBillModelUsage('claude-opus-4-1')).toBe(true)

    expect(shouldBillModelUsage('gemini-2.5-pro')).toBe(true)
    expect(shouldBillModelUsage('gemini-2.5-flash')).toBe(true)

    expect(shouldBillModelUsage('grok-4.5')).toBe(true)
  })

  it('should return false for non-hosted models', () => {
    expect(shouldBillModelUsage('deepseek-v3')).toBe(false)

    expect(shouldBillModelUsage('unknown-model')).toBe(false)
  })

  it('should return false for versioned model names not in hosted list', () => {
    expect(shouldBillModelUsage('claude-sonnet-4-20250514')).toBe(false)
    expect(shouldBillModelUsage('gpt-4o-2024-08-06')).toBe(false)
    expect(shouldBillModelUsage('claude-3-5-sonnet-20241022')).toBe(false)
  })

  it('should be case insensitive', () => {
    expect(shouldBillModelUsage('GPT-4O')).toBe(true)
    expect(shouldBillModelUsage('Claude-Sonnet-4-5')).toBe(true)
    expect(shouldBillModelUsage('GEMINI-2.5-PRO')).toBe(true)
  })

  it('should not match partial model names', () => {
    expect(shouldBillModelUsage('gpt-4')).toBe(false)
    expect(shouldBillModelUsage('claude-sonnet')).toBe(false)
    expect(shouldBillModelUsage('gemini')).toBe(false)
  })
})

describe('Provider Management', () => {
  describe('getProviderFromModel', () => {
    it('should return correct provider for known models', () => {
      expect(getProviderFromModel('gpt-4o')).toBe('openai')
      expect(getProviderFromModel('claude-sonnet-4-5')).toBe('anthropic')
      expect(getProviderFromModel('gemini-2.5-pro')).toBe('google')
      expect(getProviderFromModel('azure/gpt-4o')).toBe('azure-openai')
    })

    it('should use model patterns for pattern matching', () => {
      expect(getProviderFromModel('gpt-5-custom')).toBe('openai')
      expect(getProviderFromModel('claude-custom-model')).toBe('anthropic')
    })

    it('should default to ollama for unknown models', () => {
      expect(getProviderFromModel('unknown-model')).toBe('ollama')
    })

    it('should resolve gateway models that getBaseModelProviders deliberately omits', () => {
      // getBaseModelProviders() filters these providers out entirely, so a model
      // block that looked models up there rejected valid ids like these.
      expect(getProviderFromModel('openrouter/meta-llama/llama-4-maverick')).toBe('openrouter')
      expect(getProviderFromModel('together/some-model')).toBe('together')
      expect(getProviderFromModel('fireworks/some-model')).toBe('fireworks')
      expect(getBaseModelProviders()['openrouter/meta-llama/llama-4-maverick']).toBeUndefined()
    })

    it('should be case insensitive', () => {
      expect(getProviderFromModel('GPT-4O')).toBe('openai')
      expect(getProviderFromModel('CLAUDE-SONNET-4-0')).toBe('anthropic')
    })
  })

  describe('getProvider', () => {
    it('should return provider config for valid provider IDs', () => {
      const openaiProvider = getProvider('openai')
      expect(openaiProvider).toBeDefined()
      expect(openaiProvider?.id).toBe('openai')
      expect(openaiProvider?.name).toBe('OpenAI')

      const anthropicProvider = getProvider('anthropic')
      expect(anthropicProvider).toBeDefined()
      expect(anthropicProvider?.id).toBe('anthropic')
    })

    it('should handle provider/service format', () => {
      const provider = getProvider('openai/chat')
      expect(provider).toBeDefined()
      expect(provider?.id).toBe('openai')
    })

    it('should return undefined for invalid provider IDs', () => {
      expect(getProvider('nonexistent')).toBeUndefined()
    })
  })

  describe('getProviderConfigFromModel', () => {
    it('should return provider config for model', () => {
      const config = getProviderConfigFromModel('gpt-4o')
      expect(config).toBeDefined()
      expect(config?.id).toBe('openai')

      const anthropicConfig = getProviderConfigFromModel('claude-sonnet-4-5')
      expect(anthropicConfig).toBeDefined()
      expect(anthropicConfig?.id).toBe('anthropic')
    })
  })

  describe('getAllModels', () => {
    it('should return all models from all providers', () => {
      const allModels = getAllModels()
      expect(Array.isArray(allModels)).toBe(true)
      expect(allModels.length).toBeGreaterThan(0)

      expect(allModels).toContain('gpt-4o')
      expect(allModels).toContain('claude-sonnet-4-5')
      expect(allModels).toContain('gemini-2.5-pro')
    })
  })

  describe('getAllProviderIds', () => {
    it('should return all provider IDs', () => {
      const providerIds = getAllProviderIds()
      expect(Array.isArray(providerIds)).toBe(true)
      expect(providerIds).toContain('openai')
      expect(providerIds).toContain('anthropic')
      expect(providerIds).toContain('google')
      expect(providerIds).toContain('azure-openai')
    })
  })

  describe('getProviderModels', () => {
    it('should return models for specific providers', () => {
      const openaiModels = getProviderModels('openai')
      expect(Array.isArray(openaiModels)).toBe(true)
      expect(openaiModels).toContain('gpt-4o')
      expect(openaiModels).toContain('o1')

      const anthropicModels = getProviderModels('anthropic')
      expect(anthropicModels).toContain('claude-sonnet-4-5')
      expect(anthropicModels).toContain('claude-opus-4-1')
    })

    it('should return empty array for unknown providers', () => {
      const unknownModels = getProviderModels('unknown' as any)
      expect(unknownModels).toEqual([])
    })
  })

  describe('getBaseModelProviders and getAllModelProviders', () => {
    it('should return model to provider mapping', () => {
      const allProviders = getAllModelProviders()
      expect(typeof allProviders).toBe('object')
      expect(allProviders['gpt-4o']).toBe('openai')
      expect(allProviders['claude-sonnet-4-5']).toBe('anthropic')

      const baseProviders = getBaseModelProviders()
      expect(typeof baseProviders).toBe('object')
    })
  })

  describe('updateOllamaProviderModels', () => {
    it('should update ollama models', () => {
      const mockModels = ['llama2', 'codellama', 'mistral']

      expect(() => updateOllamaProviderModels(mockModels)).not.toThrow()

      const ollamaModels = getProviderModels('ollama')
      expect(ollamaModels).toEqual(mockModels)
    })
  })
})

describe('JSON and Structured Output', () => {
  describe('extractAndParseJSON', () => {
    it('should extract and parse valid JSON', () => {
      const content = 'Some text before ```json\n{"key": "value"}\n``` some text after'
      const result = extractAndParseJSON(content)
      expect(result).toEqual({ key: 'value' })
    })

    it('should extract JSON without code blocks', () => {
      const content = 'Text before {"name": "test", "value": 42} text after'
      const result = extractAndParseJSON(content)
      expect(result).toEqual({ name: 'test', value: 42 })
    })

    it('should handle nested objects', () => {
      const content = '{"user": {"name": "John", "age": 30}, "active": true}'
      const result = extractAndParseJSON(content)
      expect(result).toEqual({
        user: { name: 'John', age: 30 },
        active: true,
      })
    })

    it('should clean up common JSON issues', () => {
      const content = '{\n  "key": "value",\n  "number": 42,\n}'
      const result = extractAndParseJSON(content)
      expect(result).toEqual({ key: 'value', number: 42 })
    })

    it('should throw error for content without JSON', () => {
      expect(() => extractAndParseJSON('No JSON here')).toThrow('No JSON object found in content')
    })

    it('should throw error for invalid JSON', () => {
      const invalidJson = '{"key": invalid, "broken": }'
      expect(() => extractAndParseJSON(invalidJson)).toThrow('Failed to parse JSON after cleanup')
    })
  })

  describe('generateStructuredOutputInstructions', () => {
    it('should return empty string for JSON Schema format', () => {
      const schemaFormat = {
        schema: {
          type: 'object',
          properties: { key: { type: 'string' } },
        },
      }
      expect(generateStructuredOutputInstructions(schemaFormat)).toBe('')
    })

    it('should return empty string for object type with properties', () => {
      const objectFormat = {
        type: 'object',
        properties: { key: { type: 'string' } },
      }
      expect(generateStructuredOutputInstructions(objectFormat)).toBe('')
    })

    it('should generate instructions for legacy fields format', () => {
      const fieldsFormat = {
        fields: [
          { name: 'score', type: 'number', description: 'A score from 1-10' },
          { name: 'comment', type: 'string', description: 'A comment' },
        ],
      }
      const result = generateStructuredOutputInstructions(fieldsFormat)

      expect(result).toContain('JSON format')
      expect(result).toContain('score')
      expect(result).toContain('comment')
      expect(result).toContain('A score from 1-10')
    })

    it('should handle object fields with properties', () => {
      const fieldsFormat = {
        fields: [
          {
            name: 'metadata',
            type: 'object',
            properties: {
              version: { type: 'string', description: 'Version number' },
              count: { type: 'number', description: 'Item count' },
            },
          },
        ],
      }
      const result = generateStructuredOutputInstructions(fieldsFormat)

      expect(result).toContain('metadata')
      expect(result).toContain('Properties:')
      expect(result).toContain('version')
      expect(result).toContain('count')
    })

    it('should return empty string for missing fields', () => {
      expect(generateStructuredOutputInstructions({})).toBe('')
      expect(generateStructuredOutputInstructions(null)).toBe('')
      expect(generateStructuredOutputInstructions({ fields: null })).toBe('')
    })
  })
})

describe('Tool Management', () => {
  describe('prepareToolsWithUsageControl', () => {
    const mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    beforeEach(() => {
      mockLogger.info.mockClear()
    })

    it('should return early for no tools', () => {
      const result = prepareToolsWithUsageControl(undefined, undefined, mockLogger)

      expect(result.tools).toBeUndefined()
      expect(result.toolChoice).toBeUndefined()
      expect(result.hasFilteredTools).toBe(false)
      expect(result.forcedTools).toEqual([])
    })

    it('should filter out tools with usageControl="none"', () => {
      const tools = [
        { function: { name: 'tool1' } },
        { function: { name: 'tool2' } },
        { function: { name: 'tool3' } },
      ]
      const providerTools = [
        { id: 'tool1', usageControl: 'auto' },
        { id: 'tool2', usageControl: 'none' },
        { id: 'tool3', usageControl: 'force' },
      ]

      const result = prepareToolsWithUsageControl(tools, providerTools, mockLogger)

      expect(result.tools).toHaveLength(2)
      expect(result.hasFilteredTools).toBe(true)
      expect(result.forcedTools).toEqual(['tool3'])
      expect(mockLogger.info).toHaveBeenCalledWith("Filtered out 1 tools with usageControl='none'")
    })

    it('should set toolChoice for forced tools (OpenAI format)', () => {
      const tools = [{ function: { name: 'forcedTool' } }]
      const providerTools = [{ id: 'forcedTool', usageControl: 'force' }]

      const result = prepareToolsWithUsageControl(tools, providerTools, mockLogger)

      expect(result.toolChoice).toEqual({
        type: 'function',
        function: { name: 'forcedTool' },
      })
    })

    it('should set toolChoice for forced tools (Anthropic format)', () => {
      const tools = [{ function: { name: 'forcedTool' } }]
      const providerTools = [{ id: 'forcedTool', usageControl: 'force' }]

      const result = prepareToolsWithUsageControl(tools, providerTools, mockLogger, 'anthropic')

      expect(result.toolChoice).toEqual({
        type: 'tool',
        name: 'forcedTool',
      })
    })

    it('should set toolConfig for Google format', () => {
      const tools = [{ function: { name: 'forcedTool' } }]
      const providerTools = [{ id: 'forcedTool', usageControl: 'force' }]

      const result = prepareToolsWithUsageControl(tools, providerTools, mockLogger, 'google')

      expect(result.toolConfig).toEqual({
        functionCallingConfig: {
          mode: 'ANY',
          allowedFunctionNames: ['forcedTool'],
        },
      })
    })

    it('should return empty when all tools are filtered', () => {
      const tools = [{ function: { name: 'tool1' } }]
      const providerTools = [{ id: 'tool1', usageControl: 'none' }]

      const result = prepareToolsWithUsageControl(tools, providerTools, mockLogger)

      expect(result.tools).toBeUndefined()
      expect(result.toolChoice).toBeUndefined()
      expect(result.hasFilteredTools).toBe(true)
    })

    it('should default to auto when no forced tools', () => {
      const tools = [{ function: { name: 'tool1' } }]
      const providerTools = [{ id: 'tool1', usageControl: 'auto' }]

      const result = prepareToolsWithUsageControl(tools, providerTools, mockLogger)

      expect(result.toolChoice).toBe('auto')
    })

    it('keeps usage control independent for duplicate configured tools', () => {
      const providerTools: ProviderToolConfig[] = [
        {
          id: 'gmail_send',
          name: 'Gmail Send',
          description: 'Send an email',
          params: { oauthCredential: 'credential-a' },
          parameters: { type: 'object', properties: {}, required: [] },
          usageControl: 'none',
        },
        {
          id: 'gmail_send',
          name: 'Gmail Send',
          description: 'Send an email',
          params: { oauthCredential: 'credential-b' },
          parameters: { type: 'object', properties: {}, required: [] },
          usageControl: 'force',
        },
      ]
      assignProviderToolIdentities(providerTools)
      const tools = providerTools.map((tool) => ({ function: { name: tool.id } }))

      const result = prepareToolsWithUsageControl(tools, providerTools, mockLogger)

      expect(result.tools).toEqual([{ function: { name: 'gmail_send__sim_2' } }])
      expect(result.forcedTools).toEqual(['gmail_send__sim_2'])
      expect(result.toolChoice).toEqual({
        type: 'function',
        function: { name: 'gmail_send__sim_2' },
      })
    })
  })
})

describe('prepareToolExecution', () => {
  describe('basic parameter merging', () => {
    it('should merge LLM args with user params', () => {
      const tool = {
        params: { apiKey: 'user-key', channel: '#general' },
      }
      const llmArgs = { message: 'Hello world', channel: '#random' }
      const request = { workflowId: 'wf-123' }

      const { toolParams } = prepareToolExecution(tool, llmArgs, request)

      expect(toolParams.apiKey).toBe('user-key')
      expect(toolParams.channel).toBe('#general')
      expect(toolParams.message).toBe('Hello world')
    })

    it('should filter out empty string user params', () => {
      const tool = {
        params: { apiKey: 'user-key', channel: '' },
      }
      const llmArgs = { message: 'Hello', channel: '#llm-channel' }
      const request = {}

      const { toolParams } = prepareToolExecution(tool, llmArgs, request)

      expect(toolParams.apiKey).toBe('user-key')
      expect(toolParams.channel).toBe('#llm-channel')
      expect(toolParams.message).toBe('Hello')
    })

    it('runs the legacy parameter transform once when no secret provenance is attached', () => {
      const paramsTransform = vi.fn((params: Record<string, unknown>) => ({
        token: params.apiKey,
      }))

      const { toolParams } = prepareToolExecution(
        { params: { apiKey: 'ordinary-key' }, paramsTransform },
        {},
        {}
      )

      expect(toolParams).toEqual({ token: 'ordinary-key' })
      expect(paramsTransform).toHaveBeenCalledTimes(1)
    })
  })

  describe('_context propagation', () => {
    const billingAttribution = {
      actorUserId: 'user-1',
      workspaceId: 'workspace-1',
      organizationId: 'organization-1',
      billedAccountUserId: 'owner-1',
      billingEntity: { type: 'organization' as const, id: 'organization-1' },
      billingPeriod: {
        start: '2026-07-01T00:00:00.000Z',
        end: '2026-08-01T00:00:00.000Z',
      },
      payerSubscription: null,
    }

    it('should include billingAttribution in _context when the request carries it', () => {
      const tool = { params: {} }
      const request = {
        workflowId: 'wf-123',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        billingAttribution,
      }

      const { executionParams } = prepareToolExecution(tool, {}, request)

      expect(executionParams._context.billingAttribution).toEqual(billingAttribution)
    })

    it('should omit billingAttribution from _context when the request lacks it', () => {
      const tool = { params: {} }
      const request = { workflowId: 'wf-123', workspaceId: 'workspace-1' }

      const { executionParams } = prepareToolExecution(tool, {}, request)

      expect(executionParams._context).toBeDefined()
      expect(executionParams._context).not.toHaveProperty('billingAttribution')
    })

    it('should carry billingAttribution even when the request has no workflowId', () => {
      const tool = { params: {} }
      const request = { workspaceId: 'workspace-1', billingAttribution }

      const { executionParams } = prepareToolExecution(tool, {}, request)

      expect(executionParams._context.billingAttribution).toEqual(billingAttribution)
      expect(executionParams._context.workspaceId).toBe('workspace-1')
      expect(executionParams._context).not.toHaveProperty('workflowId')
    })

    it('should not build _context when there is no workflowId or attribution', () => {
      const tool = { params: {} }

      const { executionParams } = prepareToolExecution(tool, {}, { workspaceId: 'workspace-1' })

      expect(executionParams).not.toHaveProperty('_context')
    })
  })

  describe('inputMapping deep merge for workflow tools', () => {
    it('should deep merge inputMapping when user provides empty object', () => {
      const tool = {
        params: {
          workflowId: 'child-workflow-123',
          inputMapping: '{}',
        },
      }
      const llmArgs = {
        inputMapping: { query: 'search term', limit: 10 },
      }
      const request = { workflowId: 'parent-workflow' }

      const { toolParams } = prepareToolExecution(tool, llmArgs, request)

      expect(toolParams.inputMapping).toEqual({ query: 'search term', limit: 10 })
      expect(toolParams.workflowId).toBe('child-workflow-123')
    })

    it('should deep merge inputMapping with partial user values', () => {
      const tool = {
        params: {
          workflowId: 'child-workflow',
          inputMapping: '{"query": "", "customField": "user-value"}',
        },
      }
      const llmArgs = {
        inputMapping: { query: 'llm-search', limit: 10 },
      }
      const request = {}

      const { toolParams } = prepareToolExecution(tool, llmArgs, request)

      expect(toolParams.inputMapping).toEqual({
        query: 'llm-search',
        limit: 10,
        customField: 'user-value',
      })
    })

    it('should preserve non-empty user inputMapping values', () => {
      const tool = {
        params: {
          workflowId: 'child-workflow',
          inputMapping: '{"query": "user-search", "limit": 5}',
        },
      }
      const llmArgs = {
        inputMapping: { query: 'llm-search', limit: 10, extra: 'field' },
      }
      const request = {}

      const { toolParams } = prepareToolExecution(tool, llmArgs, request)

      expect(toolParams.inputMapping).toEqual({
        query: 'user-search',
        limit: 5,
        extra: 'field',
      })
    })

    it('should handle inputMapping as object (not JSON string)', () => {
      const tool = {
        params: {
          workflowId: 'child-workflow',
          inputMapping: { query: '', customField: 'user-value' },
        },
      }
      const llmArgs = {
        inputMapping: { query: 'llm-search', limit: 10 },
      }
      const request = {}

      const { toolParams } = prepareToolExecution(tool, llmArgs, request)

      expect(toolParams.inputMapping).toEqual({
        query: 'llm-search',
        limit: 10,
        customField: 'user-value',
      })
    })

    it('should use LLM inputMapping when user does not provide it', () => {
      const tool = {
        params: { workflowId: 'child-workflow' },
      }
      const llmArgs = {
        inputMapping: { query: 'llm-search', limit: 10 },
      }
      const request = {}

      const { toolParams } = prepareToolExecution(tool, llmArgs, request)

      expect(toolParams.inputMapping).toEqual({ query: 'llm-search', limit: 10 })
    })

    it('should use user inputMapping when LLM does not provide it', () => {
      const tool = {
        params: {
          workflowId: 'child-workflow',
          inputMapping: '{"query": "user-search"}',
        },
      }
      const llmArgs = {}
      const request = {}

      const { toolParams } = prepareToolExecution(tool, llmArgs, request)

      expect(toolParams.inputMapping).toEqual({ query: 'user-search' })
    })

    it('should handle invalid JSON in user inputMapping gracefully', () => {
      const tool = {
        params: {
          workflowId: 'child-workflow',
          inputMapping: 'not valid json {',
        },
      }
      const llmArgs = {
        inputMapping: { query: 'llm-search' },
      }
      const request = {}

      const { toolParams } = prepareToolExecution(tool, llmArgs, request)

      expect(toolParams.inputMapping).toEqual({ query: 'llm-search' })
    })

    it('should not affect other parameters - normal override behavior', () => {
      const tool = {
        params: { apiKey: 'user-key', channel: '#general' },
      }
      const llmArgs = { message: 'Hello', channel: '#random' }
      const request = {}

      const { toolParams } = prepareToolExecution(tool, llmArgs, request)

      expect(toolParams.apiKey).toBe('user-key')
      expect(toolParams.channel).toBe('#general')
      expect(toolParams.message).toBe('Hello')
    })

    it('should preserve 0 and false as valid user values in inputMapping', () => {
      const tool = {
        params: {
          workflowId: 'child-workflow',
          inputMapping: '{"limit": 0, "enabled": false, "query": ""}',
        },
      }
      const llmArgs = {
        inputMapping: { limit: 10, enabled: true, query: 'llm-search' },
      }
      const request = {}

      const { toolParams } = prepareToolExecution(tool, llmArgs, request)

      expect(toolParams.inputMapping).toEqual({
        limit: 0,
        enabled: false,
        query: 'llm-search',
      })
    })
  })

  describe('execution params context', () => {
    it('should include workflow context in executionParams', () => {
      const tool = { params: { message: 'test' } }
      const llmArgs = {}
      const request = {
        workflowId: 'wf-123',
        workspaceId: 'ws-456',
        chatId: 'chat-789',
        userId: 'user-abc',
      }

      const { executionParams } = prepareToolExecution(tool, llmArgs, request)

      expect(executionParams._context).toEqual({
        workflowId: 'wf-123',
        workspaceId: 'ws-456',
        chatId: 'chat-789',
        userId: 'user-abc',
      })
    })

    it('should include environment and workflow variables', () => {
      const tool = { params: {} }
      const llmArgs = {}
      const request = {
        environmentVariables: { API_KEY: 'secret' },
        workflowVariables: { counter: 42 },
      }

      const { executionParams } = prepareToolExecution(tool, llmArgs, request)

      expect(executionParams.envVars).toEqual({ API_KEY: 'secret' })
      expect(executionParams.workflowVariables).toEqual({ counter: 42 })
    })
  })
})

describe('Provider/Model Blacklist', () => {
  describe('isProviderBlacklisted', () => {
    it('should return false when no providers are blacklisted', () => {
      expect(isProviderBlacklisted('openai')).toBe(false)
      expect(isProviderBlacklisted('anthropic')).toBe(false)
    })
  })

  describe('filterBlacklistedModels', () => {
    it('should return all models when no blacklist is set', () => {
      const models = ['gpt-4o', 'claude-sonnet-4-5', 'gemini-2.5-pro']
      const result = filterBlacklistedModels(models)
      expect(result).toEqual(models)
    })

    it('should return empty array for empty input', () => {
      const result = filterBlacklistedModels([])
      expect(result).toEqual([])
    })
  })

  describe('getBaseModelProviders blacklist filtering', () => {
    it('should return providers when no blacklist is set', () => {
      const providers = getBaseModelProviders()
      expect(Object.keys(providers).length).toBeGreaterThan(0)
      expect(providers['gpt-4o']).toBe('openai')
      expect(providers['claude-sonnet-4-5']).toBe('anthropic')
    })
  })

  describe('getProviderFromModel execution-time enforcement', () => {
    it('should return provider for non-blacklisted models', () => {
      expect(getProviderFromModel('gpt-4o')).toBe('openai')
      expect(getProviderFromModel('claude-sonnet-4-5')).toBe('anthropic')
    })

    it('should be case insensitive', () => {
      expect(getProviderFromModel('GPT-4O')).toBe('openai')
      expect(getProviderFromModel('CLAUDE-SONNET-4-5')).toBe('anthropic')
    })
  })
})

describe('transformBlockTool table identities', () => {
  const tableBlockDef = {
    type: 'table',
    inputs: {},
    subBlocks: [
      { id: 'operation', type: 'dropdown' },
      { id: 'tableSelector', type: 'table-selector', canonicalParamId: 'tableId', mode: 'basic' },
      {
        id: 'manualTableId',
        type: 'short-input',
        canonicalParamId: 'tableId',
        mode: 'advanced',
      },
    ],
    tools: {
      access: ['table_query_rows', 'table_insert_row'],
      config: { tool: () => 'table_query_rows' },
    },
  }

  const getAllBlocks = () => [tableBlockDef]
  const getTool = (id: string) => ({
    id,
    name: 'Query Rows',
    description: 'Query table rows',
    params: {},
  })

  const transformTable = (
    params: Record<string, unknown>,
    canonicalModes?: Record<string, 'basic' | 'advanced'>,
    toolIndex?: number
  ) =>
    transformBlockTool(
      { type: 'table', operation: 'query_rows', params },
      { selectedOperation: 'query_rows', getAllBlocks, getTool, canonicalModes, toolIndex }
    )

  it('keeps the canonical id when the table is stored under the basic selector key', async () => {
    const result = await transformTable({ tableSelector: 'tbl_abc' })
    expect(result?.id).toBe('table_query_rows')
  })

  it('resolves the active table selector before enriching the LLM tool schema', async () => {
    const enrichTool = vi.fn(
      async (
        tableId: string,
        schema: {
          type: 'object'
          properties: Record<string, unknown>
          required: string[]
        }
      ) => ({
        description: `Query rows from ${tableId}`,
        parameters: {
          ...schema,
          properties: {
            ...schema.properties,
            customer_name: { type: 'string' },
          },
        },
      })
    )
    const result = await transformBlockTool(
      {
        type: 'table',
        operation: 'query_rows',
        params: { tableId: 'tbl_stale', tableSelector: 'tbl_active' },
      },
      {
        selectedOperation: 'query_rows',
        getAllBlocks,
        enrichmentContext: {
          workspaceId: 'workspace-1',
          userId: 'user-1',
        },
        getTool: (id: string) => ({
          id,
          name: 'Query Rows',
          description: 'Query table rows',
          params: {
            tableId: { type: 'string', required: true, visibility: 'user-only' },
            filter: { type: 'object', visibility: 'user-or-llm' },
          },
          toolEnrichment: {
            dependsOn: 'tableId',
            enrichTool,
          },
        }),
      }
    )

    expect(enrichTool).toHaveBeenCalledWith(
      'tbl_active',
      expect.objectContaining({
        properties: expect.objectContaining({ filter: expect.any(Object) }),
      }),
      'Query table rows',
      {
        workspaceId: 'workspace-1',
        userId: 'user-1',
      }
    )
    expect(result).toMatchObject({
      id: 'table_query_rows',
      description: 'Query rows from tbl_active',
      params: { tableId: 'tbl_stale', tableSelector: 'tbl_active' },
      parameters: {
        properties: {
          customer_name: { type: 'string' },
        },
      },
    })
    expect(result?.paramsTransform?.(result.params)).toEqual({ tableId: 'tbl_active' })
  })

  it('keeps the canonical id for a table resolved from the advanced manual input', async () => {
    const result = await transformTable(
      { manualTableId: 'tbl_xyz' },
      { '0:tableId': 'advanced' },
      0
    )
    expect(result?.id).toBe('table_query_rows')
  })

  it('resolves an advanced-only manual id via the heuristic when basic is empty and no mode is set', async () => {
    // No canonicalModes entry: routing through resolveCanonicalMode picks advanced (empty basic),
    // where the old `?? 'basic'` fallback dropped the advanced-only value.
    const result = await transformTable({ manualTableId: 'tbl_only' })
    expect(result?.id).toBe('table_query_rows')
  })

  it('keeps the canonical tool id when the table id is already present in params', async () => {
    const result = await transformTable({ tableId: 'tbl_direct' })
    expect(result?.id).toBe('table_query_rows')
  })

  it('preserves the canonical table id when advanced mode is active', async () => {
    const result = await transformTable(
      { tableId: 'tbl_advanced', tableSelector: 'tbl_basic' },
      { '0:tableId': 'advanced' },
      0
    )
    expect(result?.id).toBe('table_query_rows')
    expect(result?.paramsTransform?.(result.params)).toEqual({ tableId: 'tbl_advanced' })
  })

  it('falls back to the base tool id when no table is selected', async () => {
    const result = await transformTable({})
    expect(result?.id).toBe('table_query_rows')
  })

  it('regression: two Table tool instances on one Agent block resolve their canonical mode independently', async () => {
    // Both tools are type "table" with canonicalId "tableId" and BOTH basic + advanced values
    // populated, so only the explicit per-instance mode determines which one wins. Before the fix,
    // canonicalModes was keyed by `${toolType}:${canonicalId}` (shared across every "table" tool),
    // so toggling tool #0 to advanced also flipped tool #1's resolved value.
    const sharedParams = { tableSelector: 'tbl_basic', manualTableId: 'tbl_advanced' }
    const canonicalModes = { '0:tableId': 'advanced', '1:tableId': 'basic' }

    const first = await transformTable(sharedParams, canonicalModes, 0)
    const second = await transformTable(sharedParams, canonicalModes, 1)

    expect(first?.id).toBe('table_query_rows')
    expect(second?.id).toBe('table_query_rows')
  })
})

describe('transformBlockTool knowledge-base identities', () => {
  const knowledgeBlockDef = {
    type: 'knowledge',
    inputs: {},
    subBlocks: [
      { id: 'operation', type: 'dropdown' },
      {
        id: 'knowledgeBaseSelector',
        type: 'knowledge-base-selector',
        canonicalParamId: 'knowledgeBaseId',
        mode: 'basic',
      },
      {
        id: 'manualKnowledgeBaseId',
        type: 'short-input',
        canonicalParamId: 'knowledgeBaseId',
        mode: 'advanced',
      },
    ],
    tools: {
      access: ['knowledge_search', 'knowledge_upload_chunk'],
      config: { tool: () => 'knowledge_search' },
    },
  }

  const getAllBlocks = () => [knowledgeBlockDef]
  const getTool = (id: string) => ({
    id,
    name: 'Search',
    description: 'Search the knowledge base',
    params: {},
  })

  const transformKb = (
    params: Record<string, unknown>,
    canonicalModes?: Record<string, 'basic' | 'advanced'>,
    toolIndex?: number
  ) =>
    transformBlockTool(
      { type: 'knowledge', operation: 'search', params },
      { selectedOperation: 'search', getAllBlocks, getTool, canonicalModes, toolIndex }
    )

  it('keeps the canonical id for the basic knowledge base selector', async () => {
    const result = await transformKb({ knowledgeBaseSelector: 'kb_abc' })
    expect(result?.id).toBe('knowledge_search')
  })

  it('keeps the canonical id for an advanced knowledge base input', async () => {
    const result = await transformKb(
      { manualKnowledgeBaseId: 'kb_xyz' },
      { '0:knowledgeBaseId': 'advanced' },
      0
    )
    expect(result?.id).toBe('knowledge_search')
  })

  it('keeps the canonical tool id when the knowledge base id is already present', async () => {
    const result = await transformKb({ knowledgeBaseId: 'kb_direct' })
    expect(result?.id).toBe('knowledge_search')
  })

  it('falls back to the base tool id when no knowledge base is selected', async () => {
    const result = await transformKb({})
    expect(result?.id).toBe('knowledge_search')
  })
})

describe('prepareToolExecution invoker identity hand-off', () => {
  const tool = { params: {}, parameters: {} }

  /**
   * A custom block invoked as an agent tool starts its own child execution, and
   * correlates + cancels against the INVOKING run. That id only reaches it via
   * `_context`, so this asserts the hand-off rather than any single hop — three
   * separate fixes each repaired one hop and left the chain broken elsewhere.
   */
  it("puts the invoking run's execution id on tool _context", () => {
    const { executionParams } = prepareToolExecution(
      tool,
      {},
      {
        workflowId: 'wf-1',
        workspaceId: 'ws-1',
        executionId: 'real-execution-id',
      }
    )

    expect(executionParams._context.executionId).toBe('real-execution-id')
  })

  it('omits the execution id when the request carries none', () => {
    const { executionParams } = prepareToolExecution(
      tool,
      {},
      {
        workflowId: 'wf-1',
        workspaceId: 'ws-1',
      }
    )

    expect(executionParams._context.executionId).toBeUndefined()
  })
})

describe('workflow executor metadata delegation', () => {
  const workflowBlock = {
    type: 'workflow',
    name: 'Workflow',
    description: 'Execute a workflow',
    inputs: {},
    subBlocks: [],
    tools: { access: ['workflow_executor'] },
  }
  const workflowTool = {
    id: 'workflow_executor',
    name: 'Workflow Executor',
    description: 'Execute another workflow',
    params: {
      workflowId: {
        type: 'string' as const,
        required: true,
        visibility: 'user-only' as const,
      },
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    workflowMetadataMocks.readWorkflowMetadataForTool.mockResolvedValue({
      name: 'Child Workflow',
      description: 'Child description',
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('binds cross-workflow metadata reads to the target without attaching the parent run', async () => {
    const result = await transformBlockTool(
      { type: 'workflow', params: { workflowId: 'child-workflow' } },
      {
        getAllBlocks: () => [workflowBlock],
        getTool: () => workflowTool,
        enrichmentContext: {
          workflowId: 'parent-workflow',
          workspaceId: 'workspace-1',
          executionId: 'execution-1',
          userId: 'user-1',
          executorDelegationOrigin: {
            subjectUserId: 'user-1',
            workflowId: 'parent-workflow',
            executionId: 'execution-1',
            principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
            currentWorkflow: { workflowId: 'parent-workflow', mode: 'draft' },
          },
        },
        readWorkflowMetadata: workflowMetadataMocks.readWorkflowMetadataForTool,
      }
    )

    expect(workflowMetadataMocks.readWorkflowMetadataForTool).toHaveBeenCalledWith(
      'child-workflow',
      {
        userId: 'user-1',
        workflowId: 'parent-workflow',
        workspaceId: 'workspace-1',
        executionId: 'execution-1',
        executorDelegationOrigin: {
          subjectUserId: 'user-1',
          workflowId: 'parent-workflow',
          executionId: 'execution-1',
          principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
          currentWorkflow: { workflowId: 'parent-workflow', mode: 'draft' },
        },
      }
    )
    expect(result).toMatchObject({
      id: 'workflow_executor',
      description: 'Child description',
    })
  })

  it('includes the run binding when the metadata target is the executing workflow', async () => {
    workflowMetadataMocks.readWorkflowMetadataForTool.mockResolvedValue({
      name: 'Current Workflow',
      description: null,
    })

    await transformBlockTool(
      { type: 'workflow', params: { workflowId: 'current-workflow' } },
      {
        getAllBlocks: () => [workflowBlock],
        getTool: () => workflowTool,
        enrichmentContext: {
          workflowId: 'current-workflow',
          workspaceId: 'workspace-1',
          executionId: 'execution-1',
          userId: 'user-1',
          executorDelegationOrigin: {
            subjectUserId: 'user-1',
            workflowId: 'current-workflow',
            executionId: 'execution-1',
            principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
            currentWorkflow: { workflowId: 'current-workflow', mode: 'draft' },
          },
        },
        readWorkflowMetadata: workflowMetadataMocks.readWorkflowMetadataForTool,
      }
    )

    expect(workflowMetadataMocks.readWorkflowMetadataForTool).toHaveBeenCalledWith(
      'current-workflow',
      {
        userId: 'user-1',
        workflowId: 'current-workflow',
        workspaceId: 'workspace-1',
        executionId: 'execution-1',
        executorDelegationOrigin: {
          subjectUserId: 'user-1',
          workflowId: 'current-workflow',
          executionId: 'execution-1',
          principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
          currentWorkflow: { workflowId: 'current-workflow', mode: 'draft' },
        },
      }
    )
  })

  it('does not issue an actorless fallback token without a trusted execution subject', async () => {
    const result = await transformBlockTool(
      { type: 'workflow', params: { workflowId: 'child-workflow' } },
      {
        getAllBlocks: () => [workflowBlock],
        getTool: () => workflowTool,
        readWorkflowMetadata: workflowMetadataMocks.readWorkflowMetadataForTool,
      }
    )

    expect(workflowMetadataMocks.readWorkflowMetadataForTool).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      id: 'workflow_executor',
      description: 'Execute another workflow',
    })
  })
})

/**
 * The agent block's tuning-level fields accept variable and environment references, so any
 * message that echoes a caller-supplied level can otherwise carry whatever that reference
 * resolved to — including secret content.
 */
describe('describeModelLevel', () => {
  it('echoes a level the catalogue declares', () => {
    expect(describeModelLevel('high')).toBe('high')
    expect(describeModelLevel('minimal')).toBe('minimal')
    expect(describeModelLevel('xhigh')).toBe('xhigh')
  })

  it('echoes the auto and none sentinels', () => {
    expect(describeModelLevel('auto')).toBe('auto')
    expect(describeModelLevel('none')).toBe('none')
  })

  it('redacts anything else to a length', () => {
    const secret = 'sk-proj-abcdef0123456789'
    expect(describeModelLevel(secret)).toBe(`[redacted ${secret.length} chars]`)
    expect(describeModelLevel(secret)).not.toContain('abcdef')
  })

  it('reports an absent level without throwing', () => {
    expect(describeModelLevel(undefined)).toBe('(unset)')
    expect(describeModelLevel('')).toBe('(unset)')
  })
})

describe('findProviderFromModel', () => {
  it('resolves a chat model to its declaring provider', () => {
    expect(findProviderFromModel('claude-sonnet-5')).toBe('anthropic')
    expect(findProviderFromModel('gpt-5.2')).toBe('openai')
  })

  it('is case-insensitive, like getProviderFromModel', () => {
    expect(findProviderFromModel('Claude-Sonnet-5')).toBe('anthropic')
  })

  it('returns null for ids the registry does not declare, instead of guessing ollama', () => {
    /* The registry holds chat models only. Speech, image, video and embedding
       ids reach `model` subblocks too, and a permission gate must not read them
       as Ollama models — see isModelUsable. */
    for (const id of ['whisper-1', 'dall-e-3', 'veo-3.1', 'embed-v4.0', 'tts-1']) {
      expect(findProviderFromModel(id)).toBeNull()
    }
  })

  it('still lets getProviderFromModel fall back to ollama for those ids', () => {
    expect(getProviderFromModel('whisper-1')).toBe('ollama')
  })
})

describe('transformBlockTool param decoding', () => {
  /**
   * `StoredTool.params` stringifies every value, so a tool row hands a block the same
   * shapes the canvas does only if `paramsTransform` decodes them back. These pin the
   * two halves of that: which declaration decides a param's shape, and where in the
   * transform the decode happens.
   */
  const buildHarness = (
    subBlocks: Array<Record<string, unknown>>,
    toolParams: Record<string, { type: string }>,
    paramsFn?: (params: Record<string, any>) => Record<string, any>,
    inputs: Record<string, unknown> = {}
  ) => {
    const blockDef = {
      type: 'fixture',
      inputs,
      subBlocks,
      tools: {
        access: ['fixture_tool'],
        ...(paramsFn ? { config: { params: paramsFn } } : {}),
      },
    }
    return {
      getAllBlocks: () => [blockDef],
      getTool: (id: string) => ({
        id,
        name: 'Fixture',
        description: 'Fixture tool',
        params: toolParams,
      }),
    }
  }

  const transformFixture = async (
    harness: ReturnType<typeof buildHarness>,
    params: Record<string, unknown>
  ) => {
    const result = await transformBlockTool(
      { type: 'fixture', params },
      { getAllBlocks: harness.getAllBlocks, getTool: harness.getTool }
    )
    return result?.paramsTransform?.(params as Record<string, any>)
  }

  it('decodes a boolean param the block does not surface as a sub-block', async () => {
    // The reported Jira bug: `includeAttachments` is declared boolean on the tool and
    // has no sub-block, so it used to arrive as the truthy string 'false'.
    const harness = buildHarness([], { includeAttachments: { type: 'boolean' } })

    expect(await transformFixture(harness, { includeAttachments: 'false' })).toEqual({
      includeAttachments: false,
    })
    expect(await transformFixture(harness, { includeAttachments: 'true' })).toEqual({
      includeAttachments: true,
    })
  })

  it('decodes before the block params function reads the value', async () => {
    // Mirrors microsoft_teams, which consumes the flag inside `params` — a decode
    // placed after it would see an already-emitted `true` and be a no-op.
    const harness = buildHarness(
      [{ id: 'includeAttachments', type: 'switch' }],
      { includeAttachments: { type: 'boolean' } },
      (params) => (params.includeAttachments ? { includeAttachments: true } : {})
    )

    expect(await transformFixture(harness, { includeAttachments: 'false' })).toEqual({
      includeAttachments: false,
    })
    expect(await transformFixture(harness, { includeAttachments: 'true' })).toEqual({
      includeAttachments: true,
    })
  })

  it('leaves a dropdown-backed boolean as the string its params function compares', async () => {
    // Jira's `deleteSubtasks`. A dropdown stores a string on the canvas too, so
    // re-keying the decode off the tool's declared type would invert this flag.
    const harness = buildHarness(
      [
        {
          id: 'deleteSubtasks',
          type: 'dropdown',
          options: [
            { label: 'No', id: 'false' },
            { label: 'Yes', id: 'true' },
          ],
        },
      ],
      { deleteSubtasks: { type: 'boolean' } },
      (params) => ({ deleteSubtasks: params.deleteSubtasks === 'true' })
    )

    expect(await transformFixture(harness, { deleteSubtasks: 'true' })).toMatchObject({
      deleteSubtasks: true,
    })
    expect(await transformFixture(harness, { deleteSubtasks: 'false' })).toMatchObject({
      deleteSubtasks: false,
    })
  })

  it('decodes a canonical pair once, under its canonical id', async () => {
    const harness = buildHarness(
      [
        { id: 'flagBasic', type: 'switch', canonicalParamId: 'flag', mode: 'basic' },
        { id: 'flagAdvanced', type: 'switch', canonicalParamId: 'flag', mode: 'advanced' },
      ],
      { flag: { type: 'boolean' } }
    )

    expect(await transformFixture(harness, { flagBasic: 'false' })).toEqual({ flag: false })
  })

  it('leaves a model-supplied typed value untouched', async () => {
    const harness = buildHarness([], { includeAttachments: { type: 'boolean' } })
    expect(await transformFixture(harness, { includeAttachments: true })).toEqual({
      includeAttachments: true,
    })
  })

  it("leaves '' alone so the model's value still wins", async () => {
    const harness = buildHarness([], { flag: { type: 'boolean' }, count: { type: 'number' } })
    expect(await transformFixture(harness, { flag: '', count: '' })).toEqual({
      flag: '',
      count: '',
    })
  })

  it('parses a json param the block inputs never declared', async () => {
    const harness = buildHarness([], { body: { type: 'json' } })
    expect(await transformFixture(harness, { body: '{"a":1}' })).toEqual({ body: { a: 1 } })
  })

  it('keeps parsing a json block input that names no tool param', async () => {
    // The `inputs` loop stays: it is the same one the canvas runs, and it covers keys
    // the tool does not declare.
    const harness = buildHarness([], {}, undefined, { extra: { type: 'json' } })
    expect(await transformFixture(harness, { extra: '{"a":1}' })).toEqual({ extra: { a: 1 } })
  })

  it('does not double-parse a value the decode already handled', async () => {
    const harness = buildHarness(
      [{ id: 'files', type: 'file-upload' }],
      { files: { type: 'file[]' } },
      undefined,
      {
        files: { type: 'array' },
      }
    )
    expect(await transformFixture(harness, { files: '[{"name":"a.txt"}]' })).toEqual({
      files: [{ name: 'a.txt' }],
    })
  })

  it('never throws on a malformed value', async () => {
    const harness = buildHarness([], { body: { type: 'json' }, count: { type: 'number' } })
    expect(await transformFixture(harness, { body: '{bad', count: '<start.count>' })).toEqual({
      body: '{bad',
      count: '<start.count>',
    })
  })

  it('expands a checkbox-list onto its option params in a tool row', async () => {
    const harness = buildHarness(
      [
        {
          id: 'scanOptions',
          type: 'checkbox-list',
          options: [
            { label: 'Gather Links', id: 'gatherLinks' },
            { label: 'No Cache', id: 'noCache' },
          ],
        },
      ],
      { gatherLinks: { type: 'boolean' }, noCache: { type: 'boolean' } }
    )

    const result = await transformFixture(harness, {
      scanOptions: '{"gatherLinks":true,"noCache":false}',
    })

    expect(result).toEqual({ gatherLinks: true, noCache: false })
  })

  it('reports the json-shaped keys so the secret projection keeps the same shape', async () => {
    const result = await transformBlockTool(
      { type: 'fixture', params: {} },
      buildHarness([], { body: { type: 'json' }, name: { type: 'string' } })
    )
    expect(result?.jsonShapedParamKeys).toEqual(['body'])
  })
})
