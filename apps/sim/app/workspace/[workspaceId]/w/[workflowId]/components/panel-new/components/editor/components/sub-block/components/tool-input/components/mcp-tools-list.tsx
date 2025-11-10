import type React from 'react'
import { PopoverSection } from '@/components/emcn'
import { ToolCommand } from './tool-command/tool-command'

const IconComponent = ({ icon: Icon, className }: { icon: any; className?: string }) => {
  if (!Icon) return null
  return <Icon className={className} />
}

interface McpTool {
  id: string
  name: string
  serverId: string
  serverName: string
  icon: React.ComponentType<any>
  bgColor: string
  inputSchema?: any
}

interface StoredTool {
  type: 'mcp'
  title: string
  toolId: string
  params: {
    serverId: string
    toolName: string
    serverName: string
  }
  isExpanded: boolean
  usageControl: 'auto'
  schema?: any
}

interface McpToolsListProps {
  mcpTools: McpTool[]
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
      {filteredTools.map((mcpTool) => (
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
                toolName: mcpTool.name,
                serverName: mcpTool.serverName,
              },
              isExpanded: true,
              usageControl: 'auto',
              schema: mcpTool.inputSchema,
            }

            onToolSelect(newTool)
          }}
        >
          <div
            className='flex h-[15px] w-[15px] flex-shrink-0 items-center justify-center rounded'
            style={{ backgroundColor: mcpTool.bgColor }}
          >
            <IconComponent icon={mcpTool.icon} className='h-[11px] w-[11px] text-white' />
          </div>
          <span className='truncate' title={`${mcpTool.name} (${mcpTool.serverName})`}>
            {mcpTool.name}
          </span>
        </ToolCommand.Item>
      ))}
    </>
  )
}
