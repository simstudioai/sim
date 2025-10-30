import { ServerIcon } from '@/components/icons'
import { createMcpToolId } from '@/lib/mcp/utils'
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
    'Integrate MCP into the workflow. Can execute tools from MCP servers. Requires MCP servers in workspace settings.',
  docsLink: 'https://docs.sim.ai/tools/mcp',
  category: 'tools',
  bgColor: '#181C1E',
  icon: ServerIcon,
  subBlocks: [
    {
      id: 'server',
      title: 'MCP Server',
      type: 'mcp-server-selector',
      required: true,
      placeholder: 'Select an MCP server',
      description: 'Choose from configured MCP servers in your workspace',
    },
    {
      id: 'tool',
      title: 'Tool',
      type: 'mcp-tool-selector',
      required: true,
      placeholder: 'Select a tool',
      description: 'Available tools from the selected MCP server',
      dependsOn: ['server'],
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
      description: '',
      condition: {
        field: 'tool',
        value: '',
        not: true, // Show when tool is not empty
      },
    },
  ],
  tools: {
    access: [], // No static tool access needed - tools are dynamically resolved
    config: {
      tool: (params: any) => {
        if (params.server && params.tool) {
          const serverId = params.server
          let toolName = params.tool

          if (toolName.startsWith(`${serverId}-`)) {
            toolName = toolName.substring(`${serverId}-`.length)
          }

          return createMcpToolId(serverId, toolName)
        }
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
