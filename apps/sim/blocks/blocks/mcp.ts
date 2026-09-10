import { McpIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { IntegrationType } from '@/blocks/types'
import type { ToolResponse } from '@/tools/types'

export interface McpResponse extends ToolResponse {
  output: Record<string, unknown>
}

export const McpBlock: BlockConfig<McpResponse> = {
  type: 'mcp',
  name: 'MCP',
  description: 'Discover and run authorized MCP operations',
  longDescription:
    'List or run operations from configured MCP servers and managed connections. Resolve servers, connections, operation names, and JSON arguments from upstream blocks, with exact-name operation access controls.',
  docsLink: 'https://docs.sim.ai/agents/mcp',
  category: 'blocks',
  integrationType: IntegrationType.DevOps,
  bgColor: '#181C1E',
  icon: McpIcon,
  canvasPresentation: {
    defaultTitle: 'MCP',
    sentences: {
      byOperation: {
        run: ['Run operation', { field: 'tool' }, { text: 'on', field: 'server' }],
        list: ['List operations', { text: 'on', field: 'server' }],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Action',
      type: 'dropdown',
      options: [
        { id: 'run', label: 'Run operation' },
        { id: 'list', label: 'List operations' },
      ],
      value: () => 'run',
    },
    {
      id: 'server',
      title: 'MCP Server',
      canvasNoun: 'an MCP server',
      type: 'mcp-server-selector',
      required: true,
      placeholder: 'Select an MCP server',
      description: 'Choose from configured MCP servers in your workspace',
    },
    {
      id: 'connection',
      title: 'Managed connection',
      type: 'mcp-server-selector',
      placeholder: 'Optional connection ID or upstream reference',
      description: 'When provided, the connection must belong to the selected canonical server.',
    },
    {
      id: 'operationPolicy',
      title: 'Operations access',
      type: 'mcp-operation-policy',
      defaultValue: { mode: 'allow', operations: [] },
    },
    {
      id: 'search',
      title: 'Search operations',
      type: 'short-input',
      condition: { field: 'operation', value: 'list' },
    },
    {
      id: 'limit',
      title: 'Page size',
      type: 'short-input',
      value: () => '100',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list' },
    },
    {
      id: 'cursor',
      title: 'Cursor',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list' },
    },
    {
      id: 'tool',
      title: 'Operation',
      type: 'mcp-tool-selector',
      selectorKey: 'mcp.tools',
      required: { field: 'operation', value: 'list', not: true },
      placeholder: 'Select an operation or enter a reference',
      description: 'Available tools from the selected MCP server',
      dependsOn: ['server'],
      condition: {
        field: 'operation',
        value: 'list',
        not: true,
      },
    },
    {
      id: 'arguments',
      title: '',
      type: 'mcp-dynamic-args',
      description: '',
      condition: {
        field: 'tool',
        value: '',
        not: true,
        and: { field: 'operation', value: 'list', not: true },
      },
      dependsOn: ['tool'],
    },
  ],
  tools: {
    access: ['mcp_run_operation', 'mcp_list_operations'],
    config: {
      tool: (params) => (params.operation === 'list' ? 'mcp_list_operations' : 'mcp_run_operation'),
      params: (params) => ({ ...params, ...(params.limit ? { limit: Number(params.limit) } : {}) }),
    },
  },
  inputs: {
    connection: {
      type: 'string',
      description: 'Optional managed connection bound to the canonical server',
    },
    search: { type: 'string', description: 'Filter operation names and descriptions' },
    limit: { type: 'number', description: 'Page size from 1 to 100' },
    cursor: { type: 'string', description: 'Cursor from the previous page' },
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
  },
  outputs: {
    operations: {
      type: 'json',
      description: 'Authorized operations (name, description, inputSchema, serverId)',
    },
    nextCursor: { type: 'string', description: 'Cursor for the next page, or null' },
    hasMore: { type: 'boolean', description: 'Whether more authorized operations are available' },
    content: {
      type: 'array',
      description: 'Content array from MCP tool response - the standard format for all MCP tools',
    },
  },
}
