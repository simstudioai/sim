import { AgentIcon } from '@/components/icons'
import { ToolResponse } from '@/tools/types'
import { BlockConfig } from '../types'

interface AgentTemplateResponse extends ToolResponse {
  output: {
    content: string
    name: string
    prompt: string
    mcpServers: Array<{ url: string }>
  }
}

export const AgentTemplateBlock: BlockConfig<AgentTemplateResponse> = {
  type: 'agent_template',
  name: 'Agent Template',
  description: 'Create and configure an agent with MCP servers',
  longDescription: 'Build a powerful agent with customizable instructions and MCP server connections.',
  category: 'agents',
  bgColor: '#5D3FD3',
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
    access: ['agent_template_create'],
    config: {
      tool: () => 'agent_template_create',
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