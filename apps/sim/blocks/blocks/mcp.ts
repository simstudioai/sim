import { ServerIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { ToolResponse } from '@/tools/types'

// MCP-specific response type
export interface McpResponse extends ToolResponse {
  output: {
    text: string
    content?: Array<{
      type: 'text' | 'image' | 'resource'
      text?: string
      data?: string
      mimeType?: string
    }>
    metadata?: {
      hasImages: boolean
      hasResources: boolean
      contentTypes: string[]
    }
  }
}

export const McpBlock: BlockConfig<McpResponse> = {
  type: 'mcp',
  name: 'MCP Tool',
  description: 'Execute tools from Model Context Protocol (MCP) servers',
  longDescription:
    'Connect to MCP servers to execute tools and access external services. Supports HTTP/SSE and Streamable HTTP transports for secure server-side execution. Configure MCP servers in workspace settings.',
  docsLink: 'https://docs.sim.ai/tools/mcp',
  category: 'tools',
  bgColor: '#6366F1', // Indigo color to distinguish from custom tools
  icon: ServerIcon,
  subBlocks: [
    {
      id: 'server',
      title: 'MCP Server',
      type: 'dropdown',
      layout: 'full',
      required: true,
      placeholder: 'Select an MCP server',
      description: 'Choose from configured MCP servers in your workspace',
      // Options will be populated dynamically from registered servers
      options: () => [],
    },
    {
      id: 'tool',
      title: 'Tool',
      type: 'dropdown',
      layout: 'full',
      required: true,
      placeholder: 'Select a tool',
      description: 'Available tools from the selected MCP server',
      // Options will be populated dynamically based on selected server
      options: () => [],
      condition: {
        field: 'server',
        value: '',
        not: true, // Show when server is not empty
      },
    },
    {
      id: 'arguments',
      title: 'Tool Arguments',
      type: 'code',
      layout: 'full',
      language: 'json',
      placeholder: '{\n  "arg1": "value1",\n  "arg2": "value2"\n}',
      description: 'Arguments to pass to the MCP tool (JSON format)',
      condition: {
        field: 'tool',
        value: '',
        not: true, // Show when tool is not empty
      },
    },
    {
      id: 'timeout',
      title: 'Timeout (seconds)',
      type: 'short-input',
      layout: 'half',
      placeholder: '60',
      description: 'Maximum execution time for the tool (default: 60s)',
    },
    {
      id: 'retryOnFailure',
      title: 'Retry on Failure',
      type: 'switch',
      layout: 'half',
      description: 'Automatically retry if the tool execution fails',
    },
  ],
  tools: {
    access: ['mcp_execute'], // Custom tool identifier for MCP execution
    config: {
      tool: () => 'mcp_execute',
      params: (params: Record<string, any>) => ({
        serverId: params.server,
        toolName: params.tool,
        arguments: params.arguments ? JSON.parse(params.arguments) : {},
        timeout: params.timeout ? Number.parseInt(params.timeout) * 1000 : 60000,
        retryOnFailure: params.retryOnFailure === true,
      }),
    },
  },
  inputs: {
    server: {
      type: 'string',
      description: 'MCP server ID to execute the tool on',
    },
    tool: {
      type: 'string',
      description: 'Name of the tool to execute',
    },
    arguments: {
      type: 'json',
      description: 'Arguments to pass to the tool',
      schema: {
        type: 'object',
        properties: {},
        additionalProperties: true,
      },
    },
    timeout: {
      type: 'number',
      description: 'Timeout in seconds (default: 60)',
    },
    retryOnFailure: {
      type: 'boolean',
      description: 'Whether to retry on failure (default: false)',
    },
  },
  outputs: {
    text: {
      type: 'string',
      description: 'Primary text output from the MCP tool',
    },
    content: {
      type: 'json',
      description: 'Full content array with all response types',
    },
    hasImages: {
      type: 'boolean',
      description: 'Whether the response contains image content',
    },
    hasResources: {
      type: 'boolean',
      description: 'Whether the response contains resource references',
    },
    contentTypes: {
      type: 'array',
      description: 'Array of content types present in the response',
    },
    success: {
      type: 'boolean',
      description: 'Whether the tool execution was successful',
    },
    error: {
      type: 'string',
      description: 'Error message if execution failed',
    },
  },
}
