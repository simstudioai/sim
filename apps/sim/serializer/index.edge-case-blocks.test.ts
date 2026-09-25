/**
 * Extended Serializer Tests
 *
 * These tests cover edge cases, complex scenarios, and gaps in coverage
 */

import { toolsUtilsMock } from '@sim/testing/mocks'
import { describe, expect, it, vi } from 'vitest'
import { Serializer } from '@/serializer/index'
import type { SerializedWorkflow } from '@/serializer/types'
import type { BlockState } from '@/stores/workflows/workflow/types'

/**
 * Hoisted mock setup - vi.mock is hoisted, so we need to hoist the config too.
 */
const { mockBlockConfigs, createMockGetBlock } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockBlockConfigs: Record<string, any> = {
    starter: {
      name: 'Starter',
      description: 'Start of the workflow',
      category: 'flow',
      bgColor: '#4CAF50',
      tools: {
        access: ['starter'],
        config: { tool: () => 'starter' },
      },
      subBlocks: [
        { id: 'description', type: 'long-input', label: 'Description' },
        { id: 'inputFormat', type: 'table', label: 'Input Format' },
      ],
      inputs: {},
    },
    agent: {
      name: 'Agent',
      description: 'AI Agent',
      category: 'ai',
      bgColor: '#2196F3',
      tools: {
        access: ['anthropic_chat', 'openai_chat'],
        config: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tool: (params: Record<string, any>) => {
            const model = params.model || 'gpt-4o'
            if (model.includes('claude')) return 'anthropic'
            if (model.includes('gpt') || model.includes('o1')) return 'openai'
            if (model.includes('gemini')) return 'google'
            return 'openai'
          },
        },
      },
      subBlocks: [
        { id: 'provider', type: 'dropdown', label: 'Provider' },
        { id: 'model', type: 'dropdown', label: 'Model' },
        { id: 'prompt', type: 'long-input', label: 'Prompt' },
        { id: 'system', type: 'long-input', label: 'System Message' },
        { id: 'tools', type: 'tool-input', label: 'Tools' },
        { id: 'responseFormat', type: 'code', label: 'Response Format' },
        { id: 'messages', type: 'messages-input', label: 'Messages' },
      ],
      inputs: {
        input: { type: 'string' },
        tools: { type: 'array' },
      },
    },
    function: {
      name: 'Function',
      description: 'Execute custom code',
      category: 'code',
      bgColor: '#9C27B0',
      tools: {
        access: ['function'],
        config: { tool: () => 'function' },
      },
      subBlocks: [
        { id: 'code', type: 'code', label: 'Code' },
        { id: 'language', type: 'dropdown', label: 'Language' },
      ],
      inputs: { input: { type: 'any' } },
    },
    envGatedFunction: {
      name: 'Environment-gated Function',
      description: 'Execute custom code',
      category: 'code',
      bgColor: '#9C27B0',
      tools: {
        access: ['function'],
        config: { tool: () => 'function' },
      },
      subBlocks: [
        { id: 'code', type: 'code', label: 'Code' },
        {
          id: 'language',
          type: 'dropdown',
          label: 'Language',
          showWhenEnvSet: 'NEXT_PUBLIC_TEST_REMOTE_RUNTIME',
        },
      ],
      inputs: { input: { type: 'any' } },
    },
    condition: {
      name: 'Condition',
      description: 'Branch based on condition',
      category: 'flow',
      bgColor: '#FF9800',
      tools: {
        access: ['condition'],
        config: { tool: () => 'condition' },
      },
      subBlocks: [{ id: 'condition', type: 'long-input', label: 'Condition' }],
      inputs: { input: { type: 'any' } },
    },
    api: {
      name: 'API',
      description: 'Make API request',
      category: 'data',
      bgColor: '#E91E63',
      tools: {
        access: ['api'],
        config: { tool: () => 'api' },
      },
      subBlocks: [
        { id: 'url', type: 'short-input', label: 'URL' },
        { id: 'method', type: 'dropdown', label: 'Method' },
        { id: 'headers', type: 'table', label: 'Headers' },
        { id: 'body', type: 'long-input', label: 'Body' },
      ],
      inputs: {},
    },
    webhook: {
      name: 'Webhook',
      description: 'Webhook trigger',
      category: 'triggers',
      bgColor: '#4CAF50',
      tools: {
        access: ['webhook'],
        config: { tool: () => 'webhook' },
      },
      subBlocks: [{ id: 'path', type: 'short-input', label: 'Path' }],
      inputs: {},
    },
    slack: {
      name: 'Slack',
      description: 'Send messages to Slack',
      category: 'tools',
      bgColor: '#611f69',
      tools: {
        access: ['slack_send_message'],
        config: { tool: () => 'slack_send_message' },
      },
      subBlocks: [
        {
          id: 'channel',
          type: 'dropdown',
          label: 'Channel',
          mode: 'basic',
          canonicalParamId: 'channel',
        },
        {
          id: 'manualChannel',
          type: 'short-input',
          label: 'Channel ID',
          mode: 'advanced',
          canonicalParamId: 'channel',
        },
        { id: 'text', type: 'long-input', label: 'Message' },
        { id: 'username', type: 'short-input', label: 'Username', mode: 'both' },
      ],
      inputs: { text: { type: 'string' } },
    },
    conditional_block: {
      name: 'Conditional Block',
      description: 'Block with conditional fields',
      category: 'tools',
      bgColor: '#FF5700',
      tools: {
        access: ['conditional_tool'],
        config: { tool: () => 'conditional_tool' },
      },
      subBlocks: [
        { id: 'mode', type: 'dropdown', label: 'Mode' },
        {
          id: 'optionA',
          type: 'short-input',
          label: 'Option A',
          condition: { field: 'mode', value: 'a' },
        },
        {
          id: 'optionB',
          type: 'short-input',
          label: 'Option B',
          condition: { field: 'mode', value: 'b' },
        },
        {
          id: 'notModeC',
          type: 'short-input',
          label: 'Not Mode C',
          condition: { field: 'mode', value: 'c', not: true },
        },
        {
          id: 'complexCondition',
          type: 'short-input',
          label: 'Complex',
          condition: { field: 'mode', value: 'a', and: { field: 'optionA', value: 'special' } },
        },
        {
          id: 'arrayCondition',
          type: 'short-input',
          label: 'Array Condition',
          condition: { field: 'mode', value: ['a', 'b'] },
        },
      ],
      inputs: {},
    },
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createMockGetBlock = (extraConfigs: Record<string, any> = {}) => {
    const configs = { ...mockBlockConfigs, ...extraConfigs }
    return (type: string) => configs[type] || null
  }

  return { mockBlockConfigs, createMockGetBlock }
})

