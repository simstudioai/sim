/**
 * Mock block configurations for serializer and related tests.
 *
 * @example
 * ```ts
 * import { blocksMock, mockBlockConfigs } from '@sim/testing/mocks'
 *
 * vi.mock('@/blocks', () => blocksMock)
 *
 * // Or use individual configs
 * const starterConfig = mockBlockConfigs.starter
 * ```
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Mock block configurations that mirror the real block registry.
 * Used for testing serialization, deserialization, and validation.
 */
export const mockBlockConfigs: Record<string, any> = {
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
      access: ['anthropic_chat', 'openai_chat', 'google_chat'],
      config: {
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
  jina: {
    name: 'Jina',
    description: 'Convert website content into text',
    category: 'tools',
    bgColor: '#333333',
    tools: {
      access: ['jina_read_url'],
      config: { tool: () => 'jina_read_url' },
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
      config: { tool: () => 'reddit_get_posts' },
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
        title: 'Channel',
        mode: 'basic',
        canonicalParamId: 'channel',
      },
      {
        id: 'manualChannel',
        type: 'short-input',
        title: 'Channel ID',
        mode: 'advanced',
        canonicalParamId: 'channel',
      },
      { id: 'text', type: 'long-input', title: 'Message' },
      { id: 'username', type: 'short-input', title: 'Username', mode: 'both' },
    ],
    inputs: {
      channel: { type: 'string' },
      manualChannel: { type: 'string' },
      text: { type: 'string' },
      username: { type: 'string' },
    },
  },
  agentWithMemories: {
    name: 'Agent with Memories',
    description: 'AI Agent with memory support',
    category: 'ai',
    bgColor: '#2196F3',
    tools: {
      access: ['anthropic_chat'],
      config: { tool: () => 'anthropic_chat' },
    },
    subBlocks: [
      { id: 'systemPrompt', type: 'long-input', title: 'System Prompt' },
      { id: 'userPrompt', type: 'long-input', title: 'User Prompt' },
      { id: 'memories', type: 'short-input', title: 'Memories', mode: 'advanced' },
      { id: 'model', type: 'dropdown', title: 'Model' },
    ],
    inputs: {
      systemPrompt: { type: 'string' },
      userPrompt: { type: 'string' },
      memories: { type: 'array' },
      model: { type: 'string' },
    },
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
  wait: {
    name: 'Wait',
    description: 'Pause workflow execution for a specified time delay',
    category: 'blocks',
    bgColor: '#F59E0B',
    tools: {
      access: [],
    },
    subBlocks: [
      {
        id: 'timeValue',
        title: 'Wait Amount',
        type: 'short-input',
        placeholder: '10',
        required: true,
      },
      {
        id: 'timeUnit',
        title: 'Unit',
        type: 'dropdown',
        required: true,
      },
    ],
    inputs: {
      timeValue: { type: 'string' },
      timeUnit: { type: 'string' },
    },
    outputs: {
      waitDuration: { type: 'number' },
      status: { type: 'string' },
    },
  },
}

/**
 * Creates a getBlock function that returns mock block configs.
 * Can be extended with additional block types.
 */
export function createMockGetBlock(extraConfigs: Record<string, any> = {}) {
  const configs = { ...mockBlockConfigs, ...extraConfigs }
  return (type: string) => configs[type] || null
}

/**
 * Mock tool configurations for validation tests.
 */
export const mockToolConfigs: Record<string, any> = {
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

/**
 * Creates a getTool function that returns mock tool configs.
 */
export function createMockGetTool(extraConfigs: Record<string, any> = {}) {
  const configs = { ...mockToolConfigs, ...extraConfigs }
  return (toolId: string) => configs[toolId] || null
}

/**
 * Pre-configured blocks mock for use with vi.mock('@/blocks', () => blocksMock).
 */
export const blocksMock = {
  getBlock: createMockGetBlock(),
  getAllBlocks: () => Object.values(mockBlockConfigs),
}

/**
 * Pre-configured tools/utils mock for use with vi.mock('@/tools/utils', () => toolsUtilsMock).
 */
export const toolsUtilsMock = {
  getTool: createMockGetTool(),
}
