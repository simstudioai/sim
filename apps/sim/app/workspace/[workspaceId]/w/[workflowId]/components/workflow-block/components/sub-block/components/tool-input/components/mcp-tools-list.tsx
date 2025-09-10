import type React from 'react'
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
}

interface McpToolsListProps {
  mcpTools: McpTool[]
  searchQuery: string
  customFilter: (name: string, query: string) => number
  onToolSelect: (tool: StoredTool) => void
  disabled?: boolean
}

export function McpToolsList({
  mcpTools,
  searchQuery,
  customFilter,
  onToolSelect,
  disabled = false,
}: McpToolsListProps) {
  const filteredTools = mcpTools.filter((tool) => customFilter(tool.name, searchQuery || '') > 0)

  if (mcpTools.length === 0 || filteredTools.length === 0) {
    return null
  }

  return (
    <>
      <div className='px-2 pt-2.5 pb-0.5 font-medium text-muted-foreground text-xs'>MCP Tools</div>
      <ToolCommand.Group className='-mx-1 -px-1'>
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
              }

              onToolSelect(newTool)
            }}
            className='flex cursor-pointer items-center gap-2'
          >
            <div
              className='flex h-6 w-6 items-center justify-center rounded'
              style={{ backgroundColor: mcpTool.bgColor }}
            >
              <IconComponent icon={mcpTool.icon} className='h-4 w-4 text-white' />
            </div>
            <span
              className='max-w-[140px] truncate'
              title={`${mcpTool.name} (${mcpTool.serverName})`}
            >
              {mcpTool.name}
            </span>
          </ToolCommand.Item>
        ))}
      </ToolCommand.Group>
      <ToolCommand.Separator />
    </>
  )
}
