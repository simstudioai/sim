/**
 * Test Workflows
 *
 * This file contains test fixtures for serializer tests, providing
 * sample workflow states with different configurations.
 */
import type { Edge } from 'reactflow'
import type { BlockState, Loop } from '@/stores/workflows/workflow/types'

/**
 * Workflow State Interface
 */
export interface WorkflowStateFixture {
  blocks: Record<string, BlockState>
  edges: Edge[]
  loops: Record<string, Loop>
}

/**
 * Create a minimal workflow with just a starter and one block
 */
export function createMinimalWorkflowState(): WorkflowStateFixture {
  const blocks: Record<string, BlockState> = {
    starter: {
      id: 'starter',
      type: 'starter',
      name: 'Starter Block',
      position: { x: 0, y: 0 },
      subBlocks: {
        description: {
          id: 'description',
          type: 'long-input',
          value: 'This is the starter block',
        },
      },
      outputs: {},
      enabled: true,
    },
    agent1: {
      id: 'agent1',
      type: 'agent',
      name: 'Agent Block',
      position: { x: 300, y: 0 },
      subBlocks: {
        provider: {
          id: 'provider',
          type: 'dropdown',
          value: 'anthropic',
        },
        model: {
          id: 'model',
          type: 'dropdown',
          value: 'claude-3-7-sonnet-20250219',
        },
        prompt: {
          id: 'prompt',
          type: 'long-input',
          value: 'Hello, world!',
        },
        tools: {
          id: 'tools',
          type: 'tool-input',
          value: '[]',
        },
        system: {
          id: 'system',
          type: 'long-input',
          value: 'You are a helpful assistant.',
        },
        responseFormat: {
          id: 'responseFormat',
          type: 'code',
          value: null,
        },
      },
      outputs: {},
      enabled: true,
    },
  }

  const edges: Edge[] = [
    {
      id: 'edge1',
      source: 'starter',
      target: 'agent1',
    },
  ]

  const loops: Record<string, Loop> = {}

  return { blocks, edges, loops }
}

/**
 * Create a workflow with condition blocks
 */
export function createConditionalWorkflowState(): WorkflowStateFixture {
  const blocks: Record<string, BlockState> = {
    starter: {
      id: 'starter',
      type: 'starter',
      name: 'Starter Block',
      position: { x: 0, y: 0 },
      subBlocks: {
        description: {
          id: 'description',
          type: 'long-input',
          value: 'This is the starter block',
        },
      },
      outputs: {},
      enabled: true,
    },
    condition1: {
      id: 'condition1',
      type: 'condition',
      name: 'Condition Block',
      position: { x: 300, y: 0 },
      subBlocks: {
        condition: {
          id: 'condition',
          type: 'long-input',
          value: 'input.value > 10',
        },
      },
      outputs: {},
      enabled: true,
    },
    agent1: {
      id: 'agent1',
      type: 'agent',
      name: 'True Path Agent',
      position: { x: 600, y: -100 },
      subBlocks: {
        provider: {
          id: 'provider',
          type: 'dropdown',
          value: 'anthropic',
        },
        model: {
          id: 'model',
          type: 'dropdown',
          value: 'claude-3-7-sonnet-20250219',
        },
        prompt: {
          id: 'prompt',
          type: 'long-input',
          value: 'Value is greater than 10',
        },
        tools: {
          id: 'tools',
          type: 'tool-input',
          value: '[]',
        },
        system: {
          id: 'system',
          type: 'long-input',
          value: 'You are a helpful assistant.',
        },
        responseFormat: {
          id: 'responseFormat',
          type: 'code',
          value: null,
        },
      },
      outputs: {},
      enabled: true,
    },
    agent2: {
      id: 'agent2',
      type: 'agent',
      name: 'False Path Agent',
      position: { x: 600, y: 100 },
      subBlocks: {
        provider: {
          id: 'provider',
          type: 'dropdown',
          value: 'anthropic',
        },
        model: {
          id: 'model',
          type: 'dropdown',
          value: 'claude-3-7-sonnet-20250219',
        },
        prompt: {
          id: 'prompt',
          type: 'long-input',
          value: 'Value is less than or equal to 10',
        },
        tools: {
          id: 'tools',
          type: 'tool-input',
          value: '[]',
        },
        system: {
          id: 'system',
          type: 'long-input',
          value: 'You are a helpful assistant.',
        },
        responseFormat: {
          id: 'responseFormat',
          type: 'code',
          value: null,
        },
      },
      outputs: {},
      enabled: true,
    },
  }

  const edges: Edge[] = [
    {
      id: 'edge1',
      source: 'starter',
      target: 'condition1',
    },
    {
      id: 'edge2',
      source: 'condition1',
      target: 'agent1',
      sourceHandle: 'condition-true',
    },
    {
      id: 'edge3',
      source: 'condition1',
      target: 'agent2',
      sourceHandle: 'condition-false',
    },
  ]

  const loops: Record<string, Loop> = {}

  return { blocks, edges, loops }
}

