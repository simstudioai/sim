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
    'List or run operations from configured MCP servers and managed connections. Use a server or managed connection ID and an exact operation name, including references from upstream blocks.',
  docsLink: 'https://docs.sim.ai/agents/mcp',
  category: 'blocks',
  integrationType: IntegrationType.DevOps,
  bgColor: '#181C1E',
  icon: McpIcon,
  canvasPresentation: {
    defaultTitle: 'MCP',
    sentences: {
      byOperation: {
        run: [
          'Run operation',
          { field: ['toolSelector', 'toolReference'] },
          { text: 'on', field: ['serverSelector', 'serverReference'] },
        ],
        list: ['List operations', { text: 'on', field: ['serverSelector', 'serverReference'] }],
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
      id: 'serverSelector',
      canonicalParamId: 'server',
      mode: 'basic',
      title: 'MCP Server',
      canvasNoun: 'an MCP server',
      type: 'mcp-server-selector',
      required: true,
      placeholder: 'Select an MCP server',
      description: 'Choose from configured MCP servers in your workspace',
    },
    {
      id: 'serverReference',
      canonicalParamId: 'server',
      mode: 'advanced',
      title: 'MCP Server',
      type: 'short-input',
      required: true,
      placeholder: 'Enter a server or connection ID, or reference',
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
      id: 'toolSelector',
      canonicalParamId: 'tool',
      mode: 'basic',
      title: 'Operation',
      type: 'mcp-tool-selector',
      selectorKey: 'mcp.tools',
      required: { field: 'operation', value: 'list', not: true },
      placeholder: 'Select an operation',
      description: 'Available tools from the selected MCP server',
      condition: {
        field: 'operation',
        value: 'list',
        not: true,
      },
    },
    {
      id: 'toolReference',
      canonicalParamId: 'tool',
      mode: 'advanced',
      title: 'Operation',
      type: 'short-input',
      required: { field: 'operation', value: 'list', not: true },
      placeholder: 'Enter an exact operation name or reference',
      condition: { field: 'operation', value: 'list', not: true },
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
    serverId: { type: 'string', description: 'The supplied MCP server or connection ID' },
    operations: {
      type: 'json',
      description: 'Authorized operations (name, description, inputSchema)',
    },
    nextCursor: { type: 'string', description: 'Cursor for the next page, or null' },
    hasMore: { type: 'boolean', description: 'Whether more authorized operations are available' },
    content: {
      type: 'array',
      description: 'Content array from MCP tool response - the standard format for all MCP tools',
    },
  },
}
