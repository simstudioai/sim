/**
 * @vitest-environment jsdom
 *
 * Serializer Class Unit Tests
 *
 * This file contains unit tests for the Serializer class, which is responsible for
 * converting between workflow state (blocks, edges, loops) and serialized format
 * used by the executor.
 */

import {
  createAgentWithToolsWorkflowState,
  createComplexWorkflowState,
  createConditionalWorkflowState,
  createInvalidSerializedWorkflow,
  createInvalidWorkflowState,
  createLoopWorkflowState,
  createMinimalWorkflowState,
  createMissingMetadataWorkflow,
} from '@sim/testing/factories'
import { blocksMock, loggerMock, toolsUtilsMock } from '@sim/testing/mocks'
import { describe, expect, it, vi } from 'vitest'
import { Serializer } from '@/serializer/index'
import type { SerializedWorkflow } from '@/serializer/types'

vi.mock('@/blocks', () => blocksMock)
vi.mock('@/tools/utils', () => toolsUtilsMock)
vi.mock('@sim/logger', () => loggerMock)

describe('Serializer', () => {
  describe('serializeWorkflow', () => {
    it.concurrent('should serialize a minimal workflow correctly', () => {
      const { blocks, edges, loops } = createMinimalWorkflowState()
      const serializer = new Serializer()

      const serialized = serializer.serializeWorkflow(blocks, edges, loops)

      expect(serialized.blocks).toHaveLength(2)

      const starterBlock = serialized.blocks.find((b) => b.id === 'starter')
      expect(starterBlock).toBeDefined()
      expect(starterBlock?.metadata?.id).toBe('starter')
      expect(starterBlock?.config.tool).toBe('starter')
      expect(starterBlock?.config.params.description).toBe('This is the starter block')

      const agentBlock = serialized.blocks.find((b) => b.id === 'agent1')
      expect(agentBlock).toBeDefined()
      expect(agentBlock?.metadata?.id).toBe('agent')
      expect(agentBlock?.config.params.prompt).toBe('Hello, world!')
      expect(agentBlock?.config.params.model).toBe('claude-3-7-sonnet-20250219')

      expect(serialized.connections).toHaveLength(1)
      expect(serialized.connections[0].source).toBe('starter')
      expect(serialized.connections[0].target).toBe('agent1')
    })

    it.concurrent('should serialize a conditional workflow correctly', () => {
      const { blocks, edges, loops } = createConditionalWorkflowState()
      const serializer = new Serializer()

      const serialized = serializer.serializeWorkflow(blocks, edges, loops)

      expect(serialized.blocks).toHaveLength(4)

      const conditionBlock = serialized.blocks.find((b) => b.id === 'condition1')
      expect(conditionBlock).toBeDefined()
      expect(conditionBlock?.metadata?.id).toBe('condition')
      expect(conditionBlock?.config.tool).toBe('condition')
      expect(conditionBlock?.config.params.condition).toBe('input.value > 10')

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

      expect(Object.keys(serialized.loops)).toHaveLength(1)
      expect(serialized.loops.loop1).toBeDefined()
      expect(serialized.loops.loop1.nodes).toContain('function1')
      expect(serialized.loops.loop1.nodes).toContain('condition1')
      expect(serialized.loops.loop1.iterations).toBe(10)

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

      expect(serialized.blocks).toHaveLength(4)

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

      const functionBlock = serialized.blocks.find((b) => b.id === 'function1')
      expect(functionBlock).toBeDefined()
      expect(functionBlock?.metadata?.id).toBe('function')
      expect(functionBlock?.config.tool).toBe('function')
      expect(functionBlock?.config.params.language).toBe('javascript')

      const agentBlock = serialized.blocks.find((b) => b.id === 'agent1')
      expect(agentBlock).toBeDefined()
      expect(agentBlock?.metadata?.id).toBe('agent')
      expect(agentBlock?.config.tool).toBe('openai')
      expect(agentBlock?.config.params.model).toBe('gpt-4o')
    })

    it.concurrent('should serialize agent block with custom tools correctly', () => {
      const { blocks, edges, loops } = createAgentWithToolsWorkflowState()
      const serializer = new Serializer()

      const serialized = serializer.serializeWorkflow(blocks, edges, loops)

      const agentBlock = serialized.blocks.find((b) => b.id === 'agent1')
      expect(agentBlock).toBeDefined()
      expect(agentBlock?.config.tool).toBe('openai')
      expect(agentBlock?.config.params.model).toBe('gpt-4o')

      const toolsParam = agentBlock?.config.params.tools
      expect(toolsParam).toBeDefined()

      const tools = JSON.parse(toolsParam as string)
      expect(tools).toHaveLength(2)

      const customTool = tools.find((t: any) => t.type === 'custom-tool')
      expect(customTool).toBeDefined()
      expect(customTool.name).toBe('weather')

      const functionTool = tools.find((t: any) => t.type === 'function')
      expect(functionTool).toBeDefined()
      expect(functionTool.name).toBe('calculator')
    })

    it.concurrent('should handle invalid block types gracefully', () => {
      const { blocks, edges, loops } = createInvalidWorkflowState()
      const serializer = new Serializer()

      expect(() => serializer.serializeWorkflow(blocks, edges, loops)).toThrow(
        'Invalid block type: invalid-type'
      )
    })
  })

  describe('deserializeWorkflow', () => {
    it.concurrent('should deserialize a serialized workflow correctly', () => {
      const { blocks, edges, loops } = createMinimalWorkflowState()
      const serializer = new Serializer()

      const serialized = serializer.serializeWorkflow(blocks, edges, loops)

      const deserialized = serializer.deserializeWorkflow(serialized)

      expect(Object.keys(deserialized.blocks)).toHaveLength(2)

      const starterBlock = deserialized.blocks.starter
      expect(starterBlock).toBeDefined()
      expect(starterBlock.type).toBe('starter')
      expect(starterBlock.name).toBe('Starter Block')
      expect(starterBlock.subBlocks.description.value).toBe('This is the starter block')

      const agentBlock = deserialized.blocks.agent1
      expect(agentBlock).toBeDefined()
      expect(agentBlock.type).toBe('agent')
      expect(agentBlock.name).toBe('Agent Block')
      expect(agentBlock.subBlocks.prompt.value).toBe('Hello, world!')
      expect(agentBlock.subBlocks.model.value).toBe('claude-3-7-sonnet-20250219')

      expect(deserialized.edges).toHaveLength(1)
      expect(deserialized.edges[0].source).toBe('starter')
      expect(deserialized.edges[0].target).toBe('agent1')
    })

    it.concurrent('should deserialize a complex workflow with all block types', () => {
      const { blocks, edges, loops } = createComplexWorkflowState()
      const serializer = new Serializer()

      const serialized = serializer.serializeWorkflow(blocks, edges, loops)

      const deserialized = serializer.deserializeWorkflow(serialized)

      expect(Object.keys(deserialized.blocks)).toHaveLength(4)

      const apiBlock = deserialized.blocks.api1
      expect(apiBlock).toBeDefined()
      expect(apiBlock.type).toBe('api')
      expect(apiBlock.subBlocks.url.value).toBe('https://api.example.com/data')
      expect(apiBlock.subBlocks.method.value).toBe('GET')
      expect(apiBlock.subBlocks.headers.value).toEqual([
        ['Content-Type', 'application/json'],
        ['Authorization', 'Bearer {{API_KEY}}'],
      ])

      const functionBlock = deserialized.blocks.function1
      expect(functionBlock).toBeDefined()
      expect(functionBlock.type).toBe('function')
      expect(functionBlock.subBlocks.language.value).toBe('javascript')

      const agentBlock = deserialized.blocks.agent1
      expect(agentBlock).toBeDefined()
      expect(agentBlock.type).toBe('agent')
      expect(agentBlock.subBlocks.model.value).toBe('gpt-4o')
      expect(agentBlock.subBlocks.provider.value).toBe('openai')
    })

    it.concurrent('should handle serialized workflow with invalid block metadata', () => {
      const invalidWorkflow = createInvalidSerializedWorkflow() as SerializedWorkflow
      const serializer = new Serializer()

      expect(() => serializer.deserializeWorkflow(invalidWorkflow)).toThrow(
        'Invalid block type: non-existent-type'
      )
    })

    it.concurrent('should handle serialized workflow with missing metadata', () => {
      const invalidWorkflow = createMissingMetadataWorkflow() as SerializedWorkflow
      const serializer = new Serializer()

      expect(() => serializer.deserializeWorkflow(invalidWorkflow)).toThrow()
    })
  })

  describe('round-trip serialization', () => {
    it.concurrent('should preserve all data through serialization and deserialization', () => {
      const { blocks, edges, loops } = createComplexWorkflowState()
      const serializer = new Serializer()

      const serialized = serializer.serializeWorkflow(blocks, edges, loops)

      const deserialized = serializer.deserializeWorkflow(serialized)

      const reserialized = serializer.serializeWorkflow(
        deserialized.blocks,
        deserialized.edges,
        loops
      )

      expect(reserialized.blocks.length).toBe(serialized.blocks.length)
      expect(reserialized.connections.length).toBe(serialized.connections.length)

      serialized.blocks.forEach((originalBlock) => {
        const reserializedBlock = reserialized.blocks.find((b) => b.id === originalBlock.id)

        expect(reserializedBlock).toBeDefined()
        expect(reserializedBlock?.config.tool).toBe(originalBlock.config.tool)
        expect(reserializedBlock?.metadata?.id).toBe(originalBlock.metadata?.id)

        Object.entries(originalBlock.config.params).forEach(([key, value]) => {
          if (value !== null) {
            expect(reserializedBlock?.config.params[key]).toEqual(value)
          }
        })
      })

      expect(reserialized.connections).toEqual(serialized.connections)

      expect(reserialized.loops).toEqual(serialized.loops)
    })
  })

  describe('validation during serialization', () => {
    it.concurrent('should throw error for missing user-only required fields', () => {
      const serializer = new Serializer()

      const blockWithMissingUserOnlyField: any = {
        id: 'test-block',
        type: 'jina',
        name: 'Test Jina Block',
        position: { x: 0, y: 0 },
        subBlocks: {
          url: { value: 'https://example.com' },
          apiKey: { value: null },
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

    it.concurrent('should skip validation for disabled blocks', () => {
      const serializer = new Serializer()

      const disabledBlockWithMissingField: any = {
        id: 'test-block',
        type: 'jina',
        name: 'Disabled Jina Block',
        position: { x: 0, y: 0 },
        subBlocks: {
          url: { value: 'https://example.com' },
          apiKey: { value: null },
        },
        outputs: {},
        enabled: false,
      }

      expect(() => {
        serializer.serializeWorkflow(
          { 'test-block': disabledBlockWithMissingField },
          [],
          {},
          undefined,
          true
        )
      }).not.toThrow()
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

      const blockWithMissingUserOrLlmField: any = {
        id: 'test-block',
        type: 'reddit',
        name: 'Test Reddit Block',
        position: { x: 0, y: 0 },
        subBlocks: {
          operation: { value: 'get_posts' },
          credential: { value: 'test-credential' },
          subreddit: { value: null },
        },
        outputs: {},
        enabled: true,
      }

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
          apiKey: { value: null },
        },
        outputs: {},
        enabled: true,
      }

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
          url: { value: null },
          apiKey: { value: null },
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
        type: 'condition',
        name: 'Test Condition Block',
        position: { x: 0, y: 0 },
        subBlocks: {
          condition: { value: null },
        },
        outputs: {},
        enabled: true,
      }

      expect(() => {
        serializer.serializeWorkflow({ 'test-block': blockWithNoTools }, [], {}, undefined, true)
      }).not.toThrow()
    })

    it.concurrent(
      'should validate required fields for blocks without tools (empty tools.access)',
      () => {
        const serializer = new Serializer()

        const waitBlockMissingRequired: any = {
          id: 'wait-block',
          type: 'wait',
          name: 'Wait Block',
          position: { x: 0, y: 0 },
          subBlocks: {
            timeValue: { value: '' },
            timeUnit: { value: 'seconds' },
          },
          outputs: {},
          enabled: true,
        }

        expect(() => {
          serializer.serializeWorkflow(
            { 'wait-block': waitBlockMissingRequired },
            [],
            {},
            undefined,
            true
          )
        }).toThrow('Wait Block is missing required fields: Wait Amount')
      }
    )

    it.concurrent(
      'should pass validation for blocks without tools when required fields are present',
      () => {
        const serializer = new Serializer()

        const waitBlockWithFields: any = {
          id: 'wait-block',
          type: 'wait',
          name: 'Wait Block',
          position: { x: 0, y: 0 },
          subBlocks: {
            timeValue: { value: '10' },
            timeUnit: { value: 'seconds' },
          },
          outputs: {},
          enabled: true,
        }

        expect(() => {
          serializer.serializeWorkflow(
            { 'wait-block': waitBlockWithFields },
            [],
            {},
            undefined,
            true
          )
        }).not.toThrow()
      }
    )

    it.concurrent('should report all missing required fields for blocks without tools', () => {
      const serializer = new Serializer()

      const waitBlockAllMissing: any = {
        id: 'wait-block',
        type: 'wait',
        name: 'Wait Block',
        position: { x: 0, y: 0 },
        subBlocks: {
          timeValue: { value: null },
          timeUnit: { value: '' },
        },
        outputs: {},
        enabled: true,
      }

      expect(() => {
        serializer.serializeWorkflow({ 'wait-block': waitBlockAllMissing }, [], {}, undefined, true)
      }).toThrow('Wait Block is missing required fields: Wait Amount, Unit')
    })

    it.concurrent('should skip validation for disabled blocks without tools', () => {
      const serializer = new Serializer()

      const disabledWaitBlock: any = {
        id: 'wait-block',
        type: 'wait',
        name: 'Wait Block',
        position: { x: 0, y: 0 },
        subBlocks: {
          timeValue: { value: null },
          timeUnit: { value: null },
        },
        outputs: {},
        enabled: false,
      }

      expect(() => {
        serializer.serializeWorkflow({ 'wait-block': disabledWaitBlock }, [], {}, undefined, true)
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
          apiKey: { value: '' },
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

      const mixedBlock: any = {
        id: 'test-block',
        type: 'reddit',
        name: 'Test Reddit Block',
        position: { x: 0, y: 0 },
        subBlocks: {
          operation: { value: 'get_posts' },
          credential: { value: null },
          subreddit: { value: null },
        },
        outputs: {},
        enabled: true,
      }

      expect(() => {
        serializer.serializeWorkflow({ 'test-block': mixedBlock }, [], {}, undefined, true)
      }).toThrow('Test Reddit Block is missing required fields: Reddit Account')
    })
  })

  describe('canonical mode field selection', () => {
    it.concurrent('should use advanced value when canonicalModes specifies advanced', () => {
      const serializer = new Serializer()

      const block: any = {
        id: 'slack-1',
        type: 'slack',
        name: 'Test Slack Block',
        position: { x: 0, y: 0 },
        data: {
          canonicalModes: { channel: 'advanced' },
        },
        subBlocks: {
          operation: { value: 'send' },
          destinationType: { value: 'channel' },
          channel: { value: 'general' },
          manualChannel: { value: 'C1234567890' },
          text: { value: 'Hello world' },
          username: { value: 'bot' },
        },
        outputs: {},
        enabled: true,
      }

      const serialized = serializer.serializeWorkflow({ 'slack-1': block }, [], {})
      const slackBlock = serialized.blocks.find((b) => b.id === 'slack-1')

      expect(slackBlock).toBeDefined()
      expect(slackBlock?.config.params.channel).toBe('C1234567890')
      expect(slackBlock?.config.params.manualChannel).toBeUndefined()
      expect(slackBlock?.config.params.text).toBe('Hello world')
      expect(slackBlock?.config.params.username).toBe('bot')
    })

    it.concurrent('should use basic value when canonicalModes specifies basic', () => {
      const serializer = new Serializer()

      const block: any = {
        id: 'slack-1',
        type: 'slack',
        name: 'Test Slack Block',
        position: { x: 0, y: 0 },
        data: {
          canonicalModes: { channel: 'basic' },
        },
        subBlocks: {
          operation: { value: 'send' },
          destinationType: { value: 'channel' },
          channel: { value: 'general' },
          manualChannel: { value: 'C1234567890' },
          text: { value: 'Hello world' },
          username: { value: 'bot' },
        },
        outputs: {},
        enabled: true,
      }

      const serialized = serializer.serializeWorkflow({ 'slack-1': block }, [], {})
      const slackBlock = serialized.blocks.find((b) => b.id === 'slack-1')

      expect(slackBlock).toBeDefined()
      expect(slackBlock?.config.params.channel).toBe('general')
      expect(slackBlock?.config.params.manualChannel).toBeUndefined()
      expect(slackBlock?.config.params.text).toBe('Hello world')
      expect(slackBlock?.config.params.username).toBe('bot')
    })

    it.concurrent('should fall back to legacy advancedMode when canonicalModes not set', () => {
      const serializer = new Serializer()

      const block: any = {
        id: 'slack-1',
        type: 'slack',
        name: 'Test Slack Block',
        position: { x: 0, y: 0 },
        advancedMode: true,
        subBlocks: {
          operation: { value: 'send' },
          destinationType: { value: 'channel' },
          channel: { value: 'general' },
          manualChannel: { value: 'C1234567890' },
          text: { value: 'Hello world' },
          username: { value: 'bot' },
        },
        outputs: {},
        enabled: true,
      }

      const serialized = serializer.serializeWorkflow({ 'slack-1': block }, [], {})
      const slackBlock = serialized.blocks.find((b) => b.id === 'slack-1')

      expect(slackBlock).toBeDefined()
      expect(slackBlock?.config.params.channel).toBe('C1234567890')
      expect(slackBlock?.config.params.manualChannel).toBeUndefined()
    })

    it.concurrent('should use basic value by default when no mode specified', () => {
      const serializer = new Serializer()

      const block: any = {
        id: 'slack-1',
        type: 'slack',
        name: 'Test Slack Block',
        position: { x: 0, y: 0 },
        subBlocks: {
          operation: { value: 'send' },
          destinationType: { value: 'channel' },
          channel: { value: 'general' },
          manualChannel: { value: 'C1234567890' },
          text: { value: 'Hello world' },
          username: { value: 'bot' },
        },
        outputs: {},
        enabled: true,
      }

      const serialized = serializer.serializeWorkflow({ 'slack-1': block }, [], {})
      const slackBlock = serialized.blocks.find((b) => b.id === 'slack-1')

      expect(slackBlock).toBeDefined()
      expect(slackBlock?.config.params.channel).toBe('general')
      expect(slackBlock?.config.params.manualChannel).toBeUndefined()
    })

    it.concurrent('should preserve advanced-only values when present in basic mode', () => {
      const serializer = new Serializer()

      const agentInBasicMode: any = {
        id: 'agent-1',
        type: 'agentWithMemories',
        name: 'Test Agent',
        position: { x: 0, y: 0 },
        advancedMode: false,
        subBlocks: {
          systemPrompt: { value: 'You are helpful' },
          userPrompt: { value: 'Hello' },
          memories: { value: [{ role: 'user', content: 'My name is John' }] },
          model: { value: 'claude-3-sonnet' },
        },
        outputs: {},
        enabled: true,
      }

      const serialized = serializer.serializeWorkflow({ 'agent-1': agentInBasicMode }, [], {})

      const agentBlock = serialized.blocks.find((b) => b.id === 'agent-1')
      expect(agentBlock).toBeDefined()

      expect(agentBlock?.config.params.systemPrompt).toBe('You are helpful')
      expect(agentBlock?.config.params.userPrompt).toBe('Hello')
      expect(agentBlock?.config.params.memories).toEqual([
        { role: 'user', content: 'My name is John' },
      ])
      expect(agentBlock?.config.params.model).toBe('claude-3-sonnet')
    })

    it.concurrent('should include memories field when agent is in advanced mode', () => {
      const serializer = new Serializer()

      const agentInAdvancedMode: any = {
        id: 'agent-1',
        type: 'agentWithMemories',
        name: 'Test Agent',
        position: { x: 0, y: 0 },
        advancedMode: true,
        subBlocks: {
          systemPrompt: { value: 'You are helpful' },
          userPrompt: { value: 'Hello' },
          memories: { value: [{ role: 'user', content: 'My name is John' }] },
          model: { value: 'claude-3-sonnet' },
        },
        outputs: {},
        enabled: true,
      }

      const serialized = serializer.serializeWorkflow({ 'agent-1': agentInAdvancedMode }, [], {})

      const agentBlock = serialized.blocks.find((b) => b.id === 'agent-1')
      expect(agentBlock).toBeDefined()

      expect(agentBlock?.config.params.systemPrompt).toBe('You are helpful')
      expect(agentBlock?.config.params.userPrompt).toBe('Hello')
      expect(agentBlock?.config.params.memories).toEqual([
        { role: 'user', content: 'My name is John' },
      ])
      expect(agentBlock?.config.params.model).toBe('claude-3-sonnet')
    })

    it.concurrent('should handle blocks with no matching subblock config gracefully', () => {
      const serializer = new Serializer()

      const blockWithUnknownField: any = {
        id: 'slack-1',
        type: 'slack',
        name: 'Test Slack Block',
        position: { x: 0, y: 0 },
        advancedMode: false,
        subBlocks: {
          channel: { value: 'general' },
          unknownField: { value: 'someValue' },
          text: { value: 'Hello world' },
        },
        outputs: {},
        enabled: true,
      }

      const serialized = serializer.serializeWorkflow({ 'slack-1': blockWithUnknownField }, [], {})

      const slackBlock = serialized.blocks.find((b) => b.id === 'slack-1')
      expect(slackBlock).toBeDefined()

      expect(slackBlock?.config.params.channel).toBe('general')
      expect(slackBlock?.config.params.text).toBe('Hello world')

      expect(slackBlock?.config.params.unknownField).toBeUndefined()
    })

    it.concurrent(
      'should preserve legacy agent fields (systemPrompt, userPrompt, memories) for backward compatibility',
      () => {
        const serializer = new Serializer()

        const legacyAgentBlock: any = {
          id: 'agent-1',
          type: 'agent',
          name: 'Legacy Agent',
          position: { x: 0, y: 0 },
          advancedMode: false,
          subBlocks: {
            systemPrompt: {
              id: 'systemPrompt',
              type: 'long-input',
              value: 'You are a helpful assistant.',
            },
            userPrompt: {
              id: 'userPrompt',
              type: 'long-input',
              value: 'What is the weather today?',
            },
            memories: {
              id: 'memories',
              type: 'short-input',
              value: [{ role: 'user', content: 'My name is Alice' }],
            },
            model: {
              id: 'model',
              type: 'combobox',
              value: 'gpt-4',
            },
          },
          outputs: {},
          enabled: true,
        }

        const serialized = serializer.serializeWorkflow({ 'agent-1': legacyAgentBlock }, [], {})

        const agentBlock = serialized.blocks.find((b) => b.id === 'agent-1')
        expect(agentBlock).toBeDefined()

        expect(agentBlock?.config.params.systemPrompt).toBe('You are a helpful assistant.')
        expect(agentBlock?.config.params.userPrompt).toBe('What is the weather today?')
        expect(agentBlock?.config.params.memories).toEqual([
          { role: 'user', content: 'My name is Alice' },
        ])
        expect(agentBlock?.config.params.model).toBe('gpt-4')
      }
    )
  })
})
