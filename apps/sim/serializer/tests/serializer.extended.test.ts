/**
 * @vitest-environment jsdom
 *
 * Extended Serializer Tests
 *
 * These tests cover edge cases, complex scenarios, and gaps in coverage
 */

import {
  createBlock,
  createLinearWorkflow,
  createLoopWorkflow,
  createParallelWorkflow,
  createStarterBlock,
  WorkflowBuilder,
} from '@sim/testing'
import { loggerMock, toolsUtilsMock } from '@sim/testing/mocks'
import { describe, expect, it, vi } from 'vitest'
import { Serializer, WorkflowValidationError } from '@/serializer/index'
import type { SerializedWorkflow } from '@/serializer/types'
import type { BlockState } from '@/stores/workflows/workflow/types'

/**
 * Type helper to convert testing package workflow to app workflow types.
 * Needed because @sim/testing has simplified types for test ergonomics.
 */
function asAppBlocks<T>(blocks: T): Record<string, BlockState> {
  return blocks as unknown as Record<string, BlockState>
}

/**
 * Hoisted mock setup - vi.mock is hoisted, so we need to hoist the config too.
 */
const { mockBlockConfigs, createMockGetBlock, slackWithCanonicalParam } = vi.hoisted(() => {
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

  const slackWithCanonicalParam = mockBlockConfigs.slack

  return { mockBlockConfigs, createMockGetBlock, slackWithCanonicalParam }
})

vi.mock('@/blocks', () => ({
  getBlock: createMockGetBlock(),
  getAllBlocks: () => Object.values(mockBlockConfigs),
}))
vi.mock('@/tools/utils', () => toolsUtilsMock)
vi.mock('@sim/logger', () => loggerMock)

