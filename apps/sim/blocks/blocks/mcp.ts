import { ServerIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { ToolResponse } from '@/tools/types'

export interface McpResponse extends ToolResponse {
  output: any // Raw structured response from MCP tool
}

export const McpBlock: BlockConfig<McpResponse> = {
  type: 'mcp',
  name: 'MCP Tool',
  description: 'Execute tools from Model Context Protocol (MCP) servers',
  longDescription:
    'Connect to MCP servers to execute tools and access external services. Supports HTTP/SSE and Streamable HTTP transports for secure server-side execution. Configure MCP servers in workspace settings.',
  docsLink: 'https://docs.sim.ai/tools/mcp',
  category: 'tools',
  bgColor: '#181C1E',
  icon: ServerIcon,
  subBlocks: [
    {
      id: 'server',
      title: 'MCP Server',
      type: 'mcp-server-selector',
      layout: 'full',
      required: true,
      placeholder: 'Select an MCP server',
      description: 'Choose from configured MCP servers in your workspace',
    },
    {
      id: 'tool',
      title: 'Tool',
      type: 'mcp-tool-selector',
      layout: 'full',
      required: true,
      placeholder: 'Select a tool',
      description: 'Available tools from the selected MCP server',
      dependsOn: ['server'], // Tool options depend on selected server
      condition: {
        field: 'server',
        value: '',
        not: true, // Show when server is not empty
      },
    },
    {
      id: 'arguments',
      title: '',
      type: 'mcp-dynamic-args',
      layout: 'full',
      description: '',
      condition: {
        field: 'tool',
        value: '',
        not: true, // Show when tool is not empty
      },
    },
  ],
  // MCP blocks use the tools framework with dynamic tool IDs
  tools: {
    access: ['mcp-dynamic'], // Placeholder - actual tool ID determined by config.tool function
    config: {
      tool: (params: any) => {
        // Build MCP tool ID from server and tool selections
        if (params.server && params.tool) {
          // Server ID is in format "mcp-timestamp"
          const serverId = params.server
          let toolName = params.tool

          // Handle case where tool selection might include the full MCP tool ID
          // If tool contains the server ID, extract just the tool name
          if (toolName.startsWith(`${serverId}-`)) {
            toolName = toolName.substring(`${serverId}-`.length)
          }

          // Format: "mcp-timestamp-toolName"
          return `${serverId}-${toolName}`
        }
        // Fallback when no selection is made yet
        return 'mcp-dynamic'
      },
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
  },
  outputs: {
    content: {
      type: 'array',
      description: 'Content array from MCP tool response - the standard format for all MCP tools',
    },
  },
}
