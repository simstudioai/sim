import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as environmentModule from '@/lib/environment'
import {
  calculateCost,
  extractAndParseJSON,
  formatCost,
  generateStructuredOutputInstructions,
  getAllModelProviders,
  getAllModels,
  getAllProviderIds,
  getApiKey,
  getBaseModelProviders,
  getCustomTools,
  getHostedModels,
  getMaxTemperature,
  getProvider,
  getProviderConfigFromModel,
  getProviderFromModel,
  getProviderModels,
  MODELS_TEMP_RANGE_0_1,
  MODELS_TEMP_RANGE_0_2,
  MODELS_WITH_TEMPERATURE_SUPPORT,
  PROVIDERS_WITH_TOOL_USAGE_CONTROL,
  prepareToolsWithUsageControl,
  supportsTemperature,
  supportsToolUsageControl,
  transformCustomTool,
  updateOllamaProviderModels,
} from './utils'

const isHostedSpy = vi.spyOn(environmentModule, 'isHosted', 'get')
const mockGetRotatingApiKey = vi.fn().mockReturnValue('rotating-server-key')
const originalRequire = module.require

describe('getApiKey', () => {
  // Save original env and reset between tests
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

  it('should return user-provided key when not in hosted environment', () => {
    isHostedSpy.mockReturnValue(false)

    // For OpenAI
    const key1 = getApiKey('openai', 'gpt-4', 'user-key-openai')
    expect(key1).toBe('user-key-openai')

    // For Anthropic
    const key2 = getApiKey('anthropic', 'claude-3', 'user-key-anthropic')
    expect(key2).toBe('user-key-anthropic')
  })

  it('should throw error if no key provided in non-hosted environment', () => {
    isHostedSpy.mockReturnValue(false)

    expect(() => getApiKey('openai', 'gpt-4')).toThrow('API key is required for openai gpt-4')
    expect(() => getApiKey('anthropic', 'claude-3')).toThrow(
      'API key is required for anthropic claude-3'
    )
  })

  it('should fall back to user key in hosted environment if rotation fails', () => {
    isHostedSpy.mockReturnValue(true)

    module.require = vi.fn(() => {
      throw new Error('Rotation failed')
    })

    const key = getApiKey('openai', 'gpt-4', 'user-fallback-key')
    expect(key).toBe('user-fallback-key')
  })

  it('should throw error in hosted environment if rotation fails and no user key', () => {
    isHostedSpy.mockReturnValue(true)

    module.require = vi.fn(() => {
      throw new Error('Rotation failed')
    })

    expect(() => getApiKey('openai', 'gpt-4')).toThrow('No API key available for openai gpt-4')
  })

  it('should require user key for non-OpenAI/Anthropic providers even in hosted environment', () => {
    isHostedSpy.mockReturnValue(true)

    const key = getApiKey('other-provider', 'some-model', 'user-key')
    expect(key).toBe('user-key')

    expect(() => getApiKey('other-provider', 'some-model')).toThrow(
      'API key is required for other-provider some-model'
    )
  })
})