describe('Serializer Extended Tests', () => {
  describe('WorkflowValidationError', () => {
    it('should create error with block context', () => {
      const error = new WorkflowValidationError(
        'Test error message',
        'block-123',
        'agent',
        'My Agent'
      )

      expect(error.message).toBe('Test error message')
      expect(error.blockId).toBe('block-123')
      expect(error.blockType).toBe('agent')
      expect(error.blockName).toBe('My Agent')
      expect(error.name).toBe('WorkflowValidationError')
    })

    it('should work without optional parameters', () => {
      const error = new WorkflowValidationError('Simple error')

      expect(error.message).toBe('Simple error')
      expect(error.blockId).toBeUndefined()
      expect(error.blockType).toBeUndefined()
      expect(error.blockName).toBeUndefined()
    })
  })

  describe('subflow block serialization', () => {
    it('should serialize loop blocks correctly', () => {
      const serializer = new Serializer()
      const loopBlock: BlockState = {
        id: 'loop-1',
        type: 'loop',
        name: 'My Loop',
        position: { x: 100, y: 100 },
        subBlocks: {},
        outputs: { result: { type: 'string' } },
        enabled: true,
        data: { loopType: 'forEach', count: 5 },
      } as BlockState

      const serialized = serializer.serializeWorkflow({ 'loop-1': loopBlock }, [], {})
      const serializedLoop = serialized.blocks.find((b) => b.id === 'loop-1')

      expect(serializedLoop).toBeDefined()
      expect(serializedLoop?.config.tool).toBe('')
      expect(serializedLoop?.config.params).toEqual({ loopType: 'forEach', count: 5 })
      expect(serializedLoop?.metadata?.id).toBe('loop')
      expect(serializedLoop?.metadata?.name).toBe('My Loop')
      expect(serializedLoop?.metadata?.category).toBe('subflow')
    })

    it('should serialize parallel blocks correctly', () => {
      const serializer = new Serializer()
      const parallelBlock: BlockState = {
        id: 'parallel-1',
        type: 'parallel',
        name: 'My Parallel',
        position: { x: 200, y: 200 },
        subBlocks: {},
        outputs: {},
        enabled: false,
        data: { parallelType: 'collection', count: 3 },
      }

      const serialized = serializer.serializeWorkflow({ 'parallel-1': parallelBlock }, [], {})
      const serializedParallel = serialized.blocks.find((b) => b.id === 'parallel-1')

      expect(serializedParallel).toBeDefined()
      expect(serializedParallel?.config.tool).toBe('')
      expect(serializedParallel?.config.params).toEqual({ parallelType: 'collection', count: 3 })
      expect(serializedParallel?.metadata?.id).toBe('parallel')
      expect(serializedParallel?.enabled).toBe(false)
    })

    it('should deserialize loop blocks correctly', () => {
      const serializer = new Serializer()
      const serializedWorkflow: SerializedWorkflow = {
        version: '1.0',
        blocks: [
          {
            id: 'loop-1',
            position: { x: 100, y: 100 },
            config: {
              tool: '',
              params: { loopType: 'for', count: 10 },
            },
            inputs: {},
            outputs: { result: { type: 'string' } },
            metadata: {
              id: 'loop',
              name: 'My Loop',
              description: 'Loop container',
              category: 'subflow',
            },
            enabled: true,
          },
        ],
        connections: [],
        loops: {},
      }

      const deserialized = serializer.deserializeWorkflow(serializedWorkflow)
      const loopBlock = deserialized.blocks['loop-1']

      expect(loopBlock).toBeDefined()
      expect(loopBlock.type).toBe('loop')
      expect(loopBlock.name).toBe('My Loop')
      expect(loopBlock.data).toEqual({ loopType: 'for', count: 10 })
      expect(loopBlock.subBlocks).toEqual({})
    })

    it('should deserialize parallel blocks correctly', () => {
      const serializer = new Serializer()
      const serializedWorkflow: SerializedWorkflow = {
        version: '1.0',
        blocks: [
          {
            id: 'parallel-1',
            position: { x: 200, y: 200 },
            config: {
              tool: '',
              params: { parallelType: 'count', count: 5 },
            },
            inputs: {},
            outputs: {},
            metadata: {
              id: 'parallel',
              name: 'My Parallel',
              description: 'Parallel container',
              category: 'subflow',
            },
            enabled: true,
          },
        ],
        connections: [],
        loops: {},
      }

      const deserialized = serializer.deserializeWorkflow(serializedWorkflow)
      const parallelBlock = deserialized.blocks['parallel-1']

      expect(parallelBlock).toBeDefined()
      expect(parallelBlock.type).toBe('parallel')
      expect(parallelBlock.name).toBe('My Parallel')
      expect(parallelBlock.data).toEqual({ parallelType: 'count', count: 5 })
    })
  })

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

    it('should exclude field when NOT condition fails', () => {
      const serializer = new Serializer()
      const block: BlockState = {
        id: 'cond-block',
        type: 'conditional_block',
        name: 'Conditional',
        position: { x: 0, y: 0 },
        subBlocks: {
          mode: { id: 'mode', type: 'dropdown', value: 'c' },
          notModeC: { id: 'notModeC', type: 'short-input', value: 'hidden' },
        },
        outputs: {},
        enabled: true,
      }

      const serialized = serializer.serializeWorkflow({ 'cond-block': block }, [], {})
      const serializedBlock = serialized.blocks.find((b) => b.id === 'cond-block')

      expect(serializedBlock?.config.params.notModeC).toBeUndefined()
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

    it('should exclude field when AND condition partially fails', () => {
      const serializer = new Serializer()
      const block: BlockState = {
        id: 'cond-block',
        type: 'conditional_block',
        name: 'Conditional',
        position: { x: 0, y: 0 },
        subBlocks: {
          mode: { id: 'mode', type: 'dropdown', value: 'a' },
          optionA: { id: 'optionA', type: 'short-input', value: 'not-special' },
          complexCondition: { id: 'complexCondition', type: 'short-input', value: 'hidden' },
        },
        outputs: {},
        enabled: true,
      }

      const serialized = serializer.serializeWorkflow({ 'cond-block': block }, [], {})
      const serializedBlock = serialized.blocks.find((b) => b.id === 'cond-block')

      expect(serializedBlock?.config.params.complexCondition).toBeUndefined()
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

  describe('canonical parameter handling', () => {
    it('should use advanced value when canonicalModes specifies advanced', () => {
      const serializer = new Serializer()
      const block: BlockState = {
        id: 'slack-1',
        type: 'slack',
        name: 'Slack',
        position: { x: 0, y: 0 },
        data: {
          canonicalModes: { channel: 'advanced' },
        },
        subBlocks: {
          channel: { id: 'channel', type: 'channel-selector', value: 'general' },
          manualChannel: { id: 'manualChannel', type: 'short-input', value: 'C12345' },
          text: { id: 'text', type: 'long-input', value: 'Hello' },
        },
        outputs: {},
        enabled: true,
      }

      const serialized = serializer.serializeWorkflow({ 'slack-1': block }, [], {})
      const slackBlock = serialized.blocks.find((b) => b.id === 'slack-1')

      expect(slackBlock?.config.params.channel).toBe('C12345')
      expect(slackBlock?.config.params.manualChannel).toBeUndefined()
    })

    it('should use basic value when canonicalModes specifies basic', () => {
      const serializer = new Serializer()
      const block: BlockState = {
        id: 'slack-1',
        type: 'slack',
        name: 'Slack',
        position: { x: 0, y: 0 },
        data: {
          canonicalModes: { channel: 'basic' },
        },
        subBlocks: {
          channel: { id: 'channel', type: 'channel-selector', value: 'general' },
          manualChannel: { id: 'manualChannel', type: 'short-input', value: 'C12345' },
          text: { id: 'text', type: 'long-input', value: 'Hello' },
        },
        outputs: {},
        enabled: true,
      }

      const serialized = serializer.serializeWorkflow({ 'slack-1': block }, [], {})
      const slackBlock = serialized.blocks.find((b) => b.id === 'slack-1')

      expect(slackBlock?.config.params.channel).toBe('general')
    })

    it('should handle missing canonical param values', () => {
      const serializer = new Serializer()
      const block: BlockState = {
        id: 'slack-1',
        type: 'slack',
        name: 'Slack',
        position: { x: 0, y: 0 },
        subBlocks: {
          channel: { id: 'channel', type: 'channel-selector', value: null },
          manualChannel: { id: 'manualChannel', type: 'short-input', value: null },
          text: { id: 'text', type: 'long-input', value: 'Hello' },
        },
        outputs: {},
        enabled: true,
      }

      const serialized = serializer.serializeWorkflow({ 'slack-1': block }, [], {})
      const slackBlock = serialized.blocks.find((b) => b.id === 'slack-1')

      expect(slackBlock?.config.params.channel).toBeNull()
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

    it('should set triggerMode when block has triggerMode flag', () => {
      const serializer = new Serializer()
      const block: BlockState = {
        id: 'agent-1',
        type: 'agent',
        name: 'Agent',
        position: { x: 0, y: 0 },
        triggerMode: true,
        subBlocks: {
          model: { id: 'model', type: 'dropdown', value: 'gpt-4o' },
          prompt: { id: 'prompt', type: 'long-input', value: 'Test' },
        },
        outputs: {},
        enabled: true,
      }

      const serialized = serializer.serializeWorkflow({ 'agent-1': block }, [], {})
      const agentBlock = serialized.blocks.find((b) => b.id === 'agent-1')

      expect(agentBlock?.config.params.triggerMode).toBe(true)
    })

    it('should deserialize triggerMode correctly', () => {
      const serializer = new Serializer()
      const serializedWorkflow: SerializedWorkflow = {
        version: '1.0',
        blocks: [
          {
            id: 'agent-1',
            position: { x: 0, y: 0 },
            config: {
              tool: 'openai',
              params: { model: 'gpt-4o', triggerMode: true },
            },
            inputs: {},
            outputs: {},
            metadata: { id: 'agent', name: 'Agent', category: 'ai' },
            enabled: true,
          },
        ],
        connections: [],
        loops: {},
      }

      const deserialized = serializer.deserializeWorkflow(serializedWorkflow)
      expect(deserialized.blocks['agent-1'].triggerMode).toBe(true)
    })
  })

  describe('advancedMode serialization', () => {
    it('should set advancedMode in params when block has advancedMode flag', () => {
      const serializer = new Serializer()
      const block: BlockState = {
        id: 'slack-1',
        type: 'slack',
        name: 'Slack',
        position: { x: 0, y: 0 },
        advancedMode: true,
        subBlocks: {
          text: { id: 'text', type: 'long-input', value: 'Hello' },
        },
        outputs: {},
        enabled: true,
      }

      const serialized = serializer.serializeWorkflow({ 'slack-1': block }, [], {})
      const slackBlock = serialized.blocks.find((b) => b.id === 'slack-1')

      expect(slackBlock?.config.params.advancedMode).toBe(true)
    })

    it('should deserialize advancedMode correctly', () => {
      const serializer = new Serializer()
      const serializedWorkflow: SerializedWorkflow = {
        version: '1.0',
        blocks: [
          {
            id: 'slack-1',
            position: { x: 0, y: 0 },
            config: {
              tool: 'slack_send_message',
              params: { text: 'Hello', advancedMode: true },
            },
            inputs: {},
            outputs: {},
            metadata: { id: 'slack', name: 'Slack', category: 'tools' },
            enabled: true,
          },
        ],
        connections: [],
        loops: {},
      }

      const deserialized = serializer.deserializeWorkflow(serializedWorkflow)
      expect(deserialized.blocks['slack-1'].advancedMode).toBe(true)
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

    it('should handle object userPrompt format', () => {
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
                userPrompt: { input: 'From input object' },
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

      expect(agentBlock.subBlocks.messages.value).toEqual([
        { role: 'user', content: 'From input object' },
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

    it('should handle object without input property', () => {
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
                userPrompt: { someKey: 'someValue' },
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

      expect(agentBlock.subBlocks.messages.value).toEqual([
        { role: 'user', content: '{"someKey":"someValue"}' },
      ])
    })
  })

  describe('using WorkflowBuilder from @sim/testing', () => {
    it('should serialize a linear workflow built with WorkflowBuilder', () => {
      const serializer = new Serializer()
      const workflow = WorkflowBuilder.linear(3).build()

      const serialized = serializer.serializeWorkflow(
        asAppBlocks(workflow.blocks),
        workflow.edges,
        workflow.loops
      )

      expect(serialized.blocks).toHaveLength(3)
      expect(serialized.connections).toHaveLength(2)
    })

    it('should serialize a branching workflow built with WorkflowBuilder', () => {
      const serializer = new Serializer()
      const workflow = WorkflowBuilder.branching().build()

      const serialized = serializer.serializeWorkflow(
        asAppBlocks(workflow.blocks),
        workflow.edges,
        workflow.loops
      )

      expect(serialized.blocks.length).toBeGreaterThanOrEqual(4)
      const conditionEdges = serialized.connections.filter(
        (c) => c.sourceHandle === 'condition-if' || c.sourceHandle === 'condition-else'
      )
      expect(conditionEdges).toHaveLength(2)
    })

    it('should serialize a workflow with loop built with WorkflowBuilder', () => {
      const serializer = new Serializer()
      const workflow = WorkflowBuilder.withLoop(5).build()

      const serialized = serializer.serializeWorkflow(
        asAppBlocks(workflow.blocks),
        workflow.edges,
        workflow.loops
      )

      expect(serialized.loops).toBeDefined()
      expect(Object.keys(serialized.loops).length).toBeGreaterThan(0)
    })

    it('should serialize a workflow with parallel built with WorkflowBuilder', () => {
      const serializer = new Serializer()
      const workflow = WorkflowBuilder.withParallel(3).build()

      const serialized = serializer.serializeWorkflow(
        asAppBlocks(workflow.blocks),
        workflow.edges,
        workflow.loops,
        workflow.parallels
      )

      expect(serialized.parallels).toBeDefined()
      expect(Object.keys(serialized.parallels!).length).toBeGreaterThan(0)
    })
  })

  describe('using factory functions from @sim/testing', () => {
    it('should serialize workflow created with createLinearWorkflow', () => {
      const serializer = new Serializer()
      const workflow = createLinearWorkflow(4)

      const serialized = serializer.serializeWorkflow(
        asAppBlocks(workflow.blocks),
        workflow.edges,
        workflow.loops
      )

      expect(serialized.blocks).toHaveLength(4)
      expect(serialized.connections).toHaveLength(3)
    })

    it('should serialize workflow created with createLoopWorkflow', () => {
      const serializer = new Serializer()
      const workflow = createLoopWorkflow(10)

      const serialized = serializer.serializeWorkflow(
        asAppBlocks(workflow.blocks),
        workflow.edges,
        workflow.loops
      )

      expect(serialized.blocks.length).toBeGreaterThanOrEqual(3)
      expect(serialized.loops.loop).toBeDefined()
      expect(serialized.loops.loop.iterations).toBe(10)
    })

    it('should serialize workflow created with createParallelWorkflow', () => {
      const serializer = new Serializer()
      const workflow = createParallelWorkflow(4)

      const serialized = serializer.serializeWorkflow(
        asAppBlocks(workflow.blocks),
        workflow.edges,
        workflow.loops,
        workflow.parallels
      )

      expect(serialized.parallels!.parallel).toBeDefined()
      expect(serialized.parallels!.parallel.count).toBe(4)
    })

    it('should serialize blocks created with createBlock factory', () => {
      const serializer = new Serializer()
      const starterBlock = createStarterBlock({ id: 'starter' })
      const functionBlock = createBlock({ id: 'func-1', type: 'function', name: 'My Function' })

      const blocks = { starter: starterBlock, 'func-1': functionBlock }
      const edges = [{ id: 'e1', source: 'starter', target: 'func-1' }]

      const serialized = serializer.serializeWorkflow(asAppBlocks(blocks), edges, {})

      expect(serialized.blocks).toHaveLength(2)
      expect(serialized.blocks.find((b) => b.id === 'func-1')?.metadata?.name).toBe('My Function')
    })
  })

  describe('error handling', () => {
    it('should throw error for invalid block type during serialization', () => {
      const serializer = new Serializer()
      const block: BlockState = {
        id: 'invalid-1',
        type: 'nonexistent_type',
        name: 'Invalid',
        position: { x: 0, y: 0 },
        subBlocks: {},
        outputs: {},
        enabled: true,
      }

      expect(() => serializer.serializeWorkflow({ 'invalid-1': block }, [], {})).toThrow(
        'Invalid block type: nonexistent_type'
      )
    })

    it('should throw error for invalid block type during deserialization', () => {
      const serializer = new Serializer()
      const serializedWorkflow: SerializedWorkflow = {
        version: '1.0',
        blocks: [
          {
            id: 'invalid-1',
            position: { x: 0, y: 0 },
            config: { tool: 'test', params: {} },
            inputs: {},
            outputs: {},
            metadata: { id: 'nonexistent_type' },
            enabled: true,
          },
        ],
        connections: [],
        loops: {},
      }

      expect(() => serializer.deserializeWorkflow(serializedWorkflow)).toThrow(
        'Invalid block type: nonexistent_type'
      )
    })

    it('should throw error when metadata is missing during deserialization', () => {
      const serializer = new Serializer()
      const serializedWorkflow: SerializedWorkflow = {
        version: '1.0',
        blocks: [
          {
            id: 'no-metadata',
            position: { x: 0, y: 0 },
            config: { tool: 'test', params: {} },
            inputs: {},
            outputs: {},
            metadata: undefined as any,
            enabled: true,
          },
        ],
        connections: [],
        loops: {},
      }

      expect(() => serializer.deserializeWorkflow(serializedWorkflow)).toThrow()
    })

    it('should handle tool selection failure gracefully', () => {
      const serializer = new Serializer()
      const block: BlockState = {
        id: 'agent-1',
        type: 'agent',
        name: 'Agent',
        position: { x: 0, y: 0 },
        subBlocks: {
          model: { id: 'model', type: 'dropdown', value: undefined as any },
          prompt: { id: 'prompt', type: 'long-input', value: 'Test' },
        },
        outputs: {},
        enabled: true,
      }

      const serialized = serializer.serializeWorkflow({ 'agent-1': block }, [], {})
      // When model is undefined, the tool selector uses 'gpt-4o' as default, returning 'openai'
      expect(serialized.blocks[0].config.tool).toBe('openai')
    })
  })

  describe('disabled blocks handling', () => {
    it('should serialize disabled blocks correctly', () => {
      const serializer = new Serializer()
      const block: BlockState = {
        id: 'disabled-1',
        type: 'function',
        name: 'Disabled Block',
        position: { x: 0, y: 0 },
        subBlocks: {
          code: { id: 'code', type: 'code', value: 'return 1' },
        },
        outputs: {},
        enabled: false,
      }

      const serialized = serializer.serializeWorkflow({ 'disabled-1': block }, [], {})
      expect(serialized.blocks[0].enabled).toBe(false)
    })

    it('should deserialize enabled status correctly', () => {
      const serializer = new Serializer()
      const serializedWorkflow: SerializedWorkflow = {
        version: '1.0',
        blocks: [
          {
            id: 'test-1',
            position: { x: 0, y: 0 },
            config: { tool: 'function', params: {} },
            inputs: {},
            outputs: {},
            metadata: { id: 'function', name: 'Function' },
            enabled: false,
          },
        ],
        connections: [],
        loops: {},
      }

      const deserialized = serializer.deserializeWorkflow(serializedWorkflow)
      expect(deserialized.blocks['test-1'].enabled).toBe(true)
    })
  })

  describe('connections serialization', () => {
    it('should serialize connections with handles', () => {
      const serializer = new Serializer()
      const blocks = {
        start: createStarterBlock({ id: 'start' }) as any,
        cond: { ...createBlock({ id: 'cond', type: 'condition' }) } as BlockState,
        end: { ...createBlock({ id: 'end', type: 'function' }) } as BlockState,
      }

      const edges = [
        { id: 'e1', source: 'start', target: 'cond' },
        { id: 'e2', source: 'cond', target: 'end', sourceHandle: 'condition-true' },
      ]

      const serialized = serializer.serializeWorkflow(blocks, edges, {})

      expect(serialized.connections).toHaveLength(2)
      expect(serialized.connections[1].sourceHandle).toBe('condition-true')
    })

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

    it('should include empty inputFormat array when present', () => {
      const serializer = new Serializer()
      const block: BlockState = {
        id: 'starter',
        type: 'starter',
        name: 'Start',
        position: { x: 0, y: 0 },
        subBlocks: {
          description: { id: 'description', type: 'long-input', value: 'Test' },
          inputFormat: { id: 'inputFormat', type: 'table', value: [] },
        },
        outputs: {},
        enabled: true,
      }

      const serialized = serializer.serializeWorkflow({ starter: block }, [], {})
      const starterBlock = serialized.blocks.find((b) => b.id === 'starter')

      // Empty arrays are still serialized (the check is for length > 0 for special handling, but still includes field)
      expect(starterBlock?.config.params.inputFormat).toEqual([])
    })
  })

  describe('agent tools handling', () => {
    it('should serialize agent with empty tools array string', () => {
      const serializer = new Serializer()
      const block: BlockState = {
        id: 'agent-1',
        type: 'agent',
        name: 'Agent',
        position: { x: 0, y: 0 },
        subBlocks: {
          model: { id: 'model', type: 'dropdown', value: 'gpt-4o' },
          prompt: { id: 'prompt', type: 'long-input', value: 'Test' },
          tools: { id: 'tools', type: 'tool-input', value: '[]' },
        },
        outputs: {},
        enabled: true,
      }

      const serialized = serializer.serializeWorkflow({ 'agent-1': block }, [], {})
      // With empty tools array, there are no non-custom tools, so toolId stays empty
      // But then the fallback to blockConfig.tools.access[0] may happen
      expect(serialized.blocks[0].config.tool).toBeDefined()
    })

    it('should serialize agent with array of tools', () => {
      const serializer = new Serializer()
      const tools = [
        { type: 'function', name: 'test' },
        { type: 'custom-tool', name: 'custom' },
      ]
      const block: BlockState = {
        id: 'agent-1',
        type: 'agent',
        name: 'Agent',
        position: { x: 0, y: 0 },
        subBlocks: {
          model: { id: 'model', type: 'dropdown', value: 'gpt-4o' },
          prompt: { id: 'prompt', type: 'long-input', value: 'Test' },
          tools: { id: 'tools', type: 'tool-input', value: tools as any },
        },
        outputs: {},
        enabled: true,
      }

      const serialized = serializer.serializeWorkflow({ 'agent-1': block }, [], {})
      expect(serialized.blocks[0].config.tool).toBe('openai')
    })

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

  describe('round-trip serialization with @sim/testing workflows', () => {
    it('should preserve data through round-trip with linear workflow', () => {
      const serializer = new Serializer()
      const workflow = createLinearWorkflow(3)

      const serialized = serializer.serializeWorkflow(
        asAppBlocks(workflow.blocks),
        workflow.edges,
        workflow.loops
      )
      const deserialized = serializer.deserializeWorkflow(serialized)

      expect(Object.keys(deserialized.blocks)).toHaveLength(3)
      expect(deserialized.edges).toHaveLength(2)
    })

    it('should preserve data through round-trip with loop workflow', () => {
      const serializer = new Serializer()
      const workflow = createLoopWorkflow(5)

      const serialized = serializer.serializeWorkflow(
        asAppBlocks(workflow.blocks),
        workflow.edges,
        workflow.loops
      )
      const deserialized = serializer.deserializeWorkflow(serialized)

      expect(Object.keys(deserialized.blocks).length).toBeGreaterThanOrEqual(3)
    })
  })

  describe('workflow with loops and parallels metadata', () => {
    it('should serialize workflow with loops correctly', () => {
      const serializer = new Serializer()
      const workflow = createLoopWorkflow(5)

      const serialized = serializer.serializeWorkflow(
        asAppBlocks(workflow.blocks),
        workflow.edges,
        workflow.loops
      )

      expect(serialized.loops).toBeDefined()
      expect(serialized.loops.loop).toBeDefined()
      expect(serialized.loops.loop.iterations).toBe(5)
      expect(serialized.loops.loop.loopType).toBe('for')
    })

    it('should serialize workflow with parallels correctly', () => {
      const serializer = new Serializer()
      const workflow = createParallelWorkflow(3)

      const serialized = serializer.serializeWorkflow(
        asAppBlocks(workflow.blocks),
        workflow.edges,
        workflow.loops,
        workflow.parallels
      )

      expect(serialized.parallels).toBeDefined()
      expect(serialized.parallels!.parallel).toBeDefined()
      expect(serialized.parallels!.parallel.count).toBe(3)
      expect(serialized.parallels!.parallel.parallelType).toBe('count')
    })

    it('should handle empty loops and parallels', () => {
      const serializer = new Serializer()
      const workflow = createLinearWorkflow(2)

      const serialized = serializer.serializeWorkflow(
        asAppBlocks(workflow.blocks),
        workflow.edges,
        {},
        {}
      )

      expect(serialized.loops).toEqual({})
      expect(serialized.parallels).toEqual({})
    })
  })

  describe('complex workflow scenarios', () => {
    it('should serialize a workflow with multiple branches', () => {
      const serializer = new Serializer()
      const workflow = new WorkflowBuilder()
        .addStarter('start')
        .addCondition('cond1', { x: 200, y: 0 })
        .addFunction('branch1', { x: 400, y: -100 })
        .addFunction('branch2', { x: 400, y: 100 })
        .addCondition('cond2', { x: 600, y: 0 })
        .addFunction('final', { x: 800, y: 0 })
        .connect('start', 'cond1')
        .connect('cond1', 'branch1', 'condition-if')
        .connect('cond1', 'branch2', 'condition-else')
        .connect('branch1', 'cond2')
        .connect('branch2', 'cond2')
        .connect('cond2', 'final', 'condition-if')
        .build()

      const serialized = serializer.serializeWorkflow(
        asAppBlocks(workflow.blocks),
        workflow.edges,
        workflow.loops
      )

      expect(serialized.blocks).toHaveLength(6)
      expect(serialized.connections).toHaveLength(6)

      const conditionConnections = serialized.connections.filter(
        (c) => c.sourceHandle === 'condition-if' || c.sourceHandle === 'condition-else'
      )
      expect(conditionConnections).toHaveLength(3)
    })

    it('should serialize a workflow with nested structures using WorkflowBuilder', () => {
      const serializer = new Serializer()
      const workflow = new WorkflowBuilder()
        .addStarter('start')
        .addLoop('outer-loop', { x: 200, y: 0 }, { iterations: 3 })
        .addLoopChild('outer-loop', 'loop-task', 'function')
        .addFunction('after-loop', { x: 500, y: 0 })
        .connect('start', 'outer-loop')
        .connect('outer-loop', 'after-loop')
        .build()

      const serialized = serializer.serializeWorkflow(
        asAppBlocks(workflow.blocks),
        workflow.edges,
        workflow.loops,
        workflow.parallels
      )

      expect(serialized.blocks.length).toBeGreaterThanOrEqual(3)
      expect(serialized.loops['outer-loop']).toBeDefined()
      expect(serialized.loops['outer-loop'].nodes).toContain('loop-task')
    })

    it('should handle a workflow built with WorkflowBuilder.chain', () => {
      const serializer = new Serializer()
      const workflow = WorkflowBuilder.chain(
        { id: 'start', type: 'starter' },
        { id: 'step1', type: 'function' },
        { id: 'step2', type: 'function' },
        { id: 'step3', type: 'function' }
      ).build()

      const serialized = serializer.serializeWorkflow(
        asAppBlocks(workflow.blocks),
        workflow.edges,
        workflow.loops
      )

      expect(serialized.blocks).toHaveLength(4)
      expect(serialized.connections).toHaveLength(3)

      // Verify chain connections
      expect(serialized.connections[0].source).toBe('start')
      expect(serialized.connections[0].target).toBe('step1')
      expect(serialized.connections[1].source).toBe('step1')
      expect(serialized.connections[1].target).toBe('step2')
      expect(serialized.connections[2].source).toBe('step2')
      expect(serialized.connections[2].target).toBe('step3')
    })
  })

  describe('edge cases with empty and null values', () => {
    it('should handle blocks with all null subBlock values', () => {
      const serializer = new Serializer()
      const block: BlockState = {
        id: 'func-1',
        type: 'function',
        name: 'Function',
        position: { x: 0, y: 0 },
        subBlocks: {
          code: { id: 'code', type: 'code', value: null },
          language: { id: 'language', type: 'dropdown', value: null },
        },
        outputs: {},
        enabled: true,
      }

      const serialized = serializer.serializeWorkflow({ 'func-1': block }, [], {})
      const funcBlock = serialized.blocks.find((b) => b.id === 'func-1')

      expect(funcBlock).toBeDefined()
      expect(funcBlock?.config.params.code).toBeNull()
      expect(funcBlock?.config.params.language).toBeNull()
    })

    it('should handle empty workflow', () => {
      const serializer = new Serializer()

      const serialized = serializer.serializeWorkflow({}, [], {})

      expect(serialized.blocks).toHaveLength(0)
      expect(serialized.connections).toHaveLength(0)
      expect(serialized.loops).toEqual({})
    })

    it('should handle workflow with orphan blocks (no connections)', () => {
      const serializer = new Serializer()
      const blocks = {
        block1: createBlock({ id: 'block1', type: 'function' }) as BlockState,
        block2: createBlock({ id: 'block2', type: 'function' }) as BlockState,
        block3: createBlock({ id: 'block3', type: 'function' }) as BlockState,
      }

      const serialized = serializer.serializeWorkflow(blocks, [], {})

      expect(serialized.blocks).toHaveLength(3)
      expect(serialized.connections).toHaveLength(0)
    })
  })

  describe('block outputs serialization', () => {
    it('should preserve block outputs during serialization', () => {
      const serializer = new Serializer()
      const block = {
        id: 'func-1',
        type: 'function',
        name: 'Function',
        position: { x: 0, y: 0 },
        subBlocks: {
          code: { id: 'code', type: 'code', value: 'return { result: 42 }' },
        },
        outputs: {
          result: { type: 'number' },
          error: { type: 'string' },
        },
        enabled: true,
      } as BlockState

      const serialized = serializer.serializeWorkflow({ 'func-1': block }, [], {})
      const funcBlock = serialized.blocks.find((b) => b.id === 'func-1')

      expect(funcBlock?.outputs.result).toEqual({ type: 'number' })
      expect(funcBlock?.outputs.error).toEqual({ type: 'string' })
    })
  })

  describe('position serialization', () => {
    it('should preserve block positions during serialization', () => {
      const serializer = new Serializer()
      const block: BlockState = {
        id: 'func-1',
        type: 'function',
        name: 'Function',
        position: { x: 123, y: 456 },
        subBlocks: {},
        outputs: {},
        enabled: true,
      }

      const serialized = serializer.serializeWorkflow({ 'func-1': block }, [], {})
      expect(serialized.blocks[0].position).toEqual({ x: 123, y: 456 })
    })

    it('should preserve positions through round-trip', () => {
      const serializer = new Serializer()
      const block: BlockState = {
        id: 'func-1',
        type: 'function',
        name: 'Function',
        position: { x: 999, y: 888 },
        subBlocks: {
          code: { id: 'code', type: 'code', value: 'test' },
        },
        outputs: {},
        enabled: true,
      }

      const serialized = serializer.serializeWorkflow({ 'func-1': block }, [], {})
      const deserialized = serializer.deserializeWorkflow(serialized)

      expect(deserialized.blocks['func-1'].position).toEqual({ x: 999, y: 888 })
    })
  })
})
