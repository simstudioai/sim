import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as environmentModule from '@/lib/core/config/feature-flags'
import {
  calculateCost,
  extractAndParseJSON,
  filterBlacklistedModels,
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
  updateOllamaProviderModels,
} from '@/providers/utils'

const isHostedSpy = vi.spyOn(environmentModule, 'isHosted', 'get') as unknown as {
  mockReturnValue: (value: boolean) => void
}
const mockGetRotatingApiKey = vi.fn().mockReturnValue('rotating-server-key')
const originalRequire = module.require

describe('getApiKey', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()

    isHostedSpy.mockReturnValue(false)

    module.require = vi.fn(() => ({
      getRotatingApiKey: mockGetRotatingApiKey,
    }))
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    module.require = originalRequire
  })

  it.concurrent('should return user-provided key when not in hosted environment', () => {
    isHostedSpy.mockReturnValue(false)

    const key1 = getApiKey('openai', 'gpt-4', 'user-key-openai')
    expect(key1).toBe('user-key-openai')

    const key2 = getApiKey('anthropic', 'claude-3', 'user-key-anthropic')
    expect(key2).toBe('user-key-anthropic')

    const key3 = getApiKey('google', 'gemini-2.5-flash', 'user-key-google')
    expect(key3).toBe('user-key-google')
  })

  it.concurrent('should throw error if no key provided in non-hosted environment', () => {
    isHostedSpy.mockReturnValue(false)

    expect(() => getApiKey('openai', 'gpt-4')).toThrow('API key is required for openai gpt-4')
    expect(() => getApiKey('anthropic', 'claude-3')).toThrow(
      'API key is required for anthropic claude-3'
    )
  })

  it.concurrent('should fall back to user key in hosted environment if rotation fails', () => {
    isHostedSpy.mockReturnValue(true)

    module.require = vi.fn(() => {
      throw new Error('Rotation failed')
    })

    const key = getApiKey('openai', 'gpt-4o', 'user-fallback-key')
    expect(key).toBe('user-fallback-key')
  })

  it.concurrent(
    'should throw error in hosted environment if rotation fails and no user key',
    () => {
      isHostedSpy.mockReturnValue(true)

      module.require = vi.fn(() => {
        throw new Error('Rotation failed')
      })

      expect(() => getApiKey('openai', 'gpt-4o')).toThrow('No API key available for openai gpt-4o')
    }
  )

  it.concurrent(
    'should require user key for non-OpenAI/Anthropic providers even in hosted environment',
    () => {
      isHostedSpy.mockReturnValue(true)

      const key = getApiKey('other-provider', 'some-model', 'user-key')
      expect(key).toBe('user-key')

      expect(() => getApiKey('other-provider', 'some-model')).toThrow(
        'API key is required for other-provider some-model'
      )
    }
  )

  it.concurrent(
    'should require user key for models NOT in hosted list even if provider matches',
    () => {
      isHostedSpy.mockReturnValue(true)

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
    }
  )

  it.concurrent('should return empty for ollama provider without requiring API key', () => {
    isHostedSpy.mockReturnValue(false)

    const key = getApiKey('ollama', 'llama2')
    expect(key).toBe('empty')

    const key2 = getApiKey('ollama', 'codellama', 'user-key')
    expect(key2).toBe('empty')
  })

  it.concurrent(
    'should return empty or user-provided key for vllm provider without requiring API key',
    () => {
      isHostedSpy.mockReturnValue(false)

      const key = getApiKey('vllm', 'vllm/qwen-3')
      expect(key).toBe('empty')

      const key2 = getApiKey('vllm', 'vllm/llama', 'user-key')
      expect(key2).toBe('user-key')
    }
  )
})

