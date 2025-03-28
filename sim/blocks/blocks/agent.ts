import { AgentIcon } from '@/components/icons'
import { ToolResponse } from '@/tools/types'
import { BlockConfig } from '../types'

interface AgentResponse extends ToolResponse {
  output: {
    content: string
    name: string
    prompt: string
    mcpServers: Array<{ url: string }>
  }
}

export const AgentBlock: BlockConfig<AgentResponse> = {
  type: 'agent',
  name: 'Agent',
  description: 'Build an agent',
  longDescription: 'Create powerful AI agents with customizable instructions and MCP server connections.',
  category: 'blocks',
  bgColor: '#7F2FFF',
  icon: AgentIcon,
  subBlocks: [
    {
      id: 'name',
      title: 'Agent Name',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter agent name...',
    },
    {
      id: 'prompt',
      title: 'Prompt',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter instructions for the agent...',
    },
    {
      id: 'mcpServers',
      title: 'MCP Servers (SSE only)',
      type: 'table',
      layout: 'full',
      columns: ['url'],
      placeholder: 'Add MCP server URL',
    }
  ],
  tools: {
    access: ['agent_create'],
    config: {
      tool: () => 'agent_create',
    },
  },
  inputs: {
    name: { type: 'string', required: true },
    prompt: { type: 'string', required: true },
    mcpServers: { 
      type: 'json', 
      required: true,
      schema: {
        type: 'array',
        properties: {},
        items: {
          type: 'object',
          properties: {
            url: { type: 'string' }
          },
          required: ['url']
        }
      }
    }
  },
  outputs: {
    response: {
      type: {
        content: 'string',
        name: 'string',
        prompt: 'string',
        mcpServers: 'json'
      },
    },
  },
}