vi.mock('@/blocks', () => ({
  getBlock: createMockGetBlock(),
  getAllBlocks: () => Object.values(mockBlockConfigs),
}))
vi.mock('@/tools/utils', () => toolsUtilsMock)

describe('Serializer Extended Tests', () => {
  describe('evaluateCondition edge cases', () => {
    it('should include field when condition matches simple value', () => {
      const serializer = new Serializer()
      const block: BlockState = {
        id: 'cond-block',
        type: 'conditional_block',
        name: 'Conditional',
        position: { x: 0, y: 0 },
        subBlocks: {
          mode: { id: 'mode', type: 'dropdown', value: 'a' },
          optionA: { id: 'optionA', type: 'short-input', value: 'valueA' },
          optionB: { id: 'optionB', type: 'short-input', value: 'valueB' },
        },
        outputs: {},
        enabled: true,
      }

      const serialized = serializer.serializeWorkflow({ 'cond-block': block }, [], {})
      const serializedBlock = serialized.blocks.find((b) => b.id === 'cond-block')

      expect(serializedBlock?.config.params.mode).toBe('a')
      expect(serializedBlock?.config.params.optionA).toBe('valueA')
      expect(serializedBlock?.config.params.optionB).toBeUndefined()
    })

    it('should handle NOT condition correctly', () => {
      const serializer = new Serializer()
      const block: BlockState = {
        id: 'cond-block',
        type: 'conditional_block',
        name: 'Conditional',
        position: { x: 0, y: 0 },
        subBlocks: {
          mode: { id: 'mode', type: 'dropdown', value: 'a' },
          notModeC: { id: 'notModeC', type: 'short-input', value: 'shown' },
        },
        outputs: {},
        enabled: true,
      }

      const serialized = serializer.serializeWorkflow({ 'cond-block': block }, [], {})
      const serializedBlock = serialized.blocks.find((b) => b.id === 'cond-block')

      expect(serializedBlock?.config.params.notModeC).toBe('shown')
    })

    it('should handle AND condition correctly', () => {
      const serializer = new Serializer()
      const block: BlockState = {
        id: 'cond-block',
        type: 'conditional_block',
        name: 'Conditional',
        position: { x: 0, y: 0 },
        subBlocks: {
          mode: { id: 'mode', type: 'dropdown', value: 'a' },
          optionA: { id: 'optionA', type: 'short-input', value: 'special' },
          complexCondition: { id: 'complexCondition', type: 'short-input', value: 'shown' },
        },
        outputs: {},
        enabled: true,
      }

      const serialized = serializer.serializeWorkflow({ 'cond-block': block }, [], {})
      const serializedBlock = serialized.blocks.find((b) => b.id === 'cond-block')

      expect(serializedBlock?.config.params.complexCondition).toBe('shown')
    })

    it('should handle array condition values', () => {
      const serializer = new Serializer()
      const block: BlockState = {
        id: 'cond-block',
        type: 'conditional_block',
        name: 'Conditional',
        position: { x: 0, y: 0 },
        subBlocks: {
          mode: { id: 'mode', type: 'dropdown', value: 'b' },
          arrayCondition: { id: 'arrayCondition', type: 'short-input', value: 'included' },
        },
        outputs: {},
        enabled: true,
      }

      const serialized = serializer.serializeWorkflow({ 'cond-block': block }, [], {})
      const serializedBlock = serialized.blocks.find((b) => b.id === 'cond-block')

      expect(serializedBlock?.config.params.arrayCondition).toBe('included')
    })
  })

  describe('trigger mode serialization', () => {
    it('should set triggerMode for trigger category blocks', () => {
      const serializer = new Serializer()
      const block: BlockState = {
        id: 'webhook-1',
        type: 'webhook',
        name: 'Webhook',
        position: { x: 0, y: 0 },
        subBlocks: {
          path: { id: 'path', type: 'short-input', value: '/api/webhook' },
        },
        outputs: {},
        enabled: true,
      }

      const serialized = serializer.serializeWorkflow({ 'webhook-1': block }, [], {})
      const webhookBlock = serialized.blocks.find((b) => b.id === 'webhook-1')

      expect(webhookBlock?.config.params.triggerMode).toBe(true)
    })
  })

  describe('migrateAgentParamsToMessages', () => {
    it('should migrate systemPrompt and userPrompt to messages array during deserialization', () => {
      const serializer = new Serializer()
      const serializedWorkflow: SerializedWorkflow = {
        version: '1.0',
        blocks: [
          {
            id: 'agent-1',
            position: { x: 0, y: 0 },
            config: {
              tool: 'openai',
              params: {
                model: 'gpt-4o',
                systemPrompt: 'You are helpful',
                userPrompt: 'Hello there',
              },
            },
            inputs: {},
            outputs: {},
            metadata: { id: 'agent', name: 'Agent' },
            enabled: true,
          },
        ],
        connections: [],
        loops: {},
      }

      const deserialized = serializer.deserializeWorkflow(serializedWorkflow)
      const agentBlock = deserialized.blocks['agent-1']

      expect(agentBlock.subBlocks.messages).toBeDefined()
      expect(agentBlock.subBlocks.messages.value).toEqual([
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hello there' },
      ])
    })

    it('should not migrate if messages already exists', () => {
      const serializer = new Serializer()
      const existingMessages = [{ role: 'user', content: 'Existing' }]
      const serializedWorkflow: SerializedWorkflow = {
        version: '1.0',
        blocks: [
          {
            id: 'agent-1',
            position: { x: 0, y: 0 },
            config: {
              tool: 'openai',
              params: {
                model: 'gpt-4o',
                systemPrompt: 'Should not use',
                userPrompt: 'Should not use',
                messages: existingMessages,
              },
            },
            inputs: {},
            outputs: {},
            metadata: { id: 'agent', name: 'Agent' },
            enabled: true,
          },
        ],
        connections: [],
        loops: {},
      }

      const deserialized = serializer.deserializeWorkflow(serializedWorkflow)
      const agentBlock = deserialized.blocks['agent-1']

      expect(agentBlock.subBlocks.messages.value).toEqual(existingMessages)
    })
  })

  describe('connections serialization', () => {
    it('should deserialize connections back to edges', () => {
      const serializer = new Serializer()
      const serializedWorkflow: SerializedWorkflow = {
        version: '1.0',
        blocks: [
          {
            id: 'start',
            position: { x: 0, y: 0 },
            config: { tool: 'starter', params: {} },
            inputs: {},
            outputs: {},
            metadata: { id: 'starter' },
            enabled: true,
          },
          {
            id: 'end',
            position: { x: 200, y: 0 },
            config: { tool: 'function', params: {} },
            inputs: {},
            outputs: {},
            metadata: { id: 'function' },
            enabled: true,
          },
        ],
        connections: [
          {
            source: 'start',
            target: 'end',
            sourceHandle: 'output',
            targetHandle: 'input',
          },
        ],
        loops: {},
      }

      const deserialized = serializer.deserializeWorkflow(serializedWorkflow)

      expect(deserialized.edges).toHaveLength(1)
      expect(deserialized.edges[0].source).toBe('start')
      expect(deserialized.edges[0].target).toBe('end')
      expect(deserialized.edges[0].sourceHandle).toBe('output')
      expect(deserialized.edges[0].targetHandle).toBe('input')
    })
  })

  describe('starter block inputFormat handling', () => {
    it('should include inputFormat when it has values', () => {
      const serializer = new Serializer()
      const block: BlockState = {
        id: 'starter',
        type: 'starter',
        name: 'Start',
        position: { x: 0, y: 0 },
        subBlocks: {
          description: { id: 'description', type: 'long-input', value: 'Test' },
          inputFormat: {
            id: 'inputFormat',
            type: 'table',
            value: [
              ['name', 'string'],
              ['age', 'number'],
            ],
          },
        },
        outputs: {},
        enabled: true,
      }

      const serialized = serializer.serializeWorkflow({ starter: block }, [], {})
      const starterBlock = serialized.blocks.find((b) => b.id === 'starter')

      expect(starterBlock?.config.params.inputFormat).toEqual([
        ['name', 'string'],
        ['age', 'number'],
      ])
    })
  })

  describe('agent tools handling', () => {
    it('should handle invalid tools JSON gracefully', () => {
      const serializer = new Serializer()
      const block: BlockState = {
        id: 'agent-1',
        type: 'agent',
        name: 'Agent',
        position: { x: 0, y: 0 },
        subBlocks: {
          model: { id: 'model', type: 'dropdown', value: 'gpt-4o' },
          prompt: { id: 'prompt', type: 'long-input', value: 'Test' },
          tools: { id: 'tools', type: 'tool-input', value: 'invalid json' },
        },
        outputs: {},
        enabled: true,
      }

      const serialized = serializer.serializeWorkflow({ 'agent-1': block }, [], {})
      expect(serialized.blocks[0].config.tool).toBe('anthropic_chat')
    })
  })

  describe('edge cases with empty and null values', () => {
    it('preserves execution parameters hidden by a presentation-only environment gate', () => {
      const serializer = new Serializer()
      const block: BlockState = {
        id: 'func-python',
        type: 'envGatedFunction',
        name: 'Python Function',
        position: { x: 0, y: 0 },
        subBlocks: {
          code: { id: 'code', type: 'code', value: 'from datetime import datetime' },
          language: { id: 'language', type: 'dropdown', value: 'python' },
        },
        outputs: {},
        enabled: true,
      }

      const serialized = serializer.serializeWorkflow({ 'func-python': block }, [], {})

      expect(serialized.blocks[0].config.params).toMatchObject({
        code: 'from datetime import datetime',
        language: 'python',
      })
    })
  })
})
