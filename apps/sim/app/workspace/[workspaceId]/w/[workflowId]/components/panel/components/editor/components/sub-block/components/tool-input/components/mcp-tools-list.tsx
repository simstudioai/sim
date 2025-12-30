import type React from 'react'
import { PopoverSection } from '@/components/emcn'
import { ToolCommand } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tool-input/components/tool-command/tool-command'

const IconComponent = ({ icon: Icon, className }: { icon: any; className?: string }) => {
  if (!Icon) return null
  return <Icon className={className} />
}

interface McpTool {
  id: string
  name: string
  description?: string
  serverId: string
  serverName: string
  icon: React.ComponentType<any>
  bgColor: string
  inputSchema?: any
}

interface McpServer {
  id: string
  url?: string
}

interface StoredTool {
  type: 'mcp'
  title: string
  toolId: string
  params: {
    serverId: string
    serverUrl?: string
    toolName: string
    serverName: string
  }
  isExpanded: boolean
  usageControl: 'auto'
  schema?: any
}

interface McpToolsListProps {
  mcpTools: McpTool[]
  mcpServers?: McpServer[]
  searchQuery: string
  customFilter: (name: string, query: string) => number
  onToolSelect: (tool: StoredTool) => void
  disabled?: boolean
}

/**
 * Displays a filtered list of MCP tools with proper section header and separator
 */
export function McpToolsList({
  mcpTools,
  mcpServers = [],
  searchQuery,
  customFilter,
  onToolSelect,
  disabled = false,
}: McpToolsListProps) {
  const filteredTools = mcpTools.filter((tool) => customFilter(tool.name, searchQuery || '') > 0)

  if (filteredTools.length === 0) {
    return null
  }

  return (
    <>
      <PopoverSection>MCP Tools</PopoverSection>
      {filteredTools.map((mcpTool) => {
        const server = mcpServers.find((s) => s.id === mcpTool.serverId)
        return (
          <ToolCommand.Item
            key={mcpTool.id}
            value={mcpTool.name}
            onSelect={() => {
              if (disabled) return

              const newTool: StoredTool = {
                type: 'mcp',
                title: mcpTool.name,
                toolId: mcpTool.id,
                params: {
                  serverId: mcpTool.serverId,
                  serverUrl: server?.url,
                  toolName: mcpTool.name,
                  serverName: mcpTool.serverName,
                },
                isExpanded: true,
                usageControl: 'auto',
                schema: {
                  ...mcpTool.inputSchema,
                  description: mcpTool.description,
                },
              }

              onToolSelect(newTool)
            }}
          >
            <div
              className='flex h-[14px] w-[14px] flex-shrink-0 items-center justify-center rounded-[4px]'
              style={{ background: mcpTool.bgColor }}
            >
              <IconComponent icon={mcpTool.icon} className='h-[9px] w-[9px] text-white' />
            </div>
            <span className='truncate' title={`${mcpTool.name} (${mcpTool.serverName})`}>
              {mcpTool.name}
            </span>
          </ToolCommand.Item>
        )
      })}
    </>
  )
}