describe('Model Capabilities', () => {
  describe('supportsTemperature', () => {
    it.concurrent('should return true for models that support temperature', () => {
      const supportedModels = [
        'gpt-4o',
        'gpt-4.1',
        'gpt-4.1-mini',
        'gpt-4.1-nano',
        'gemini-2.5-flash',
        'claude-sonnet-4-0',
        'claude-opus-4-0',
        'claude-3-7-sonnet-latest',
        'claude-3-5-sonnet-latest',
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
        'cerebras/llama-3.3-70b', // Cerebras models don't have temperature defined
        'groq/meta-llama/llama-4-scout-17b-16e-instruct', // Groq models don't have temperature defined
        // Reasoning models that don't support temperature
        'o1',
        'o3',
        'o4-mini',
        'azure/o3',
        'azure/o4-mini',
        'deepseek-r1',
        // Chat models that don't support temperature
        'deepseek-chat',
        'azure/gpt-4.1',
        'azure/model-router',
      ]

      for (const model of unsupportedModels) {
        expect(supportsTemperature(model)).toBe(false)
      }
    })

    it.concurrent('should be case insensitive', () => {
      expect(supportsTemperature('GPT-4O')).toBe(true)
      expect(supportsTemperature('claude-sonnet-4-0')).toBe(true)
    })
  })

  describe('getMaxTemperature', () => {
    it.concurrent('should return 2 for models with temperature range 0-2', () => {
      const modelsRange02 = [
        'gpt-4o',
        'azure/gpt-4o',
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
        'claude-3-5-sonnet-latest',
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
      // Reasoning models that don't support temperature
      expect(getMaxTemperature('o1')).toBeUndefined()
      expect(getMaxTemperature('o3')).toBeUndefined()
      expect(getMaxTemperature('o4-mini')).toBeUndefined()
      expect(getMaxTemperature('azure/o3')).toBeUndefined()
      expect(getMaxTemperature('azure/o4-mini')).toBeUndefined()
      expect(getMaxTemperature('deepseek-r1')).toBeUndefined()
    })

    it.concurrent('should be case insensitive', () => {
      expect(getMaxTemperature('GPT-4O')).toBe(2)
      expect(getMaxTemperature('CLAUDE-SONNET-4-0')).toBe(1)
    })
  })

  describe('supportsToolUsageControl', () => {
    it.concurrent('should return true for providers that support tool usage control', () => {
      const supportedProviders = [
        'openai',
        'azure-openai',
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
        const unsupportedProviders = ['ollama', 'cerebras', 'groq', 'non-existent-provider']

        for (const provider of unsupportedProviders) {
          expect(supportsToolUsageControl(provider)).toBe(false)
        }
      }
    )
  })

  describe('Model Constants', () => {
    it.concurrent('should have correct models in MODELS_TEMP_RANGE_0_2', () => {
      expect(MODELS_TEMP_RANGE_0_2).toContain('gpt-4o')
      expect(MODELS_TEMP_RANGE_0_2).toContain('gemini-2.5-flash')
      expect(MODELS_TEMP_RANGE_0_2).toContain('deepseek-v3')
      expect(MODELS_TEMP_RANGE_0_2).not.toContain('claude-sonnet-4-0') // Should be in 0-1 range
    })

    it.concurrent('should have correct models in MODELS_TEMP_RANGE_0_1', () => {
      expect(MODELS_TEMP_RANGE_0_1).toContain('claude-sonnet-4-0')
      expect(MODELS_TEMP_RANGE_0_1).toContain('grok-3-latest')
      expect(MODELS_TEMP_RANGE_0_1).not.toContain('gpt-4o') // Should be in 0-2 range
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
        expect(MODELS_WITH_TEMPERATURE_SUPPORT).toContain('gpt-4o') // From 0-2 range
        expect(MODELS_WITH_TEMPERATURE_SUPPORT).toContain('claude-sonnet-4-0') // From 0-1 range
      }
    )
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
      expect(result.pricing.input).toBe(2.5) // GPT-4o pricing
    })

    it.concurrent('should handle cached input pricing when enabled', () => {
      const regularCost = calculateCost('gpt-4o', 1000, 500, false)
      const cachedCost = calculateCost('gpt-4o', 1000, 500, true)

      expect(cachedCost.input).toBeLessThan(regularCost.input)
      expect(cachedCost.output).toBe(regularCost.output) // Output cost should be same
    })

    it.concurrent('should return default pricing for unknown models', () => {
      const result = calculateCost('unknown-model', 1000, 500, false)

      expect(result.input).toBe(0)
      expect(result.output).toBe(0)
      expect(result.total).toBe(0)
      expect(result.pricing.input).toBe(1.0) // Default pricing
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
  it.concurrent('should return OpenAI and Anthropic models as hosted', () => {
    const hostedModels = getHostedModels()

    expect(hostedModels).toContain('gpt-4o')
    expect(hostedModels).toContain('claude-sonnet-4-0')
    expect(hostedModels).toContain('o1')
    expect(hostedModels).toContain('claude-opus-4-0')

    // Should not contain models from other providers
    expect(hostedModels).not.toContain('gemini-2.5-pro')
    expect(hostedModels).not.toContain('deepseek-v3')
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

describe('Provider Management', () => {
  describe('getProviderFromModel', () => {
    it.concurrent('should return correct provider for known models', () => {
      expect(getProviderFromModel('gpt-4o')).toBe('openai')
      expect(getProviderFromModel('claude-sonnet-4-0')).toBe('anthropic')
      expect(getProviderFromModel('gemini-2.5-pro')).toBe('google')
      expect(getProviderFromModel('azure/gpt-4o')).toBe('azure-openai')
    })

    it.concurrent('should use model patterns for pattern matching', () => {
      expect(getProviderFromModel('gpt-5-custom')).toBe('openai') // Matches /^gpt/ pattern
      expect(getProviderFromModel('claude-custom-model')).toBe('anthropic') // Matches /^claude/ pattern
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

      // Should contain models from different providers
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
      // Should exclude ollama models
    })
  })

  describe('updateOllamaProviderModels', () => {
    it.concurrent('should update ollama models', () => {
      const mockModels = ['llama2', 'codellama', 'mistral']

      // This should not throw
      expect(() => updateOllamaProviderModels(mockModels)).not.toThrow()

      // Verify the models were updated
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
      const content = '{\n  "key": "value",\n  "number": 42,\n}' // Trailing comma
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
  describe('transformCustomTool', () => {
    it.concurrent('should transform valid custom tool schema', () => {
      const customTool = {
        id: 'test-tool',
        schema: {
          function: {
            name: 'testFunction',
            description: 'A test function',
            parameters: {
              type: 'object',
              properties: {
                input: { type: 'string', description: 'Input parameter' },
              },
              required: ['input'],
            },
          },
        },
      }

      const result = transformCustomTool(customTool)

      expect(result.id).toBe('custom_test-tool')
      expect(result.name).toBe('testFunction')
      expect(result.description).toBe('A test function')
      expect(result.parameters.type).toBe('object')
      expect(result.parameters.properties).toBeDefined()
      expect(result.parameters.required).toEqual(['input'])
    })

    it.concurrent('should throw error for invalid schema', () => {
      const invalidTool = { id: 'test', schema: null }
      expect(() => transformCustomTool(invalidTool)).toThrow('Invalid custom tool schema')

      const noFunction = { id: 'test', schema: {} }
      expect(() => transformCustomTool(noFunction)).toThrow('Invalid custom tool schema')
    })
  })

  describe('getCustomTools', () => {
    it.concurrent('should return array of transformed custom tools', () => {
      const result = getCustomTools()
      expect(Array.isArray(result)).toBe(true)
    })
  })

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
