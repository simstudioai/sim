/**
 * @vitest-environment jsdom
 *
 * Serializer Class Unit Tests
 *
 * This file contains unit tests for the Serializer class, which is responsible for
 * converting between workflow state (blocks, edges, loops) and serialized format
 * used by the executor.
 */
import { describe, expect, it, vi } from 'vitest'
import { getProviderFromModel } from '@/providers/utils'
import {
  createAgentWithToolsWorkflowState,
  createComplexWorkflowState,
  createConditionalWorkflowState,
  createInvalidSerializedWorkflow,
  createInvalidWorkflowState,
  createLoopWorkflowState,
  createMinimalWorkflowState,
  createMissingMetadataWorkflow,
} from '@/serializer/__test-utils__/test-workflows'
import { Serializer } from '@/serializer/index'
import type { SerializedWorkflow } from '@/serializer/types'

vi.mock('@/blocks', () => ({
  getBlock: (type: string) => {
    // Mock block configurations for different block types
    const mockConfigs: Record<string, any> = {
      starter: {
        name: 'Starter',
        description: 'Start of the workflow',
        category: 'flow',
        bgColor: '#4CAF50',
        tools: {
          access: ['starter'],
          config: {
            tool: () => 'starter',
          },
        },
        subBlocks: [{ id: 'description', type: 'long-input', label: 'Description' }],
        inputs: {},
      },
      agent: {
        name: 'Agent',
        description: 'AI Agent',
        category: 'ai',
        bgColor: '#2196F3',
        tools: {
          access: ['anthropic_chat', 'openai_chat', 'google_chat'],
          config: {
            // Use the real getProviderFromModel that we imported
            tool: (params: Record<string, any>) => getProviderFromModel(params.model || 'gpt-4o'),
          },
        },
        subBlocks: [
          { id: 'provider', type: 'dropdown', label: 'Provider' },
          { id: 'model', type: 'dropdown', label: 'Model' },
          { id: 'prompt', type: 'long-input', label: 'Prompt' },
          { id: 'tools', type: 'tool-input', label: 'Tools' },
          { id: 'system', type: 'long-input', label: 'System Message' },
          { id: 'responseFormat', type: 'code', label: 'Response Format' },
        ],
        inputs: {
          input: { type: 'string' },
          tools: { type: 'array' },
        },
      },
      condition: {
        name: 'Condition',
        description: 'Branch based on condition',
        category: 'flow',
        bgColor: '#FF9800',
        tools: {
          access: ['condition'],
          config: {
            tool: () => 'condition',
          },
        },
        subBlocks: [{ id: 'condition', type: 'long-input', label: 'Condition' }],
        inputs: {
          input: { type: 'any' },
        },
      },
      function: {
        name: 'Function',
        description: 'Execute custom code',
        category: 'code',
        bgColor: '#9C27B0',
        tools: {
          access: ['function'],
          config: {
            tool: () => 'function',
          },
        },
        subBlocks: [
          { id: 'code', type: 'code', label: 'Code' },
          { id: 'language', type: 'dropdown', label: 'Language' },
        ],
        inputs: {
          input: { type: 'any' },
        },
      },
      api: {
        name: 'API',
        description: 'Make API request',
        category: 'data',
        bgColor: '#E91E63',
        tools: {
          access: ['api'],
          config: {
            tool: () => 'api',
          },
        },
        subBlocks: [
          { id: 'url', type: 'short-input', label: 'URL' },
          { id: 'method', type: 'dropdown', label: 'Method' },
          { id: 'headers', type: 'table', label: 'Headers' },
          { id: 'body', type: 'long-input', label: 'Body' },
        ],
        inputs: {},
      },
      jina: {
        name: 'Jina',
        description: 'Convert website content into text',
        category: 'tools',
        bgColor: '#333333',
        tools: {
          access: ['jina_read_url'],
          config: {
            tool: () => 'jina_read_url',
          },
        },
        subBlocks: [
          { id: 'url', type: 'short-input', title: 'URL', required: true },
          { id: 'apiKey', type: 'short-input', title: 'API Key', required: true },
        ],
        inputs: {
          url: { type: 'string' },
          apiKey: { type: 'string' },
        },
      },
      reddit: {
        name: 'Reddit',
        description: 'Access Reddit data and content',
        category: 'tools',
        bgColor: '#FF5700',
        tools: {
          access: ['reddit_get_posts', 'reddit_get_comments'],
          config: {
            tool: () => 'reddit_get_posts',
          },
        },
        subBlocks: [
          { id: 'operation', type: 'dropdown', title: 'Operation', required: true },
          { id: 'credential', type: 'oauth-input', title: 'Reddit Account', required: true },
          { id: 'subreddit', type: 'short-input', title: 'Subreddit', required: true },
        ],
        inputs: {
          operation: { type: 'string' },
          credential: { type: 'string' },
          subreddit: { type: 'string' },
        },
      },
      // Mock block with both basic and advanced mode fields for testing
      slack: {
        name: 'Slack',
        description: 'Send messages to Slack',
        category: 'tools',
        bgColor: '#611f69',
        tools: {
          access: ['slack_send_message'],
          config: {
            tool: () => 'slack_send_message',
          },
        },
        subBlocks: [
          { id: 'channel', type: 'dropdown', title: 'Channel', mode: 'basic' },
          { id: 'manualChannel', type: 'short-input', title: 'Channel ID', mode: 'advanced' },
          { id: 'text', type: 'long-input', title: 'Message' }, // mode: 'both' (default)
          { id: 'username', type: 'short-input', title: 'Username', mode: 'both' },
        ],
        inputs: {
          channel: { type: 'string' },
          manualChannel: { type: 'string' },
          text: { type: 'string' },
          username: { type: 'string' },
        },
      },
      // Mock agent block with memories for testing
      agentWithMemories: {
        name: 'Agent with Memories',
        description: 'AI Agent with memory support',
        category: 'ai',
        bgColor: '#2196F3',
        tools: {
          access: ['anthropic_chat'],
          config: {
            tool: () => 'anthropic_chat',
          },
        },
        subBlocks: [
          { id: 'systemPrompt', type: 'long-input', title: 'System Prompt' }, // mode: 'both' (default)
          { id: 'userPrompt', type: 'long-input', title: 'User Prompt' }, // mode: 'both' (default)
          { id: 'memories', type: 'short-input', title: 'Memories', mode: 'advanced' },
          { id: 'model', type: 'dropdown', title: 'Model' }, // mode: 'both' (default)
        ],
        inputs: {
          systemPrompt: { type: 'string' },
          userPrompt: { type: 'string' },
          memories: { type: 'array' },
          model: { type: 'string' },
        },
      },
    }

    return mockConfigs[type] || null
  },
}))

