/**
 * @vitest-environment jsdom
 *
 * Serializer Class Unit Tests
 *
 * This file contains unit tests for the Serializer class, which is responsible for
 * converting between workflow state (blocks, edges, loops) and serialized format
 * used by the executor.
 */
import { describe, expect, test, vi } from 'vitest'
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
} from './__test-utils__/test-workflows'
import { Serializer } from './index'
import { SerializedWorkflow } from './types'

// Mock getBlock function
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
    }

    return mockConfigs[type] || null
  },
}))

// Mock logger
vi.mock('@/lib/logs/console-logger', () => ({
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
    test('should serialize a minimal workflow correctly', () => {
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

    test('should serialize a conditional workflow correctly', () => {
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

    test('should serialize a workflow with loops correctly', () => {
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

    test('should serialize a complex workflow with multiple block types', () => {
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

    test('should serialize agent block with custom tools correctly', () => {
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

    test('should handle invalid block types gracefully', () => {
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
    test('should deserialize a serialized workflow correctly', () => {
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

    test('should deserialize a complex workflow with all block types', () => {
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

    test('should handle serialized workflow with invalid block metadata', () => {
      const invalidWorkflow = createInvalidSerializedWorkflow() as SerializedWorkflow
      const serializer = new Serializer()

      // Should throw an error when deserializing an invalid block type
      expect(() => serializer.deserializeWorkflow(invalidWorkflow)).toThrow(
        'Invalid block type: non-existent-type'
      )
    })

    test('should handle serialized workflow with missing metadata', () => {
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
    test('should preserve all data through serialization and deserialization', () => {
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
})
