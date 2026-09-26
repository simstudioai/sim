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

import { RevenueCatBlock } from '@/blocks/blocks/revenuecat'
import { VideoGeneratorV3Block } from '@/blocks/blocks/video_generator'
import { normalizeFileInput } from '@/blocks/utils'
import { assignProviderToolIdentities } from '@/providers/tool-identity'
import type { ProviderToolConfig } from '@/providers/types'
import {
  buildBlockToolParamsTransform,
  calculateCost,
  describeModelLevel,
  extractAndParseJSON,
  findProviderFromModel,
  formatCost,
  generateStructuredOutputInstructions,
  getApiKey,
  getBaseModelProviders,
  getMaxOutputTokensForModel,
  getMaxTemperature,
  getProvider,
  getProviderFromModel,
  isGemini3Model,
  prepareToolExecution,
  prepareToolsWithUsageControl,
  shouldBillModelUsage,
  supportsTemperature,
  transformBlockTool,
} from '@/providers/utils'
import { useProvidersStore } from '@/stores/providers/store'
import { revenuecatGetCustomerTool } from '@/tools/revenuecat/get_customer'
import { falaiVideoTool } from '@/tools/video/falai'
import { runwayVideoTool } from '@/tools/video/runway'

const mockGetRotatingApiKey = vi.fn().mockReturnValue('rotating-server-key')
const originalRequire = module.require

afterAll(resetEnvFlagsMock)

describe('getApiKey', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
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

  it.each(['ollama', 'vllm', 'litellm'] as const)(
    'uses the routed cloud provider credentials despite a name collision in %s discovery',
    (localProvider) => {
      const originalProviders = useProvidersStore.getState().providers
      useProvidersStore.setState({
        providers: {
          ...originalProviders,
          [localProvider]: { ...originalProviders[localProvider], models: ['azure/MyDeployment'] },
        },
      })
      try {
        expect(getApiKey('azure-openai', 'azure/MyDeployment', 'azure-key')).toBe('azure-key')
        expect(() => getApiKey('azure-openai', 'azure/MyDeployment')).toThrow('API key is required')
      } finally {
        useProvidersStore.setState({ providers: originalProviders })
      }
    }
  )

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
    it('should inherit temperature support from provider for dynamically fetched models', () => {
      expect(supportsTemperature('openrouter/anthropic/claude-3.5-sonnet')).toBe(true)
      expect(supportsTemperature('openrouter/openai/gpt-4')).toBe(true)
    })
  })

  describe('getMaxTemperature', () => {
    it('should inherit max temperature from provider for dynamically fetched models', () => {
      expect(getMaxTemperature('openrouter/anthropic/claude-3.5-sonnet')).toBe(2)
      expect(getMaxTemperature('openrouter/openai/gpt-4')).toBe(2)
    })
  })
})

