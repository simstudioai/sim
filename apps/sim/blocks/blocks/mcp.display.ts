import { McpIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const McpBlockDisplay = {
  type: 'mcp',
  name: 'MCP Tool',
  description: 'Execute tools from Model Context Protocol (MCP) servers',
  category: 'blocks',
  bgColor: '#181C1E',
  icon: McpIcon,
  longDescription:
    'Integrate MCP into the workflow. Can execute tools from MCP servers. Requires MCP servers in workspace settings.',
  docsLink: 'https://docs.sim.ai/agents/mcp',
  integrationType: IntegrationType.DevOps,
} satisfies BlockDisplay