// Mock getTool function
vi.mock('@/tools/utils', () => ({
  getTool: (toolId: string) => {
    // Mock tool configurations for testing
    const mockTools: Record<string, any> = {
      jina_read_url: {
        params: {
          url: { visibility: 'user-or-llm', required: true },
          apiKey: { visibility: 'user-only', required: true },
        },
      },
      reddit_get_posts: {
        params: {
          subreddit: { visibility: 'user-or-llm', required: true },
          credential: { visibility: 'user-only', required: true },
        },
      },
    }
    return mockTools[toolId] || null
  },
}))

// Mock logger
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}))

describe('Serializer', () => {
  /**
   * Serialization tests
   */
  describe('serializeWorkflow', () => {
    it.concurrent('should serialize a minimal workflow correctly', () => {
      const { blocks, edges, loops } = createMinimalWorkflowState()
      const serializer = new Serializer()

      const serialized = serializer.serializeWorkflow(blocks, edges, loops)

      // Check if blocks are correctly serialized
      expect(serialized.blocks).toHaveLength(2)

      // Check starter block
      const starterBlock = serialized.blocks.find((b) => b.id === 'starter')
      expect(starterBlock).toBeDefined()
      expect(starterBlock?.metadata?.id).toBe('starter')
      expect(starterBlock?.config.tool).toBe('starter')
      expect(starterBlock?.config.params.description).toBe('This is the starter block')

      // Check agent block
      const agentBlock = serialized.blocks.find((b) => b.id === 'agent1')
      expect(agentBlock).toBeDefined()
      expect(agentBlock?.metadata?.id).toBe('agent')
      expect(agentBlock?.config.params.prompt).toBe('Hello, world!')
      expect(agentBlock?.config.params.model).toBe('claude-3-7-sonnet-20250219')

      // Check if edges are correctly serialized
      expect(serialized.connections).toHaveLength(1)
      expect(serialized.connections[0].source).toBe('starter')
      expect(serialized.connections[0].target).toBe('agent1')
    })

    it.concurrent('should serialize a conditional workflow correctly', () => {
      const { blocks, edges, loops } = createConditionalWorkflowState()
      const serializer = new Serializer()

      const serialized = serializer.serializeWorkflow(blocks, edges, loops)

      // Check blocks
      expect(serialized.blocks).toHaveLength(4)

      // Check condition block
      const conditionBlock = serialized.blocks.find((b) => b.id === 'condition1')
      expect(conditionBlock).toBeDefined()
      expect(conditionBlock?.metadata?.id).toBe('condition')
      expect(conditionBlock?.config.tool).toBe('condition')
      expect(conditionBlock?.config.params.condition).toBe('input.value > 10')

      // Check connections with handles
      expect(serialized.connections).toHaveLength(3)

      const truePathConnection = serialized.connections.find(
        (c) => c.source === 'condition1' && c.sourceHandle === 'condition-true'
      )
      expect(truePathConnection).toBeDefined()
      expect(truePathConnection?.target).toBe('agent1')

      const falsePathConnection = serialized.connections.find(
        (c) => c.source === 'condition1' && c.sourceHandle === 'condition-false'
      )
      expect(falsePathConnection).toBeDefined()
      expect(falsePathConnection?.target).toBe('agent2')
    })

    it.concurrent('should serialize a workflow with loops correctly', () => {
      const { blocks, edges, loops } = createLoopWorkflowState()
      const serializer = new Serializer()

      const serialized = serializer.serializeWorkflow(blocks, edges, loops)

      // Check loops
      expect(Object.keys(serialized.loops)).toHaveLength(1)
      expect(serialized.loops.loop1).toBeDefined()
      expect(serialized.loops.loop1.nodes).toContain('function1')
      expect(serialized.loops.loop1.nodes).toContain('condition1')
      expect(serialized.loops.loop1.iterations).toBe(10)

      // Check connections for loop
      const loopBackConnection = serialized.connections.find(
        (c) => c.source === 'condition1' && c.target === 'function1'
      )
      expect(loopBackConnection).toBeDefined()
      expect(loopBackConnection?.sourceHandle).toBe('condition-true')
    })

    it.concurrent('should serialize a complex workflow with multiple block types', () => {
      const { blocks, edges, loops } = createComplexWorkflowState()
      const serializer = new Serializer()

      const serialized = serializer.serializeWorkflow(blocks, edges, loops)

      // Check all blocks
      expect(serialized.blocks).toHaveLength(4)

      // Check API block
      const apiBlock = serialized.blocks.find((b) => b.id === 'api1')
      expect(apiBlock).toBeDefined()
      expect(apiBlock?.metadata?.id).toBe('api')
      expect(apiBlock?.config.tool).toBe('api')
      expect(apiBlock?.config.params.url).toBe('https://api.example.com/data')
      expect(apiBlock?.config.params.method).toBe('GET')
      expect(apiBlock?.config.params.headers).toEqual([
        ['Content-Type', 'application/json'],
        ['Authorization', 'Bearer {{API_KEY}}'],
      ])

      // Check function block
      const functionBlock = serialized.blocks.find((b) => b.id === 'function1')
      expect(functionBlock).toBeDefined()
      expect(functionBlock?.metadata?.id).toBe('function')
      expect(functionBlock?.config.tool).toBe('function')
      expect(functionBlock?.config.params.language).toBe('javascript')

      // Check agent block with response format
      const agentBlock = serialized.blocks.find((b) => b.id === 'agent1')
      expect(agentBlock).toBeDefined()
      expect(agentBlock?.metadata?.id).toBe('agent')
      expect(agentBlock?.config.tool).toBe('openai')
      expect(agentBlock?.config.params.model).toBe('gpt-4o')
      expect(agentBlock?.outputs.responseFormat).toBeDefined()
    })

    it.concurrent('should serialize agent block with custom tools correctly', () => {
      const { blocks, edges, loops } = createAgentWithToolsWorkflowState()
      const serializer = new Serializer()

      const serialized = serializer.serializeWorkflow(blocks, edges, loops)

      // Check agent block
      const agentBlock = serialized.blocks.find((b) => b.id === 'agent1')
      expect(agentBlock).toBeDefined()
      // The model used is 'gpt-4o', so tool should be 'openai'
      expect(agentBlock?.config.tool).toBe('openai')
      expect(agentBlock?.config.params.model).toBe('gpt-4o')

      // Tools should be preserved as-is in params
      const toolsParam = agentBlock?.config.params.tools
      expect(toolsParam).toBeDefined()

      // Parse tools to verify content
      const tools = JSON.parse(toolsParam)
      expect(tools).toHaveLength(2)

      // Check custom tool
      const customTool = tools.find((t: any) => t.type === 'custom-tool')
      expect(customTool).toBeDefined()
      expect(customTool.name).toBe('weather')

      // Check function tool
      const functionTool = tools.find((t: any) => t.type === 'function')
      expect(functionTool).toBeDefined()
      expect(functionTool.name).toBe('calculator')
    })

    it.concurrent('should handle invalid block types gracefully', () => {
      const { blocks, edges, loops } = createInvalidWorkflowState()
      const serializer = new Serializer()

      // Should throw an error when serializing an invalid block type
      expect(() => serializer.serializeWorkflow(blocks, edges, loops)).toThrow(
        'Invalid block type: invalid-type'
      )
    })
  })

  /**
   * Deserialization tests
   */
  describe('deserializeWorkflow', () => {
    it.concurrent('should deserialize a serialized workflow correctly', () => {
      const { blocks, edges, loops } = createMinimalWorkflowState()
      const serializer = new Serializer()

      // First serialize
      const serialized = serializer.serializeWorkflow(blocks, edges, loops)

      // Then deserialize
      const deserialized = serializer.deserializeWorkflow(serialized)

      // Check blocks
      expect(Object.keys(deserialized.blocks)).toHaveLength(2)

      // Check starter block
      const starterBlock = deserialized.blocks.starter
      expect(starterBlock).toBeDefined()
      expect(starterBlock.type).toBe('starter')
      expect(starterBlock.name).toBe('Starter Block')
      expect(starterBlock.subBlocks.description.value).toBe('This is the starter block')

      // Check agent block
      const agentBlock = deserialized.blocks.agent1
      expect(agentBlock).toBeDefined()
      expect(agentBlock.type).toBe('agent')
      expect(agentBlock.name).toBe('Agent Block')
      expect(agentBlock.subBlocks.prompt.value).toBe('Hello, world!')
      expect(agentBlock.subBlocks.model.value).toBe('claude-3-7-sonnet-20250219')

      // Check edges
      expect(deserialized.edges).toHaveLength(1)
      expect(deserialized.edges[0].source).toBe('starter')
      expect(deserialized.edges[0].target).toBe('agent1')
    })

    it.concurrent('should deserialize a complex workflow with all block types', () => {
      const { blocks, edges, loops } = createComplexWorkflowState()
      const serializer = new Serializer()

      // First serialize
      const serialized = serializer.serializeWorkflow(blocks, edges, loops)

      // Then deserialize
      const deserialized = serializer.deserializeWorkflow(serialized)

      // Check all blocks are deserialized
      expect(Object.keys(deserialized.blocks)).toHaveLength(4)

      // Check API block
      const apiBlock = deserialized.blocks.api1
      expect(apiBlock).toBeDefined()
      expect(apiBlock.type).toBe('api')
      expect(apiBlock.subBlocks.url.value).toBe('https://api.example.com/data')
      expect(apiBlock.subBlocks.method.value).toBe('GET')
      expect(apiBlock.subBlocks.headers.value).toEqual([
        ['Content-Type', 'application/json'],
        ['Authorization', 'Bearer {{API_KEY}}'],
      ])

      // Check function block
      const functionBlock = deserialized.blocks.function1
      expect(functionBlock).toBeDefined()
      expect(functionBlock.type).toBe('function')
      expect(functionBlock.subBlocks.language.value).toBe('javascript')

      // Check agent block
      const agentBlock = deserialized.blocks.agent1
      expect(agentBlock).toBeDefined()
      expect(agentBlock.type).toBe('agent')
      expect(agentBlock.subBlocks.model.value).toBe('gpt-4o')
      expect(agentBlock.subBlocks.provider.value).toBe('openai')
    })

    it.concurrent('should handle serialized workflow with invalid block metadata', () => {
      const invalidWorkflow = createInvalidSerializedWorkflow() as SerializedWorkflow
      const serializer = new Serializer()

      // Should throw an error when deserializing an invalid block type
      expect(() => serializer.deserializeWorkflow(invalidWorkflow)).toThrow(
        'Invalid block type: non-existent-type'
      )
    })

    it.concurrent('should handle serialized workflow with missing metadata', () => {
      const invalidWorkflow = createMissingMetadataWorkflow() as SerializedWorkflow
      const serializer = new Serializer()

      // Should throw an error when deserializing with missing metadata
      expect(() => serializer.deserializeWorkflow(invalidWorkflow)).toThrow()
    })
  })

  /**
   * End-to-end serialization/deserialization tests
   */
  describe('round-trip serialization', () => {
    it.concurrent('should preserve all data through serialization and deserialization', () => {
      const { blocks, edges, loops } = createComplexWorkflowState()
      const serializer = new Serializer()

      // Serialize
      const serialized = serializer.serializeWorkflow(blocks, edges, loops)

      // Deserialize
      const deserialized = serializer.deserializeWorkflow(serialized)

      // Re-serialize to check for consistency
      const reserialized = serializer.serializeWorkflow(
        deserialized.blocks,
        deserialized.edges,
        loops
      )

      // Compare the two serialized versions
      expect(reserialized.blocks.length).toBe(serialized.blocks.length)
      expect(reserialized.connections.length).toBe(serialized.connections.length)

      // Check blocks by ID
      serialized.blocks.forEach((originalBlock) => {
        const reserializedBlock = reserialized.blocks.find((b) => b.id === originalBlock.id)

        expect(reserializedBlock).toBeDefined()
        expect(reserializedBlock?.config.tool).toBe(originalBlock.config.tool)
        expect(reserializedBlock?.metadata?.id).toBe(originalBlock.metadata?.id)

        // Check params - we only check a subset because some default values might be added
        Object.entries(originalBlock.config.params).forEach(([key, value]) => {
          if (value !== null) {
            expect(reserializedBlock?.config.params[key]).toEqual(value)
          }
        })
      })

      // Check connections
      expect(reserialized.connections).toEqual(serialized.connections)

      // Check loops
      expect(reserialized.loops).toEqual(serialized.loops)
    })
  })

  describe('validation during serialization', () => {
    it.concurrent('should throw error for missing user-only required fields', () => {
      const serializer = new Serializer()

      // Create a block state with a missing user-only required field (API key)
      const blockWithMissingUserOnlyField: any = {
        id: 'test-block',
        type: 'jina',
        name: 'Test Jina Block',
        position: { x: 0, y: 0 },
        subBlocks: {
          url: { value: 'https://example.com' },
          apiKey: { value: null }, // Missing user-only required field
        },
        outputs: {},
        enabled: true,
      }

      expect(() => {
        serializer.serializeWorkflow(
          { 'test-block': blockWithMissingUserOnlyField },
          [],
          {},
          undefined,
          true
        )
      }).toThrow('Test Jina Block is missing required fields: API Key')
    })

    it.concurrent('should not throw error when all user-only required fields are present', () => {
      const serializer = new Serializer()

      const blockWithAllUserOnlyFields: any = {
        id: 'test-block',
        type: 'jina',
        name: 'Test Jina Block',
        position: { x: 0, y: 0 },
        subBlocks: {
          url: { value: 'https://example.com' },
          apiKey: { value: 'test-api-key' },
        },
        outputs: {},
        enabled: true,
      }

      expect(() => {
        serializer.serializeWorkflow(
          { 'test-block': blockWithAllUserOnlyFields },
          [],
          {},
          undefined,
          true
        )
      }).not.toThrow()
    })

    it.concurrent('should not validate user-or-llm fields during serialization', () => {
      const serializer = new Serializer()

      // Create a Reddit block with missing subreddit (user-or-llm field)
      const blockWithMissingUserOrLlmField: any = {
        id: 'test-block',
        type: 'reddit',
        name: 'Test Reddit Block',
        position: { x: 0, y: 0 },
        subBlocks: {
          operation: { value: 'get_posts' },
          credential: { value: 'test-credential' },
          subreddit: { value: null }, // Missing user-or-llm field - should NOT be validated here
        },
        outputs: {},
        enabled: true,
      }

      // Should NOT throw because subreddit is user-or-llm, not user-only
      expect(() => {
        serializer.serializeWorkflow(
          { 'test-block': blockWithMissingUserOrLlmField },
          [],
          {},
          undefined,
          true
        )
      }).not.toThrow()
    })

    it.concurrent('should not validate when validateRequired is false', () => {
      const serializer = new Serializer()

      const blockWithMissingField: any = {
        id: 'test-block',
        type: 'jina',
        name: 'Test Jina Block',
        position: { x: 0, y: 0 },
        subBlocks: {
          url: { value: 'https://example.com' },
          apiKey: { value: null }, // Missing required field
        },
        outputs: {},
        enabled: true,
      }

      // Should NOT throw when validation is disabled (default behavior)
      expect(() => {
        serializer.serializeWorkflow({ 'test-block': blockWithMissingField }, [], {})
      }).not.toThrow()
    })

    it.concurrent('should validate multiple user-only fields and report all missing', () => {
      const serializer = new Serializer()

      const blockWithMultipleMissing: any = {
        id: 'test-block',
        type: 'jina',
        name: 'Test Jina Block',
        position: { x: 0, y: 0 },
        subBlocks: {
          url: { value: null }, // Missing user-or-llm field (should NOT be validated)
          apiKey: { value: null }, // Missing user-only field (should be validated)
        },
        outputs: {},
        enabled: true,
      }

      expect(() => {
        serializer.serializeWorkflow(
          { 'test-block': blockWithMultipleMissing },
          [],
          {},
          undefined,
          true
        )
      }).toThrow('Test Jina Block is missing required fields: API Key')
    })

    it.concurrent('should handle blocks with no tool configuration gracefully', () => {
      const serializer = new Serializer()

      const blockWithNoTools: any = {
        id: 'test-block',
        type: 'condition', // Condition blocks have different tool setup
        name: 'Test Condition Block',
        position: { x: 0, y: 0 },
        subBlocks: {
          condition: { value: null }, // Missing required field but not user-only
        },
        outputs: {},
        enabled: true,
      }

      // Should NOT throw because condition blocks don't have user-only params
      expect(() => {
        serializer.serializeWorkflow({ 'test-block': blockWithNoTools }, [], {}, undefined, true)
      }).not.toThrow()
    })

    it.concurrent('should handle empty string values as missing', () => {
      const serializer = new Serializer()

      const blockWithEmptyString: any = {
        id: 'test-block',
        type: 'jina',
        name: 'Test Jina Block',
        position: { x: 0, y: 0 },
        subBlocks: {
          url: { value: 'https://example.com' },
          apiKey: { value: '' }, // Empty string should be treated as missing
        },
        outputs: {},
        enabled: true,
      }

      expect(() => {
        serializer.serializeWorkflow(
          { 'test-block': blockWithEmptyString },
          [],
          {},
          undefined,
          true
        )
      }).toThrow('Test Jina Block is missing required fields: API Key')
    })

    it.concurrent('should only validate user-only fields, not user-or-llm fields', () => {
      const serializer = new Serializer()

      // Block with both user-only and user-or-llm missing fields
      const mixedBlock: any = {
        id: 'test-block',
        type: 'reddit',
        name: 'Test Reddit Block',
        position: { x: 0, y: 0 },
        subBlocks: {
          operation: { value: 'get_posts' },
          credential: { value: null }, // user-only - should be validated
          subreddit: { value: null }, // user-or-llm - should NOT be validated
        },
        outputs: {},
        enabled: true,
      }

      expect(() => {
        serializer.serializeWorkflow({ 'test-block': mixedBlock }, [], {}, undefined, true)
      }).toThrow('Test Reddit Block is missing required fields: Reddit Account')
    })
  })

  /**
   * Advanced mode field filtering tests
   */
  describe('advanced mode field filtering', () => {
    it.concurrent('should include all fields when block is in advanced mode', () => {
      const serializer = new Serializer()

      const advancedModeBlock: any = {
        id: 'slack-1',
        type: 'slack',
        name: 'Test Slack Block',
        position: { x: 0, y: 0 },
        advancedMode: true, // Advanced mode enabled
        subBlocks: {
          channel: { value: 'general' }, // basic mode field
          manualChannel: { value: 'C1234567890' }, // advanced mode field
          text: { value: 'Hello world' }, // both mode field
          username: { value: 'bot' }, // both mode field
        },
        outputs: {},
        enabled: true,
      }

      const serialized = serializer.serializeWorkflow({ 'slack-1': advancedModeBlock }, [], {})

      const slackBlock = serialized.blocks.find((b) => b.id === 'slack-1')
      expect(slackBlock).toBeDefined()

      // In advanced mode, should include ALL fields (basic, advanced, and both)
      expect(slackBlock?.config.params.channel).toBe('general') // basic mode field included
      expect(slackBlock?.config.params.manualChannel).toBe('C1234567890') // advanced mode field included
      expect(slackBlock?.config.params.text).toBe('Hello world') // both mode field included
      expect(slackBlock?.config.params.username).toBe('bot') // both mode field included
    })

    it.concurrent('should exclude advanced-only fields when block is in basic mode', () => {
      const serializer = new Serializer()

      const basicModeBlock: any = {
        id: 'slack-1',
        type: 'slack',
        name: 'Test Slack Block',
        position: { x: 0, y: 0 },
        advancedMode: false, // Basic mode enabled
        subBlocks: {
          channel: { value: 'general' }, // basic mode field
          manualChannel: { value: 'C1234567890' }, // advanced mode field
          text: { value: 'Hello world' }, // both mode field
          username: { value: 'bot' }, // both mode field
        },
        outputs: {},
        enabled: true,
      }

      const serialized = serializer.serializeWorkflow({ 'slack-1': basicModeBlock }, [], {})

      const slackBlock = serialized.blocks.find((b) => b.id === 'slack-1')
      expect(slackBlock).toBeDefined()

      // In basic mode, should include basic-only fields and exclude advanced-only fields
      expect(slackBlock?.config.params.channel).toBe('general') // basic mode field included
      expect(slackBlock?.config.params.manualChannel).toBeUndefined() // advanced mode field excluded
      expect(slackBlock?.config.params.text).toBe('Hello world') // both mode field included
      expect(slackBlock?.config.params.username).toBe('bot') // both mode field included
    })

    it.concurrent(
      'should exclude advanced-only fields when advancedMode is undefined (defaults to basic mode)',
      () => {
        const serializer = new Serializer()

        const defaultModeBlock: any = {
          id: 'slack-1',
          type: 'slack',
          name: 'Test Slack Block',
          position: { x: 0, y: 0 },
          // advancedMode: undefined (defaults to false)
          subBlocks: {
            channel: { value: 'general' }, // basic mode field
            manualChannel: { value: 'C1234567890' }, // advanced mode field
            text: { value: 'Hello world' }, // both mode field
            username: { value: 'bot' }, // both mode field
          },
          outputs: {},
          enabled: true,
        }

        const serialized = serializer.serializeWorkflow({ 'slack-1': defaultModeBlock }, [], {})

        const slackBlock = serialized.blocks.find((b) => b.id === 'slack-1')
        expect(slackBlock).toBeDefined()

        // Should default to basic mode behavior (include basic + both, exclude advanced)
        expect(slackBlock?.config.params.channel).toBe('general') // basic mode field included
        expect(slackBlock?.config.params.manualChannel).toBeUndefined() // advanced mode field excluded
        expect(slackBlock?.config.params.text).toBe('Hello world') // both mode field included
        expect(slackBlock?.config.params.username).toBe('bot') // both mode field included
      }
    )

    it.concurrent('should filter memories field correctly in agent blocks', () => {
      const serializer = new Serializer()

      const agentInBasicMode: any = {
        id: 'agent-1',
        type: 'agentWithMemories',
        name: 'Test Agent',
        position: { x: 0, y: 0 },
        advancedMode: false, // Basic mode
        subBlocks: {
          systemPrompt: { value: 'You are helpful' }, // both mode field
          userPrompt: { value: 'Hello' }, // both mode field
          memories: { value: [{ role: 'user', content: 'My name is John' }] }, // advanced mode field
          model: { value: 'claude-3-sonnet' }, // both mode field
        },
        outputs: {},
        enabled: true,
      }

      const serialized = serializer.serializeWorkflow({ 'agent-1': agentInBasicMode }, [], {})

      const agentBlock = serialized.blocks.find((b) => b.id === 'agent-1')
      expect(agentBlock).toBeDefined()

      // In basic mode, memories should be excluded
      expect(agentBlock?.config.params.systemPrompt).toBe('You are helpful')
      expect(agentBlock?.config.params.userPrompt).toBe('Hello')
      expect(agentBlock?.config.params.memories).toBeUndefined() // Excluded in basic mode
      expect(agentBlock?.config.params.model).toBe('claude-3-sonnet')
    })

    it.concurrent('should include memories field when agent is in advanced mode', () => {
      const serializer = new Serializer()

      const agentInAdvancedMode: any = {
        id: 'agent-1',
        type: 'agentWithMemories',
        name: 'Test Agent',
        position: { x: 0, y: 0 },
        advancedMode: true, // Advanced mode
        subBlocks: {
          systemPrompt: { value: 'You are helpful' }, // both mode field
          userPrompt: { value: 'Hello' }, // both mode field
          memories: { value: [{ role: 'user', content: 'My name is John' }] }, // advanced mode field
          model: { value: 'claude-3-sonnet' }, // both mode field
        },
        outputs: {},
        enabled: true,
      }

      const serialized = serializer.serializeWorkflow({ 'agent-1': agentInAdvancedMode }, [], {})

      const agentBlock = serialized.blocks.find((b) => b.id === 'agent-1')
      expect(agentBlock).toBeDefined()

      // In advanced mode, memories should be included
      expect(agentBlock?.config.params.systemPrompt).toBe('You are helpful')
      expect(agentBlock?.config.params.userPrompt).toBe('Hello')
      expect(agentBlock?.config.params.memories).toEqual([
        { role: 'user', content: 'My name is John' },
      ]) // Included in advanced mode
      expect(agentBlock?.config.params.model).toBe('claude-3-sonnet')
    })

    it.concurrent('should handle blocks with no matching subblock config gracefully', () => {
      const serializer = new Serializer()

      const blockWithUnknownField: any = {
        id: 'slack-1',
        type: 'slack',
        name: 'Test Slack Block',
        position: { x: 0, y: 0 },
        advancedMode: false, // Basic mode
        subBlocks: {
          channel: { value: 'general' }, // known field
          unknownField: { value: 'someValue' }, // field not in config
          text: { value: 'Hello world' }, // known field
        },
        outputs: {},
        enabled: true,
      }

      const serialized = serializer.serializeWorkflow({ 'slack-1': blockWithUnknownField }, [], {})

      const slackBlock = serialized.blocks.find((b) => b.id === 'slack-1')
      expect(slackBlock).toBeDefined()

      // Known fields should be processed according to mode rules
      expect(slackBlock?.config.params.channel).toBe('general')
      expect(slackBlock?.config.params.text).toBe('Hello world')

      // Unknown fields are filtered out (no subblock config found, so shouldIncludeField is not called)
      expect(slackBlock?.config.params.unknownField).toBeUndefined()
    })
  })
})