describe('Max Output Tokens', () => {
  describe('getMaxOutputTokensForModel', () => {
    it('should return standard default for models without maxOutputTokens', () => {
      expect(getMaxOutputTokensForModel('grok-4-latest')).toBe(4096)
    })

    it('should return standard default for unknown models', () => {
      expect(getMaxOutputTokensForModel('unknown-model')).toBe(4096)
    })
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

    it('should select pricing tiers from the full request input size', () => {
      const shortContext = calculateCost('gpt-5.6-terra', 272_000, 100_000)
      const longContext = calculateCost('gpt-5.6-terra', 272_001, 100_000)

      expect(shortContext).toMatchObject({ input: 0.544, output: 1.2, total: 1.744 })
      expect(longContext).toMatchObject({ input: 1.088004, output: 1.8, total: 2.888004 })
    })

    it.each([
      ['gemini-3.1-pro-preview', 2, 0.2, 12, 4, 0.4, 18],
      ['gemini-2.5-pro', 1.25, 0.125, 10, 2.5, 0.25, 15],
      ['grok-4.6', 2, 0.5, 6, 4, 1, 12],
    ])(
      'applies %s long-context rates only above 200k prompt tokens, including cached input',
      (model, input, cached, output, longInput, longCached, longOutput) => {
        const shortContext = calculateCost(model, 200_000, 100_000)
        const longContext = calculateCost(model, 200_001, 100_000)
        const shortCached = calculateCost(model, 200_000, 100_000, true)
        const longCachedCost = calculateCost(model, 200_001, 100_000, true)

        expect(shortContext.input).toBeCloseTo(input * 0.2, 10)
        expect(shortContext.output).toBeCloseTo(output * 0.1, 10)
        expect(longContext.input).toBeCloseTo((longInput * 200_001) / 1e6, 10)
        expect(longContext.output).toBeCloseTo(longOutput * 0.1, 10)
        expect(shortCached.input).toBeCloseTo(cached * 0.2, 10)
        expect(longCachedCost.input).toBeCloseTo((longCached * 200_001) / 1e6, 10)
      }
    )

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

describe('shouldBillModelUsage', () => {
  it('should return true for exact matches of hosted models', () => {
    expect(shouldBillModelUsage('gpt-6-astra')).toBe(true)
    expect(shouldBillModelUsage('gpt-6-sol')).toBe(true)
    expect(shouldBillModelUsage('gpt-6-luna')).toBe(true)
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
    it('should handle provider/service format', () => {
      const provider = getProvider('openai/chat')
      expect(provider).toBeDefined()
      expect(provider?.id).toBe('openai')
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
    workflowMetadataMocks.readWorkflowMetadataForTool.mockResolvedValue({
      name: 'Child Workflow',
      description: 'Child description',
    })
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
  it.each([
    ['azure/MyDeployment', 'azure-openai'],
    ['AZURE/MyDeployment', 'azure-openai'],
    ['azure-anthropic/MyDeployment', 'azure-anthropic'],
    ['bedrock/custom-inference-profile', 'bedrock'],
    ['vertex/publishers/google/models/custom-gemini', 'vertex'],
  ])('uses the declared provider namespace for %s', (model, provider) => {
    expect(findProviderFromModel(model)).toBe(provider)
    expect(getProviderFromModel(model)).toBe(provider)
    expect(shouldBillModelUsage(model)).toBe(false)
  })

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

describe('isGemini3Model', () => {
  it.each([
    'gemini-3.8-flash',
    'VERTEX/gemini-3.8-flash',
    'vertex/google/gemini-3.8-flash',
    'vertex/publishers/google/models/gemini-3.8-flash',
    'vertex/projects/test-project/locations/global/publishers/google/models/gemini-3.8-flash',
  ])('recognizes the Gemini family in %s', (model) => {
    expect(isGemini3Model(model)).toBe(true)
  })

  it.each([
    'vertex/gemini-2.5-pro',
    'vertex/custom-gemini-3-deployment',
    'vertex/publishers/another-provider/models/gemini-3.8-flash',
  ])('does not infer Gemini 3 behavior from %s', (model) => {
    expect(isGemini3Model(model)).toBe(false)
  })
})

describe('transformBlockTool configured selectors', () => {
  it.each([
    { apiKey: 'test-revenuecat-key' },
    { apiKey: 'test-revenuecat-key', appUserId: 'customer-1' },
  ])(
    'preserves the default operation with credentials but no configured selector',
    async (params) => {
      const result = await transformBlockTool(
        { type: 'revenuecat', params },
        {
          getAllBlocks: () => [RevenueCatBlock],
          getTool: (id) =>
            id === 'revenuecat_get_customer' ? revenuecatGetCustomerTool : undefined,
        }
      )
      expect(result?.id).toBe('revenuecat_get_customer')
      expect(result?.params).toEqual(params)
    }
  )

  it('selects the configured video provider without an operation', async () => {
    const result = await transformBlockTool(
      { type: 'video_generator_v3', params: { provider: 'falai', model: 'veo-3.1-fast' } },
      {
        getAllBlocks: () => [VideoGeneratorV3Block],
        getTool: (id) => (id === 'video_falai' ? falaiVideoTool : runwayVideoTool),
      }
    )

    expect(result?.id).toBe('video_falai')
    expect(result?.parameters?.properties).not.toHaveProperty('visualReference')
    const prepared = prepareToolExecution(
      result!,
      { prompt: 'A paper boat', provider: 'runway', model: 'gen-4-turbo' },
      {},
      'call-video'
    )
    expect(prepared.toolParams).toMatchObject({
      provider: 'falai',
      model: 'veo-3.1-fast',
      prompt: 'A paper boat',
    })
  })

  it.each(['unsupported', 'throws'])(
    'does not substitute the first tool for an invalid configured provider (%s)',
    async (failure) => {
      const getTool = vi.fn()
      const result = await transformBlockTool(
        { type: 'fixture', params: { provider: 'unavailable-provider' } },
        {
          getAllBlocks: () => [
            {
              type: 'fixture',
              subBlocks: [],
              tools: {
                access: ['fixture_read', 'fixture_write'],
                config: {
                  tool: () => {
                    if (failure === 'throws') throw new Error('Invalid provider')
                    return 'fixture_not_declared'
                  },
                },
              },
            },
          ],
          getTool,
        }
      )
      expect(result).toBeNull()
      expect(getTool).not.toHaveBeenCalled()
    }
  )

  it.each([
    { params: {}, selectedOperation: undefined, expected: 'fixture_read' },
    { params: { operation: 'write' }, selectedOperation: undefined, expected: 'fixture_write' },
    { params: { operation: 'write' }, selectedOperation: 'read', expected: 'fixture_read' },
  ])(
    'retains operation precedence and unconfigured defaults: $expected',
    async ({ params, selectedOperation, expected }) => {
      const result = await transformBlockTool(
        { type: 'fixture', params },
        {
          selectedOperation,
          getAllBlocks: () => [
            {
              type: 'fixture',
              subBlocks: [],
              tools: {
                access: ['fixture_read', 'fixture_write'],
                config: {
                  tool: (values: Record<string, unknown>) => `fixture_${values.operation}`,
                },
              },
            },
          ],
          getTool: (id) => ({ id, name: id, description: id, params: {} }),
        }
      )

      expect(result?.id).toBe(expected)
    }
  )
})

describe('block tool file reference normalization', () => {
  const transform = (single: boolean, omitFile = false) =>
    buildBlockToolParamsTransform({
      blockSubBlocks: [],
      blockParamsFn: (params) => ({
        files: omitFile
          ? undefined
          : single
            ? normalizeFileInput(params.files, { single: true })
            : normalizeFileInput(params.files),
      }),
      blockInputDefs: undefined,
      toolParams: { files: { type: single ? 'file' : 'file[]' }, note: { type: 'string' } },
      canonicalGroups: [],
      scopedCanonicalModes: undefined,
    }).paramsTransform!

  it.each([
    { value: 'wf_first', expected: [{ id: 'wf_first' }] },
    { value: ['wf_first', 'wf_second'], expected: [{ id: 'wf_first' }, { id: 'wf_second' }] },
    { value: '["wf_first","wf_second"]', expected: [{ id: 'wf_first' }, { id: 'wf_second' }] },
  ])(
    'normalizes scalar, array, and stored JSON file references before the mapper',
    ({ value, expected }) => {
      expect(transform(false)({ files: value, note: 'literal text' })).toEqual({
        files: expected,
        note: 'literal text',
      })
    }
  )

  it('preserves existing file objects and single-file cardinality checks', () => {
    const file = { id: 'wf_first', name: 'one.png', url: '/one.png', key: 'workspace/one.png' }
    expect(transform(true)({ files: file }).files).toBe(file)
    expect(transform(true)({ files: ['wf_first'] }).files).toEqual({ id: 'wf_first' })
    expect(() => transform(true)({ files: ['wf_first', 'wf_second'] })).toThrow()
  })

  it('retains an intentional conditional omission from the mapper', () => {
    expect(transform(true, true)({ files: 'wf_first' })).toHaveProperty('files', undefined)
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