describe('Model Capabilities', () => {
  describe('supportsTemperature', () => {
    it.concurrent('should return true for models that support temperature', () => {
      const supportedModels = [
        'gpt-4o',
        'gpt-4.1',
        'gpt-4.1-mini',
        'gpt-4.1-nano',
        'gpt-5-chat-latest',
        'azure/gpt-5-chat-latest',
        'gemini-2.5-flash',
        'claude-sonnet-4-0',
        'claude-opus-4-0',
        'claude-3-7-sonnet-latest',
        'grok-3-latest',
        'grok-3-fast-latest',
        'deepseek-v3',
      ]

      for (const model of supportedModels) {
        expect(supportsTemperature(model)).toBe(true)
      }
    })

    it.concurrent('should return false for models that do not support temperature', () => {
      const unsupportedModels = [
        'unsupported-model',
        'cerebras/llama-3.3-70b',
        'groq/meta-llama/llama-4-scout-17b-16e-instruct',
        'o1',
        'o3',
        'o4-mini',
        'azure/o3',
        'azure/o4-mini',
        'deepseek-r1',
        'deepseek-chat',
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

    it.concurrent('should be case insensitive', () => {
      expect(supportsTemperature('GPT-4O')).toBe(true)
      expect(supportsTemperature('claude-sonnet-4-0')).toBe(true)
    })

    it.concurrent(
      'should inherit temperature support from provider for dynamically fetched models',
      () => {
        expect(supportsTemperature('openrouter/anthropic/claude-3.5-sonnet')).toBe(true)
        expect(supportsTemperature('openrouter/openai/gpt-4')).toBe(true)
      }
    )
  })

  describe('getMaxTemperature', () => {
    it.concurrent('should return 2 for models with temperature range 0-2', () => {
      const modelsRange02 = [
        'gpt-4o',
        'azure/gpt-4o',
        'gpt-5-chat-latest',
        'azure/gpt-5-chat-latest',
        'gemini-2.5-pro',
        'gemini-2.5-flash',
        'deepseek-v3',
      ]

      for (const model of modelsRange02) {
        expect(getMaxTemperature(model)).toBe(2)
      }
    })

    it.concurrent('should return 1 for models with temperature range 0-1', () => {
      const modelsRange01 = [
        'claude-sonnet-4-0',
        'claude-opus-4-0',
        'claude-3-7-sonnet-latest',
        'grok-3-latest',
        'grok-3-fast-latest',
      ]

      for (const model of modelsRange01) {
        expect(getMaxTemperature(model)).toBe(1)
      }
    })

    it.concurrent('should return undefined for models that do not support temperature', () => {
      expect(getMaxTemperature('unsupported-model')).toBeUndefined()
      expect(getMaxTemperature('cerebras/llama-3.3-70b')).toBeUndefined()
      expect(getMaxTemperature('groq/meta-llama/llama-4-scout-17b-16e-instruct')).toBeUndefined()
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

    it.concurrent('should be case insensitive', () => {
      expect(getMaxTemperature('GPT-4O')).toBe(2)
      expect(getMaxTemperature('CLAUDE-SONNET-4-0')).toBe(1)
    })

    it.concurrent(
      'should inherit max temperature from provider for dynamically fetched models',
      () => {
        expect(getMaxTemperature('openrouter/anthropic/claude-3.5-sonnet')).toBe(2)
        expect(getMaxTemperature('openrouter/openai/gpt-4')).toBe(2)
      }
    )
  })

  describe('supportsToolUsageControl', () => {
    it.concurrent('should return true for providers that support tool usage control', () => {
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

    it.concurrent(
      'should return false for providers that do not support tool usage control',
      () => {
        const unsupportedProviders = ['ollama', 'non-existent-provider']

        for (const provider of unsupportedProviders) {
          expect(supportsToolUsageControl(provider)).toBe(false)
        }
      }
    )
  })

  describe('supportsReasoningEffort', () => {
    it.concurrent('should return true for models with reasoning effort capability', () => {
      expect(supportsReasoningEffort('gpt-5')).toBe(true)
      expect(supportsReasoningEffort('gpt-5-mini')).toBe(true)
      expect(supportsReasoningEffort('gpt-5.1')).toBe(true)
      expect(supportsReasoningEffort('gpt-5.2')).toBe(true)
      expect(supportsReasoningEffort('o3')).toBe(true)
      expect(supportsReasoningEffort('o4-mini')).toBe(true)
      expect(supportsReasoningEffort('azure/gpt-5')).toBe(true)
      expect(supportsReasoningEffort('azure/o3')).toBe(true)
    })

    it.concurrent('should return false for models without reasoning effort capability', () => {
      expect(supportsReasoningEffort('gpt-4o')).toBe(false)
      expect(supportsReasoningEffort('gpt-4.1')).toBe(false)
      expect(supportsReasoningEffort('claude-sonnet-4-5')).toBe(false)
      expect(supportsReasoningEffort('claude-opus-4-6')).toBe(false)
      expect(supportsReasoningEffort('gemini-2.5-flash')).toBe(false)
      expect(supportsReasoningEffort('unknown-model')).toBe(false)
    })

    it.concurrent('should be case-insensitive', () => {
      expect(supportsReasoningEffort('GPT-5')).toBe(true)
      expect(supportsReasoningEffort('O3')).toBe(true)
      expect(supportsReasoningEffort('GPT-4O')).toBe(false)
    })
  })

  describe('supportsVerbosity', () => {
    it.concurrent('should return true for models with verbosity capability', () => {
      expect(supportsVerbosity('gpt-5')).toBe(true)
      expect(supportsVerbosity('gpt-5-mini')).toBe(true)
      expect(supportsVerbosity('gpt-5.1')).toBe(true)
      expect(supportsVerbosity('gpt-5.2')).toBe(true)
      expect(supportsVerbosity('azure/gpt-5')).toBe(true)
    })

    it.concurrent('should return false for models without verbosity capability', () => {
      expect(supportsVerbosity('gpt-4o')).toBe(false)
      expect(supportsVerbosity('o3')).toBe(false)
      expect(supportsVerbosity('o4-mini')).toBe(false)
      expect(supportsVerbosity('claude-sonnet-4-5')).toBe(false)
      expect(supportsVerbosity('unknown-model')).toBe(false)
    })

    it.concurrent('should be case-insensitive', () => {
      expect(supportsVerbosity('GPT-5')).toBe(true)
      expect(supportsVerbosity('GPT-4O')).toBe(false)
    })
  })

  describe('supportsThinking', () => {
    it.concurrent('should return true for models with thinking capability', () => {
      expect(supportsThinking('claude-opus-4-6')).toBe(true)
      expect(supportsThinking('claude-opus-4-5')).toBe(true)
      expect(supportsThinking('claude-sonnet-4-5')).toBe(true)
      expect(supportsThinking('claude-sonnet-4-0')).toBe(true)
      expect(supportsThinking('claude-haiku-4-5')).toBe(true)
      expect(supportsThinking('gemini-3-pro-preview')).toBe(true)
      expect(supportsThinking('gemini-3-flash-preview')).toBe(true)
    })

    it.concurrent('should return false for models without thinking capability', () => {
      expect(supportsThinking('gpt-4o')).toBe(false)
      expect(supportsThinking('gpt-5')).toBe(false)
      expect(supportsThinking('o3')).toBe(false)
      expect(supportsThinking('deepseek-v3')).toBe(false)
      expect(supportsThinking('unknown-model')).toBe(false)
    })

    it.concurrent('should be case-insensitive', () => {
      expect(supportsThinking('CLAUDE-OPUS-4-6')).toBe(true)
      expect(supportsThinking('GPT-4O')).toBe(false)
    })
  })

  describe('Model Constants', () => {
    it.concurrent('should have correct models in MODELS_TEMP_RANGE_0_2', () => {
      expect(MODELS_TEMP_RANGE_0_2).toContain('gpt-4o')
      expect(MODELS_TEMP_RANGE_0_2).toContain('gemini-2.5-flash')
      expect(MODELS_TEMP_RANGE_0_2).toContain('deepseek-v3')
      expect(MODELS_TEMP_RANGE_0_2).not.toContain('claude-sonnet-4-0')
    })

    it.concurrent('should have correct models in MODELS_TEMP_RANGE_0_1', () => {
      expect(MODELS_TEMP_RANGE_0_1).toContain('claude-sonnet-4-0')
      expect(MODELS_TEMP_RANGE_0_1).toContain('grok-3-latest')
      expect(MODELS_TEMP_RANGE_0_1).not.toContain('gpt-4o')
    })

    it.concurrent('should have correct providers in PROVIDERS_WITH_TOOL_USAGE_CONTROL', () => {
      expect(PROVIDERS_WITH_TOOL_USAGE_CONTROL).toContain('openai')
      expect(PROVIDERS_WITH_TOOL_USAGE_CONTROL).toContain('anthropic')
      expect(PROVIDERS_WITH_TOOL_USAGE_CONTROL).toContain('deepseek')
      expect(PROVIDERS_WITH_TOOL_USAGE_CONTROL).toContain('google')
      expect(PROVIDERS_WITH_TOOL_USAGE_CONTROL).not.toContain('ollama')
    })

    it.concurrent(
      'should combine both temperature ranges in MODELS_WITH_TEMPERATURE_SUPPORT',
      () => {
        expect(MODELS_WITH_TEMPERATURE_SUPPORT.length).toBe(
          MODELS_TEMP_RANGE_0_2.length + MODELS_TEMP_RANGE_0_1.length
        )
        expect(MODELS_WITH_TEMPERATURE_SUPPORT).toContain('gpt-4o')
        expect(MODELS_WITH_TEMPERATURE_SUPPORT).toContain('claude-sonnet-4-0')
      }
    )

    it.concurrent('should have correct models in MODELS_WITH_REASONING_EFFORT', () => {
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
      expect(MODELS_WITH_REASONING_EFFORT).not.toContain('azure/gpt-5-chat-latest')

      expect(MODELS_WITH_REASONING_EFFORT).not.toContain('gpt-4o')
      expect(MODELS_WITH_REASONING_EFFORT).not.toContain('claude-sonnet-4-0')
    })

    it.concurrent('should have correct models in MODELS_WITH_VERBOSITY', () => {
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
      expect(MODELS_WITH_VERBOSITY).not.toContain('azure/gpt-5-chat-latest')

      expect(MODELS_WITH_VERBOSITY).not.toContain('o1')
      expect(MODELS_WITH_VERBOSITY).not.toContain('o3')
      expect(MODELS_WITH_VERBOSITY).not.toContain('o4-mini')

      expect(MODELS_WITH_VERBOSITY).not.toContain('gpt-4o')
      expect(MODELS_WITH_VERBOSITY).not.toContain('claude-sonnet-4-0')
    })

    it.concurrent('should have correct models in MODELS_WITH_THINKING', () => {
      expect(MODELS_WITH_THINKING).toContain('claude-opus-4-6')
      expect(MODELS_WITH_THINKING).toContain('claude-opus-4-5')
      expect(MODELS_WITH_THINKING).toContain('claude-opus-4-1')
      expect(MODELS_WITH_THINKING).toContain('claude-opus-4-0')
      expect(MODELS_WITH_THINKING).toContain('claude-sonnet-4-5')
      expect(MODELS_WITH_THINKING).toContain('claude-sonnet-4-0')

      expect(MODELS_WITH_THINKING).toContain('gemini-3-pro-preview')
      expect(MODELS_WITH_THINKING).toContain('gemini-3-flash-preview')

      expect(MODELS_WITH_THINKING).toContain('claude-haiku-4-5')

      expect(MODELS_WITH_THINKING).not.toContain('gpt-4o')
      expect(MODELS_WITH_THINKING).not.toContain('gpt-5')
      expect(MODELS_WITH_THINKING).not.toContain('o3')
    })

    it.concurrent('should have GPT-5 models in both reasoning effort and verbosity arrays', () => {
      const gpt5ModelsWithReasoningEffort = MODELS_WITH_REASONING_EFFORT.filter(
        (m) => m.includes('gpt-5') && !m.includes('chat-latest')
      )
      const gpt5ModelsWithVerbosity = MODELS_WITH_VERBOSITY.filter(
        (m) => m.includes('gpt-5') && !m.includes('chat-latest')
      )
      expect(gpt5ModelsWithReasoningEffort.sort()).toEqual(gpt5ModelsWithVerbosity.sort())

      expect(MODELS_WITH_REASONING_EFFORT).toContain('o1')
      expect(MODELS_WITH_VERBOSITY).not.toContain('o1')
    })
  })
  describe('Reasoning Effort Values Per Model', () => {
    it.concurrent('should return correct values for GPT-5.2', () => {
      const values = getReasoningEffortValuesForModel('gpt-5.2')
      expect(values).toBeDefined()
      expect(values).toContain('none')
      expect(values).toContain('low')
      expect(values).toContain('medium')
      expect(values).toContain('high')
      expect(values).toContain('xhigh')
      expect(values).not.toContain('minimal')
    })

    it.concurrent('should return correct values for GPT-5', () => {
      const values = getReasoningEffortValuesForModel('gpt-5')
      expect(values).toBeDefined()
      expect(values).toContain('minimal')
      expect(values).toContain('low')
      expect(values).toContain('medium')
      expect(values).toContain('high')
    })

    it.concurrent('should return correct values for o-series models', () => {
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

    it.concurrent('should return null for non-reasoning models', () => {
      expect(getReasoningEffortValuesForModel('gpt-4o')).toBeNull()
      expect(getReasoningEffortValuesForModel('claude-sonnet-4-5')).toBeNull()
      expect(getReasoningEffortValuesForModel('gemini-2.5-flash')).toBeNull()
    })

    it.concurrent('should return correct values for Azure GPT-5.2', () => {
      const values = getReasoningEffortValuesForModel('azure/gpt-5.2')
      expect(values).toBeDefined()
      expect(values).not.toContain('minimal')
      expect(values).toContain('xhigh')
    })
  })

  describe('Verbosity Values Per Model', () => {
    it.concurrent('should return correct values for GPT-5 family', () => {
      for (const model of ['gpt-5.2', 'gpt-5.1', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano']) {
        const values = getVerbosityValuesForModel(model)
        expect(values).toBeDefined()
        expect(values).toContain('low')
        expect(values).toContain('medium')
        expect(values).toContain('high')
      }
    })

    it.concurrent('should return null for o-series models', () => {
      expect(getVerbosityValuesForModel('o1')).toBeNull()
      expect(getVerbosityValuesForModel('o3')).toBeNull()
      expect(getVerbosityValuesForModel('o4-mini')).toBeNull()
    })

    it.concurrent('should return null for non-reasoning models', () => {
      expect(getVerbosityValuesForModel('gpt-4o')).toBeNull()
      expect(getVerbosityValuesForModel('claude-sonnet-4-5')).toBeNull()
    })
  })

  describe('Thinking Levels Per Model', () => {
    it.concurrent('should return correct levels for Claude Opus 4.6 (adaptive)', () => {
      const levels = getThinkingLevelsForModel('claude-opus-4-6')
      expect(levels).toBeDefined()
      expect(levels).toContain('low')
      expect(levels).toContain('medium')
      expect(levels).toContain('high')
      expect(levels).toContain('max')
    })

    it.concurrent('should return correct levels for other Claude models (budget_tokens)', () => {
      for (const model of ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-sonnet-4-0']) {
        const levels = getThinkingLevelsForModel(model)
        expect(levels).toBeDefined()
        expect(levels).toContain('low')
        expect(levels).toContain('medium')
        expect(levels).toContain('high')
        expect(levels).not.toContain('max')
      }
    })

    it.concurrent('should return correct levels for Gemini 3 models', () => {
      const proLevels = getThinkingLevelsForModel('gemini-3-pro-preview')
      expect(proLevels).toBeDefined()
      expect(proLevels).toContain('low')
      expect(proLevels).toContain('high')

      const flashLevels = getThinkingLevelsForModel('gemini-3-flash-preview')
      expect(flashLevels).toBeDefined()
      expect(flashLevels).toContain('minimal')
      expect(flashLevels).toContain('low')
      expect(flashLevels).toContain('medium')
      expect(flashLevels).toContain('high')
    })

    it.concurrent('should return correct levels for Claude Haiku 4.5', () => {
      const levels = getThinkingLevelsForModel('claude-haiku-4-5')
      expect(levels).toBeDefined()
      expect(levels).toContain('low')
      expect(levels).toContain('medium')
      expect(levels).toContain('high')
    })

    it.concurrent('should return null for non-thinking models', () => {
      expect(getThinkingLevelsForModel('gpt-4o')).toBeNull()
      expect(getThinkingLevelsForModel('gpt-5')).toBeNull()
      expect(getThinkingLevelsForModel('o3')).toBeNull()
    })
  })
})

describe('Max Output Tokens', () => {
  describe('getMaxOutputTokensForModel', () => {
    it.concurrent('should return correct max for Claude Opus 4.6', () => {
      expect(getMaxOutputTokensForModel('claude-opus-4-6')).toBe(128000)
    })

    it.concurrent('should return correct max for Claude Sonnet 4.5', () => {
      expect(getMaxOutputTokensForModel('claude-sonnet-4-5')).toBe(64000)
    })

    it.concurrent('should return correct max for Claude Opus 4.1', () => {
      expect(getMaxOutputTokensForModel('claude-opus-4-1')).toBe(64000)
    })

    it.concurrent('should return standard default for models without maxOutputTokens', () => {
      expect(getMaxOutputTokensForModel('gpt-4o')).toBe(4096)
    })

    it.concurrent('should return standard default for unknown models', () => {
      expect(getMaxOutputTokensForModel('unknown-model')).toBe(4096)
    })
  })
})

describe('Model Pricing Validation', () => {
  it.concurrent('should have correct pricing for key Anthropic models', () => {
    const opus46 = getModelPricing('claude-opus-4-6')
    expect(opus46).toBeDefined()
    expect(opus46.input).toBe(5.0)
    expect(opus46.output).toBe(25.0)

    const sonnet45 = getModelPricing('claude-sonnet-4-5')
    expect(sonnet45).toBeDefined()
    expect(sonnet45.input).toBe(3.0)
    expect(sonnet45.output).toBe(15.0)
  })

  it.concurrent('should have correct pricing for key OpenAI models', () => {
    const gpt4o = getModelPricing('gpt-4o')
    expect(gpt4o).toBeDefined()
    expect(gpt4o.input).toBe(2.5)
    expect(gpt4o.output).toBe(10.0)

    const o3 = getModelPricing('o3')
    expect(o3).toBeDefined()
    expect(o3.input).toBe(2.0)
    expect(o3.output).toBe(8.0)
  })

  it.concurrent('should have correct pricing for Azure OpenAI o3', () => {
    const azureO3 = getModelPricing('azure/o3')
    expect(azureO3).toBeDefined()
    expect(azureO3.input).toBe(2.0)
    expect(azureO3.output).toBe(8.0)
  })

  it.concurrent('should return null for unknown models', () => {
    expect(getModelPricing('unknown-model')).toBeNull()
  })
})

describe('Context Window Validation', () => {
  it.concurrent('should have correct context windows for key models', () => {
    const allModels = getAllModels()

    expect(allModels).toContain('gpt-5-chat-latest')

    expect(allModels).toContain('o3')
    expect(allModels).toContain('o4-mini')
  })
})

describe('Cost Calculation', () => {
  describe('calculateCost', () => {
    it.concurrent('should calculate cost correctly for known models', () => {
      const result = calculateCost('gpt-4o', 1000, 500, false)

      expect(result.input).toBeGreaterThan(0)
      expect(result.output).toBeGreaterThan(0)
      expect(result.total).toBeCloseTo(result.input + result.output, 6)
      expect(result.pricing).toBeDefined()
      expect(result.pricing.input).toBe(2.5)
    })

    it.concurrent('should handle cached input pricing when enabled', () => {
      const regularCost = calculateCost('gpt-4o', 1000, 500, false)
      const cachedCost = calculateCost('gpt-4o', 1000, 500, true)

      expect(cachedCost.input).toBeLessThan(regularCost.input)
      expect(cachedCost.output).toBe(regularCost.output)
    })

    it.concurrent('should return default pricing for unknown models', () => {
      const result = calculateCost('unknown-model', 1000, 500, false)

      expect(result.input).toBe(0)
      expect(result.output).toBe(0)
      expect(result.total).toBe(0)
      expect(result.pricing.input).toBe(1.0)
    })

    it.concurrent('should handle zero tokens', () => {
      const result = calculateCost('gpt-4o', 0, 0, false)

      expect(result.input).toBe(0)
      expect(result.output).toBe(0)
      expect(result.total).toBe(0)
    })
  })

  describe('formatCost', () => {
    it.concurrent('should format costs >= $1 with two decimal places', () => {
      expect(formatCost(1.234)).toBe('$1.23')
      expect(formatCost(10.567)).toBe('$10.57')
    })

    it.concurrent('should format costs between 1¢ and $1 with three decimal places', () => {
      expect(formatCost(0.0234)).toBe('$0.023')
      expect(formatCost(0.1567)).toBe('$0.157')
    })

    it.concurrent('should format costs between 0.1¢ and 1¢ with four decimal places', () => {
      expect(formatCost(0.00234)).toBe('$0.0023')
      expect(formatCost(0.00567)).toBe('$0.0057')
    })

    it.concurrent('should format very small costs with appropriate precision', () => {
      expect(formatCost(0.000234)).toContain('$0.000234')
    })

    it.concurrent('should handle zero cost', () => {
      expect(formatCost(0)).toBe('$0')
    })

    it.concurrent('should handle undefined/null costs', () => {
      expect(formatCost(undefined as any)).toBe('—')
      expect(formatCost(null as any)).toBe('—')
    })
  })
})

describe('getHostedModels', () => {
  it.concurrent('should return OpenAI, Anthropic, and Google models as hosted', () => {
    const hostedModels = getHostedModels()

    expect(hostedModels).toContain('gpt-4o')
    expect(hostedModels).toContain('o1')

    expect(hostedModels).toContain('claude-sonnet-4-0')
    expect(hostedModels).toContain('claude-opus-4-0')

    expect(hostedModels).toContain('gemini-2.5-pro')
    expect(hostedModels).toContain('gemini-2.5-flash')

    expect(hostedModels).not.toContain('deepseek-v3')
    expect(hostedModels).not.toContain('grok-4-latest')
  })

  it.concurrent('should return an array of strings', () => {
    const hostedModels = getHostedModels()

    expect(Array.isArray(hostedModels)).toBe(true)
    expect(hostedModels.length).toBeGreaterThan(0)
    hostedModels.forEach((model) => {
      expect(typeof model).toBe('string')
    })
  })
})

describe('shouldBillModelUsage', () => {
  it.concurrent('should return true for exact matches of hosted models', () => {
    expect(shouldBillModelUsage('gpt-4o')).toBe(true)
    expect(shouldBillModelUsage('o1')).toBe(true)

    expect(shouldBillModelUsage('claude-sonnet-4-0')).toBe(true)
    expect(shouldBillModelUsage('claude-opus-4-0')).toBe(true)

    expect(shouldBillModelUsage('gemini-2.5-pro')).toBe(true)
    expect(shouldBillModelUsage('gemini-2.5-flash')).toBe(true)
  })

  it.concurrent('should return false for non-hosted models', () => {
    expect(shouldBillModelUsage('deepseek-v3')).toBe(false)
    expect(shouldBillModelUsage('grok-4-latest')).toBe(false)

    expect(shouldBillModelUsage('unknown-model')).toBe(false)
  })

  it.concurrent('should return false for versioned model names not in hosted list', () => {
    expect(shouldBillModelUsage('claude-sonnet-4-20250514')).toBe(false)
    expect(shouldBillModelUsage('gpt-4o-2024-08-06')).toBe(false)
    expect(shouldBillModelUsage('claude-3-5-sonnet-20241022')).toBe(false)
  })

  it.concurrent('should be case insensitive', () => {
    expect(shouldBillModelUsage('GPT-4O')).toBe(true)
    expect(shouldBillModelUsage('Claude-Sonnet-4-0')).toBe(true)
    expect(shouldBillModelUsage('GEMINI-2.5-PRO')).toBe(true)
  })

  it.concurrent('should not match partial model names', () => {
    expect(shouldBillModelUsage('gpt-4')).toBe(false)
    expect(shouldBillModelUsage('claude-sonnet')).toBe(false)
    expect(shouldBillModelUsage('gemini')).toBe(false)
  })
})

describe('Provider Management', () => {
  describe('getProviderFromModel', () => {
    it.concurrent('should return correct provider for known models', () => {
      expect(getProviderFromModel('gpt-4o')).toBe('openai')
      expect(getProviderFromModel('claude-sonnet-4-0')).toBe('anthropic')
      expect(getProviderFromModel('gemini-2.5-pro')).toBe('google')
      expect(getProviderFromModel('azure/gpt-4o')).toBe('azure-openai')
    })

    it.concurrent('should use model patterns for pattern matching', () => {
      expect(getProviderFromModel('gpt-5-custom')).toBe('openai')
      expect(getProviderFromModel('claude-custom-model')).toBe('anthropic')
    })

    it.concurrent('should default to ollama for unknown models', () => {
      expect(getProviderFromModel('unknown-model')).toBe('ollama')
    })

    it.concurrent('should be case insensitive', () => {
      expect(getProviderFromModel('GPT-4O')).toBe('openai')
      expect(getProviderFromModel('CLAUDE-SONNET-4-0')).toBe('anthropic')
    })
  })

  describe('getProvider', () => {
    it.concurrent('should return provider config for valid provider IDs', () => {
      const openaiProvider = getProvider('openai')
      expect(openaiProvider).toBeDefined()
      expect(openaiProvider?.id).toBe('openai')
      expect(openaiProvider?.name).toBe('OpenAI')

      const anthropicProvider = getProvider('anthropic')
      expect(anthropicProvider).toBeDefined()
      expect(anthropicProvider?.id).toBe('anthropic')
    })

    it.concurrent('should handle provider/service format', () => {
      const provider = getProvider('openai/chat')
      expect(provider).toBeDefined()
      expect(provider?.id).toBe('openai')
    })

    it.concurrent('should return undefined for invalid provider IDs', () => {
      expect(getProvider('nonexistent')).toBeUndefined()
    })
  })

  describe('getProviderConfigFromModel', () => {
    it.concurrent('should return provider config for model', () => {
      const config = getProviderConfigFromModel('gpt-4o')
      expect(config).toBeDefined()
      expect(config?.id).toBe('openai')

      const anthropicConfig = getProviderConfigFromModel('claude-sonnet-4-0')
      expect(anthropicConfig).toBeDefined()
      expect(anthropicConfig?.id).toBe('anthropic')
    })
  })

  describe('getAllModels', () => {
    it.concurrent('should return all models from all providers', () => {
      const allModels = getAllModels()
      expect(Array.isArray(allModels)).toBe(true)
      expect(allModels.length).toBeGreaterThan(0)

      expect(allModels).toContain('gpt-4o')
      expect(allModels).toContain('claude-sonnet-4-0')
      expect(allModels).toContain('gemini-2.5-pro')
    })
  })

  describe('getAllProviderIds', () => {
    it.concurrent('should return all provider IDs', () => {
      const providerIds = getAllProviderIds()
      expect(Array.isArray(providerIds)).toBe(true)
      expect(providerIds).toContain('openai')
      expect(providerIds).toContain('anthropic')
      expect(providerIds).toContain('google')
      expect(providerIds).toContain('azure-openai')
    })
  })

  describe('getProviderModels', () => {
    it.concurrent('should return models for specific providers', () => {
      const openaiModels = getProviderModels('openai')
      expect(Array.isArray(openaiModels)).toBe(true)
      expect(openaiModels).toContain('gpt-4o')
      expect(openaiModels).toContain('o1')

      const anthropicModels = getProviderModels('anthropic')
      expect(anthropicModels).toContain('claude-sonnet-4-0')
      expect(anthropicModels).toContain('claude-opus-4-0')
    })

    it.concurrent('should return empty array for unknown providers', () => {
      const unknownModels = getProviderModels('unknown' as any)
      expect(unknownModels).toEqual([])
    })
  })

  describe('getBaseModelProviders and getAllModelProviders', () => {
    it.concurrent('should return model to provider mapping', () => {
      const allProviders = getAllModelProviders()
      expect(typeof allProviders).toBe('object')
      expect(allProviders['gpt-4o']).toBe('openai')
      expect(allProviders['claude-sonnet-4-0']).toBe('anthropic')

      const baseProviders = getBaseModelProviders()
      expect(typeof baseProviders).toBe('object')
    })
  })

  describe('updateOllamaProviderModels', () => {
    it.concurrent('should update ollama models', () => {
      const mockModels = ['llama2', 'codellama', 'mistral']

      expect(() => updateOllamaProviderModels(mockModels)).not.toThrow()

      const ollamaModels = getProviderModels('ollama')
      expect(ollamaModels).toEqual(mockModels)
    })
  })
})

describe('JSON and Structured Output', () => {
  describe('extractAndParseJSON', () => {
    it.concurrent('should extract and parse valid JSON', () => {
      const content = 'Some text before ```json\n{"key": "value"}\n``` some text after'
      const result = extractAndParseJSON(content)
      expect(result).toEqual({ key: 'value' })
    })

    it.concurrent('should extract JSON without code blocks', () => {
      const content = 'Text before {"name": "test", "value": 42} text after'
      const result = extractAndParseJSON(content)
      expect(result).toEqual({ name: 'test', value: 42 })
    })

    it.concurrent('should handle nested objects', () => {
      const content = '{"user": {"name": "John", "age": 30}, "active": true}'
      const result = extractAndParseJSON(content)
      expect(result).toEqual({
        user: { name: 'John', age: 30 },
        active: true,
      })
    })

    it.concurrent('should clean up common JSON issues', () => {
      const content = '{\n  "key": "value",\n  "number": 42,\n}'
      const result = extractAndParseJSON(content)
      expect(result).toEqual({ key: 'value', number: 42 })
    })

    it.concurrent('should throw error for content without JSON', () => {
      expect(() => extractAndParseJSON('No JSON here')).toThrow('No JSON object found in content')
    })

    it.concurrent('should throw error for invalid JSON', () => {
      const invalidJson = '{"key": invalid, "broken": }'
      expect(() => extractAndParseJSON(invalidJson)).toThrow('Failed to parse JSON after cleanup')
    })
  })

  describe('generateStructuredOutputInstructions', () => {
    it.concurrent('should return empty string for JSON Schema format', () => {
      const schemaFormat = {
        schema: {
          type: 'object',
          properties: { key: { type: 'string' } },
        },
      }
      expect(generateStructuredOutputInstructions(schemaFormat)).toBe('')
    })

    it.concurrent('should return empty string for object type with properties', () => {
      const objectFormat = {
        type: 'object',
        properties: { key: { type: 'string' } },
      }
      expect(generateStructuredOutputInstructions(objectFormat)).toBe('')
    })

    it.concurrent('should generate instructions for legacy fields format', () => {
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

    it.concurrent('should handle object fields with properties', () => {
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

    it.concurrent('should return empty string for missing fields', () => {
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

    it.concurrent('should return early for no tools', () => {
      const result = prepareToolsWithUsageControl(undefined, undefined, mockLogger)

      expect(result.tools).toBeUndefined()
      expect(result.toolChoice).toBeUndefined()
      expect(result.hasFilteredTools).toBe(false)
      expect(result.forcedTools).toEqual([])
    })

    it.concurrent('should filter out tools with usageControl="none"', () => {
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

    it.concurrent('should set toolChoice for forced tools (OpenAI format)', () => {
      const tools = [{ function: { name: 'forcedTool' } }]
      const providerTools = [{ id: 'forcedTool', usageControl: 'force' }]

      const result = prepareToolsWithUsageControl(tools, providerTools, mockLogger)

      expect(result.toolChoice).toEqual({
        type: 'function',
        function: { name: 'forcedTool' },
      })
    })

    it.concurrent('should set toolChoice for forced tools (Anthropic format)', () => {
      const tools = [{ function: { name: 'forcedTool' } }]
      const providerTools = [{ id: 'forcedTool', usageControl: 'force' }]

      const result = prepareToolsWithUsageControl(tools, providerTools, mockLogger, 'anthropic')

      expect(result.toolChoice).toEqual({
        type: 'tool',
        name: 'forcedTool',
      })
    })

    it.concurrent('should set toolConfig for Google format', () => {
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

    it.concurrent('should return empty when all tools are filtered', () => {
      const tools = [{ function: { name: 'tool1' } }]
      const providerTools = [{ id: 'tool1', usageControl: 'none' }]

      const result = prepareToolsWithUsageControl(tools, providerTools, mockLogger)

      expect(result.tools).toBeUndefined()
      expect(result.toolChoice).toBeUndefined()
      expect(result.hasFilteredTools).toBe(true)
    })

    it.concurrent('should default to auto when no forced tools', () => {
      const tools = [{ function: { name: 'tool1' } }]
      const providerTools = [{ id: 'tool1', usageControl: 'auto' }]

      const result = prepareToolsWithUsageControl(tools, providerTools, mockLogger)

      expect(result.toolChoice).toBe('auto')
    })
  })
})

describe('prepareToolExecution', () => {
  describe('basic parameter merging', () => {
    it.concurrent('should merge LLM args with user params', () => {
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

    it.concurrent('should filter out empty string user params', () => {
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
  })

  describe('inputMapping deep merge for workflow tools', () => {
    it.concurrent('should deep merge inputMapping when user provides empty object', () => {
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

    it.concurrent('should deep merge inputMapping with partial user values', () => {
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

    it.concurrent('should preserve non-empty user inputMapping values', () => {
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

    it.concurrent('should handle inputMapping as object (not JSON string)', () => {
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

    it.concurrent('should use LLM inputMapping when user does not provide it', () => {
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

    it.concurrent('should use user inputMapping when LLM does not provide it', () => {
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

    it.concurrent('should handle invalid JSON in user inputMapping gracefully', () => {
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

    it.concurrent('should not affect other parameters - normal override behavior', () => {
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

    it.concurrent('should preserve 0 and false as valid user values in inputMapping', () => {
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
    it.concurrent('should include workflow context in executionParams', () => {
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

    it.concurrent('should include environment and workflow variables', () => {
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
    it.concurrent('should return false when no providers are blacklisted', () => {
      expect(isProviderBlacklisted('openai')).toBe(false)
      expect(isProviderBlacklisted('anthropic')).toBe(false)
    })
  })

  describe('filterBlacklistedModels', () => {
    it.concurrent('should return all models when no blacklist is set', () => {
      const models = ['gpt-4o', 'claude-sonnet-4-5', 'gemini-2.5-pro']
      const result = filterBlacklistedModels(models)
      expect(result).toEqual(models)
    })

    it.concurrent('should return empty array for empty input', () => {
      const result = filterBlacklistedModels([])
      expect(result).toEqual([])
    })
  })

  describe('getBaseModelProviders blacklist filtering', () => {
    it.concurrent('should return providers when no blacklist is set', () => {
      const providers = getBaseModelProviders()
      expect(Object.keys(providers).length).toBeGreaterThan(0)
      expect(providers['gpt-4o']).toBe('openai')
      expect(providers['claude-sonnet-4-5']).toBe('anthropic')
    })
  })

  describe('getProviderFromModel execution-time enforcement', () => {
    it.concurrent('should return provider for non-blacklisted models', () => {
      expect(getProviderFromModel('gpt-4o')).toBe('openai')
      expect(getProviderFromModel('claude-sonnet-4-5')).toBe('anthropic')
    })

    it.concurrent('should be case insensitive', () => {
      expect(getProviderFromModel('GPT-4O')).toBe('openai')
      expect(getProviderFromModel('CLAUDE-SONNET-4-5')).toBe('anthropic')
    })
  })
})