/**
 * Create a workflow with a loop
 */
export function createLoopWorkflowState(): WorkflowStateFixture {
  const blocks: Record<string, BlockState> = {
    starter: {
      id: 'starter',
      type: 'starter',
      name: 'Starter Block',
      position: { x: 0, y: 0 },
      subBlocks: {
        description: {
          id: 'description',
          type: 'long-input',
          value: 'This is the starter block',
        },
      },
      outputs: {},
      enabled: true,
    },
    function1: {
      id: 'function1',
      type: 'function',
      name: 'Function Block',
      position: { x: 300, y: 0 },
      subBlocks: {
        code: {
          id: 'code',
          type: 'code',
          value: 'let counter = input.counter || 0;\ncounter++;\nreturn { counter };',
        },
        language: {
          id: 'language',
          type: 'dropdown',
          value: 'javascript',
        },
      },
      outputs: {},
      enabled: true,
    },
    condition1: {
      id: 'condition1',
      type: 'condition',
      name: 'Loop Condition',
      position: { x: 600, y: 0 },
      subBlocks: {
        condition: {
          id: 'condition',
          type: 'long-input',
          value: 'input.counter < 5',
        },
      },
      outputs: {},
      enabled: true,
    },
    agent1: {
      id: 'agent1',
      type: 'agent',
      name: 'Loop Complete Agent',
      position: { x: 900, y: 100 },
      subBlocks: {
        provider: {
          id: 'provider',
          type: 'dropdown',
          value: 'anthropic',
        },
        model: {
          id: 'model',
          type: 'dropdown',
          value: 'claude-3-7-sonnet-20250219',
        },
        prompt: {
          id: 'prompt',
          type: 'long-input',
          value: 'Loop completed after {{input.counter}} iterations',
        },
        tools: {
          id: 'tools',
          type: 'tool-input',
          value: '[]',
        },
        system: {
          id: 'system',
          type: 'long-input',
          value: 'You are a helpful assistant.',
        },
        responseFormat: {
          id: 'responseFormat',
          type: 'code',
          value: null,
        },
      },
      outputs: {},
      enabled: true,
    },
  }

  const edges: Edge[] = [
    {
      id: 'edge1',
      source: 'starter',
      target: 'function1',
    },
    {
      id: 'edge2',
      source: 'function1',
      target: 'condition1',
    },
    {
      id: 'edge3',
      source: 'condition1',
      target: 'function1',
      sourceHandle: 'condition-true',
    },
    {
      id: 'edge4',
      source: 'condition1',
      target: 'agent1',
      sourceHandle: 'condition-false',
    },
  ]

  const loops: Record<string, Loop> = {
    loop1: {
      id: 'loop1',
      nodes: ['function1', 'condition1'],
      iterations: 10,
      loopType: 'for',
    },
  }

  return { blocks, edges, loops }
}

/**
 * Create a workflow with multiple block types
 */
export function createComplexWorkflowState(): WorkflowStateFixture {
  const blocks: Record<string, BlockState> = {
    starter: {
      id: 'starter',
      type: 'starter',
      name: 'Starter Block',
      position: { x: 0, y: 0 },
      subBlocks: {
        description: {
          id: 'description',
          type: 'long-input',
          value: 'This is the starter block',
        },
      },
      outputs: {},
      enabled: true,
    },
    api1: {
      id: 'api1',
      type: 'api',
      name: 'API Request',
      position: { x: 300, y: 0 },
      subBlocks: {
        url: {
          id: 'url',
          type: 'short-input',
          value: 'https://api.example.com/data',
        },
        method: {
          id: 'method',
          type: 'dropdown',
          value: 'GET',
        },
        headers: {
          id: 'headers',
          type: 'table',
          value: [
            ['Content-Type', 'application/json'],
            ['Authorization', 'Bearer {{API_KEY}}'],
          ],
        },
        body: {
          id: 'body',
          type: 'long-input',
          value: '',
        },
      },
      outputs: {},
      enabled: true,
    },
    function1: {
      id: 'function1',
      type: 'function',
      name: 'Process Data',
      position: { x: 600, y: 0 },
      subBlocks: {
        code: {
          id: 'code',
          type: 'code',
          value: 'const data = input.data;\nreturn { processed: data.map(item => item.name) };',
        },
        language: {
          id: 'language',
          type: 'dropdown',
          value: 'javascript',
        },
      },
      outputs: {},
      enabled: true,
    },
    agent1: {
      id: 'agent1',
      type: 'agent',
      name: 'Summarize Data',
      position: { x: 900, y: 0 },
      subBlocks: {
        provider: {
          id: 'provider',
          type: 'dropdown',
          value: 'openai',
        },
        model: {
          id: 'model',
          type: 'dropdown',
          value: 'gpt-4o',
        },
        prompt: {
          id: 'prompt',
          type: 'long-input',
          value: 'Summarize the following data:\n\n{{input.processed}}',
        },
        tools: {
          id: 'tools',
          type: 'tool-input',
          value:
            '[{"type":"function","name":"calculator","description":"Perform calculations","parameters":{"type":"object","properties":{"expression":{"type":"string","description":"Math expression to evaluate"}},"required":["expression"]}}]',
        },
        system: {
          id: 'system',
          type: 'long-input',
          value: 'You are a data analyst assistant.',
        },
        responseFormat: {
          id: 'responseFormat',
          type: 'code',
          value:
            '{"type":"object","properties":{"summary":{"type":"string"},"keyPoints":{"type":"array","items":{"type":"string"}},"sentiment":{"type":"string","enum":["positive","neutral","negative"]}},"required":["summary","keyPoints","sentiment"]}',
        },
      },
      outputs: {},
      enabled: true,
    },
  }

  const edges: Edge[] = [
    {
      id: 'edge1',
      source: 'starter',
      target: 'api1',
    },
    {
      id: 'edge2',
      source: 'api1',
      target: 'function1',
    },
    {
      id: 'edge3',
      source: 'function1',
      target: 'agent1',
    },
  ]

  const loops: Record<string, Loop> = {}

  return { blocks, edges, loops }
}

