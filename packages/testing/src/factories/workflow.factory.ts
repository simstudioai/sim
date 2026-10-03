/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Options for creating a mock workflow state.
 * Uses `any` for complex types to avoid conflicts with app types.
 */
interface WorkflowFactoryOptions {
  blocks?: Record<string, any>
  edges?: any[]
  loops?: Record<string, any>
  parallels?: Record<string, any>
  lastSaved?: number
  isDeployed?: boolean
  variables?: any[]
}

/**
 * Creates an empty workflow state with defaults.
 *
 * @example
 * ```ts
 * const workflow = createWorkflowState()
 * ```
 */
export function createWorkflowState(options: WorkflowFactoryOptions = {}): any {
  return {
    blocks: options.blocks ?? {},
    edges: options.edges ?? [],
    loops: options.loops ?? {},
    parallels: options.parallels ?? {},
    lastSaved: options.lastSaved ?? Date.now(),
    isDeployed: options.isDeployed ?? false,
    variables: options.variables,
  }
}

/**
 * Detailed workflow state fixture interface for serializer tests.
 */
interface WorkflowStateFixture {
  blocks: Record<string, any>
  edges: any[]
  loops: Record<string, any>
}

/**
 * Creates a minimal workflow with a starter and one agent block.
 * Includes full subBlocks structure for serializer testing.
 */
export function createMinimalWorkflowState(): WorkflowStateFixture {
  const blocks: Record<string, any> = {
    starter: {
      id: 'starter',
      type: 'starter',
      name: 'Starter Block',
      position: { x: 0, y: 0 },
      subBlocks: {
        description: { id: 'description', type: 'long-input', value: 'This is the starter block' },
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
        provider: { id: 'provider', type: 'dropdown', value: 'anthropic' },
        model: { id: 'model', type: 'dropdown', value: 'claude-3-7-sonnet-20250219' },
        prompt: { id: 'prompt', type: 'long-input', value: 'Hello, world!' },
        tools: { id: 'tools', type: 'tool-input', value: '[]' },
        system: { id: 'system', type: 'long-input', value: 'You are a helpful assistant.' },
        responseFormat: { id: 'responseFormat', type: 'code', value: null },
      },
      outputs: {},
      enabled: true,
    },
  }

  return {
    blocks,
    edges: [{ id: 'edge1', source: 'starter', target: 'agent1' }],
    loops: {},
  }
}

/**
 * Creates a workflow with condition blocks and branching paths.
 */
export function createConditionalWorkflowState(): WorkflowStateFixture {
  const blocks: Record<string, any> = {
    starter: {
      id: 'starter',
      type: 'starter',
      name: 'Starter Block',
      position: { x: 0, y: 0 },
      subBlocks: {
        description: { id: 'description', type: 'long-input', value: 'This is the starter block' },
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
        condition: { id: 'condition', type: 'long-input', value: 'input.value > 10' },
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
        provider: { id: 'provider', type: 'dropdown', value: 'anthropic' },
        model: { id: 'model', type: 'dropdown', value: 'claude-3-7-sonnet-20250219' },
        prompt: { id: 'prompt', type: 'long-input', value: 'Value is greater than 10' },
        tools: { id: 'tools', type: 'tool-input', value: '[]' },
        system: { id: 'system', type: 'long-input', value: 'You are a helpful assistant.' },
        responseFormat: { id: 'responseFormat', type: 'code', value: null },
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
        provider: { id: 'provider', type: 'dropdown', value: 'anthropic' },
        model: { id: 'model', type: 'dropdown', value: 'claude-3-7-sonnet-20250219' },
        prompt: { id: 'prompt', type: 'long-input', value: 'Value is less than or equal to 10' },
        tools: { id: 'tools', type: 'tool-input', value: '[]' },
        system: { id: 'system', type: 'long-input', value: 'You are a helpful assistant.' },
        responseFormat: { id: 'responseFormat', type: 'code', value: null },
      },
      outputs: {},
      enabled: true,
    },
  }

  return {
    blocks,
    edges: [
      { id: 'edge1', source: 'starter', target: 'condition1' },
      { id: 'edge2', source: 'condition1', target: 'agent1', sourceHandle: 'condition-true' },
      { id: 'edge3', source: 'condition1', target: 'agent2', sourceHandle: 'condition-false' },
    ],
    loops: {},
  }
}

/**
 * Creates a workflow with a loop structure.
 */
export function createLoopWorkflowState(): WorkflowStateFixture {
  const blocks: Record<string, any> = {
    starter: {
      id: 'starter',
      type: 'starter',
      name: 'Starter Block',
      position: { x: 0, y: 0 },
      subBlocks: {
        description: { id: 'description', type: 'long-input', value: 'This is the starter block' },
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
        language: { id: 'language', type: 'dropdown', value: 'javascript' },
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
        condition: { id: 'condition', type: 'long-input', value: 'input.counter < 5' },
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
        provider: { id: 'provider', type: 'dropdown', value: 'anthropic' },
        model: { id: 'model', type: 'dropdown', value: 'claude-3-7-sonnet-20250219' },
        prompt: {
          id: 'prompt',
          type: 'long-input',
          value: 'Loop completed after {{input.counter}} iterations',
        },
        tools: { id: 'tools', type: 'tool-input', value: '[]' },
        system: { id: 'system', type: 'long-input', value: 'You are a helpful assistant.' },
        responseFormat: { id: 'responseFormat', type: 'code', value: null },
      },
      outputs: {},
      enabled: true,
    },
  }

  return {
    blocks,
    edges: [
      { id: 'edge1', source: 'starter', target: 'function1' },
      { id: 'edge2', source: 'function1', target: 'condition1' },
      { id: 'edge3', source: 'condition1', target: 'function1', sourceHandle: 'condition-true' },
      { id: 'edge4', source: 'condition1', target: 'agent1', sourceHandle: 'condition-false' },
    ],
    loops: {
      loop1: { id: 'loop1', nodes: ['function1', 'condition1'], iterations: 10, loopType: 'for' },
    },
  }
}

/**
 * Creates a complex workflow with multiple block types (API, function, agent).
 */
export function createComplexWorkflowState(): WorkflowStateFixture {
  const blocks: Record<string, any> = {
    starter: {
      id: 'starter',
      type: 'starter',
      name: 'Starter Block',
      position: { x: 0, y: 0 },
      subBlocks: {
        description: { id: 'description', type: 'long-input', value: 'This is the starter block' },
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
        url: { id: 'url', type: 'short-input', value: 'https://api.example.com/data' },
        method: { id: 'method', type: 'dropdown', value: 'GET' },
        headers: {
          id: 'headers',
          type: 'table',
          value: [
            ['Content-Type', 'application/json'],
            ['Authorization', 'Bearer {{API_KEY}}'],
          ],
        },
        body: { id: 'body', type: 'long-input', value: '' },
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
        language: { id: 'language', type: 'dropdown', value: 'javascript' },
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
        provider: { id: 'provider', type: 'dropdown', value: 'openai' },
        model: { id: 'model', type: 'dropdown', value: 'gpt-4o' },
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
        system: { id: 'system', type: 'long-input', value: 'You are a data analyst assistant.' },
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

  return {
    blocks,
    edges: [
      { id: 'edge1', source: 'starter', target: 'api1' },
      { id: 'edge2', source: 'api1', target: 'function1' },
      { id: 'edge3', source: 'function1', target: 'agent1' },
    ],
    loops: {},
  }
}