/**
 * Create a workflow with agent blocks that have custom tools
 */
export function createAgentWithToolsWorkflowState(): WorkflowStateFixture {
  const blocks: Record<string, BlockState> = {
    starter: {
      id: 'starter',
      type: 'starter',
      name: 'Starter Block',
      position: { x: 0, y: 0 },
      subBlocks: {
        description: {
          id: 'description',
          type: 'long-input',
          value: 'This is the starter block',
        },
      },
      outputs: {},
      enabled: true,
    },
    agent1: {
      id: 'agent1',
      type: 'agent',
      name: 'Custom Tools Agent',
      position: { x: 300, y: 0 },
      subBlocks: {
        provider: {
          id: 'provider',
          type: 'dropdown',
          value: 'openai',
        },
        model: {
          id: 'model',
          type: 'dropdown',
          value: 'gpt-4o',
        },
        prompt: {
          id: 'prompt',
          type: 'long-input',
          value: 'Use the tools to help answer: {{input.question}}',
        },
        tools: {
          id: 'tools',
          type: 'tool-input',
          value:
            '[{"type":"custom-tool","name":"weather","description":"Get current weather","parameters":{"type":"object","properties":{"location":{"type":"string"}},"required":["location"]}},{"type":"function","name":"calculator","description":"Calculate expression","parameters":{"type":"object","properties":{"expression":{"type":"string"}},"required":["expression"]}}]',
        },
        system: {
          id: 'system',
          type: 'long-input',
          value: 'You are a helpful assistant with access to tools.',
        },
        responseFormat: {
          id: 'responseFormat',
          type: 'code',
          value: null,
        },
      },
      outputs: {},
      enabled: true,
    },
  }

  const edges: Edge[] = [
    {
      id: 'edge1',
      source: 'starter',
      target: 'agent1',
    },
  ]

  const loops: Record<string, Loop> = {}

  return { blocks, edges, loops }
}

/**
 * Create a workflow state with an invalid block type for error testing
 */
export function createInvalidWorkflowState(): WorkflowStateFixture {
  const { blocks, edges, loops } = createMinimalWorkflowState()

  // Add an invalid block type
  blocks.invalid = {
    id: 'invalid',
    type: 'invalid-type',
    name: 'Invalid Block',
    position: { x: 600, y: 0 },
    subBlocks: {},
    outputs: {},
    enabled: true,
  }

  edges.push({
    id: 'edge-invalid',
    source: 'agent1',
    target: 'invalid',
  })

  return { blocks, edges, loops }
}

/**
 * Create a serialized workflow with invalid metadata for error testing
 */
export function createInvalidSerializedWorkflow() {
  return {
    version: '1.0',
    blocks: [
      {
        id: 'invalid',
        position: { x: 0, y: 0 },
        config: {
          tool: 'invalid',
          params: {},
        },
        inputs: {},
        outputs: {},
        metadata: {
          id: 'non-existent-type',
        },
        enabled: true,
      },
    ],
    connections: [],
    loops: {},
  }
}

/**
 * Create a serialized workflow with missing metadata for error testing
 */
export function createMissingMetadataWorkflow() {
  return {
    version: '1.0',
    blocks: [
      {
        id: 'invalid',
        position: { x: 0, y: 0 },
        config: {
          tool: 'invalid',
          params: {},
        },
        inputs: {},
        outputs: {},
        metadata: undefined,
        enabled: true,
      },
    ],
    connections: [],
    loops: {},
  }
}
